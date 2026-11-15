"""Cross-cutting HTTP behaviour for the API: error format, CORS, caching,
timing, health and OpenAPI metadata. Kept out of the route modules so every
endpoint behaves the same way.

Error contract (every non-2xx JSON response)::

    {"detail": "<human-readable sentence>", "code": "<stable machine code>", ...}

``detail`` is always a string so clients can show it directly. Validation
errors add ``errors``: a list of ``{"field", "message"}``.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("martian_map.api")

API_TITLE = "Martian Map API"
API_VERSION = "1.0.0"
API_DESCRIPTION = (
    "Mars site intelligence and surface route planning on public NASA/USGS data. "
    "Coordinates are Mars planetocentric latitude and east longitude in degrees (-180 to 180). "
    "All assessments are educational model estimates, not operational safety approvals."
)
TAGS = [
    {"name": "system", "description": "Service health and data readiness."},
    {"name": "site", "description": "What is at a coordinate, and whether it can be reached."},
    {"name": "routes", "description": "A* route planning on local elevation data."},
    {"name": "terrain", "description": "Local terrain grids and cell inspection."},
    {"name": "jezero", "description": "Jezero data pack: rover traverse, geology legend, provenance."},
    {"name": "imagery", "description": "Bounded same-origin cache for planetary map tiles."},
    {"name": "navigation", "description": "Terrain-relative navigation demonstration."},
    {"name": "guide", "description": "Evidence-based site and mission questions."},
]
# Longest prefix wins; used to tag routes that were declared without tags.
TAG_BY_PREFIX = [
    ("/api/health", "system"), ("/api/site", "site"), ("/api/landing/routes", "routes"), ("/api/landing", "site"),
    ("/api/surface", "routes"), ("/api/routes", "routes"), ("/api/profiles", "routes"), ("/api/terrain", "terrain"),
    ("/api/jezero", "jezero"), ("/api/layers", "imagery"), ("/api/navigation", "navigation"), ("/api/guide", "guide"),
]
CODE_BY_STATUS = {400: "bad_request", 404: "not_found", 405: "method_not_allowed", 409: "conflict",
                  422: "unprocessable", 429: "rate_limited", 502: "upstream_unavailable", 503: "unavailable"}
# Responses that only change when data is re-imported can be cached by the browser.
CACHEABLE = ("/api/jezero/", "/api/profiles")
DEFAULT_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5273", "http://127.0.0.1:5273")

BACKEND = Path(__file__).resolve().parents[1]
DATASETS = {
    # name: (path, required for core features)
    "jezero_ctx_dem": (BACKEND / "data/jezero-ctx-20m.tif", True),
    "mola_megdr": (BACKEND / "data/megt90n000cb.img", True),
    "crater_catalog": (BACKEND / "data/robbins-craters.npz", True),
    "iau_names": (BACKEND / "data/mars-names.json", True),
    "jezero_pack": (BACKEND / "data/jezero/polygons.npz", False),
    "mola_cog": (BACKEND.parent / "frontend/public/mars-data/mola/elevation.cog.tif", False),
}


def allowed_origins() -> list[str]:
    configured = os.environ.get("MARS_ALLOWED_ORIGINS", "")
    return [origin.strip() for origin in configured.split(",") if origin.strip()] or list(DEFAULT_ORIGINS)


def health_report() -> dict:
    datasets = {name: {"available": path.is_file(), "required": required} for name, (path, required) in DATASETS.items()}
    missing_required = [name for name, info in datasets.items() if info["required"] and not info["available"]]
    missing_optional = [name for name, info in datasets.items() if not info["required"] and not info["available"]]
    return {"status": "degraded" if missing_required else "ok", "version": API_VERSION,
            "datasets": datasets, "missingRequired": missing_required, "missingOptional": missing_optional}


def _field(location: tuple) -> str:
    parts = [str(part) for part in location if part not in ("body", "query", "path")]
    return ".".join(parts) or "request"


def _error(status: int, detail: str, code: str, headers: dict | None = None, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail, "code": code, **extra}, headers=headers)


def install(app: FastAPI) -> None:
    """Register handlers and middleware. Call once, right after creating the app."""
    app.title, app.version, app.description = API_TITLE, API_VERSION, API_DESCRIPTION
    app.openapi_tags = TAGS

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        errors = [{"field": _field(tuple(item.get("loc", ()))), "message": item.get("msg", "Invalid value")} for item in exc.errors()]
        summary = "; ".join(f"{item['field']}: {item['message']}" for item in errors[:3])
        return _error(422, f"Invalid request. {summary}.", "invalid_request", errors=errors)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return _error(exc.status_code, detail, CODE_BY_STATUS.get(exc.status_code, "error"), headers=exc.headers)

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _error(500, "The server could not complete this request. Try again; if it persists, check the server log.",
                      "internal_error")

    @app.middleware("http")
    async def timing_and_cache(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Response-Time"] = f"{(time.perf_counter() - started) * 1000:.1f}ms"
        path = request.url.path
        if request.method == "GET" and response.status_code == 200 and path.startswith(CACHEABLE) \
                and "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "public, max-age=3600"
        return response

    app.add_middleware(CORSMiddleware, allow_origins=allowed_origins(), allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type"], expose_headers=["X-Response-Time"])


def finalize(app: FastAPI) -> None:
    """Tag routes declared directly on the app. Included routers are tagged at include time,
    because FastAPI keeps their routes inside the included router object."""
    for route in app.routes:
        if isinstance(route, APIRoute) and not route.tags:
            match = max((prefix for prefix, _ in TAG_BY_PREFIX if route.path.startswith(prefix)), key=len, default=None)
            if match:
                route.tags = [dict(TAG_BY_PREFIX)[match]]
    app.openapi_schema = None
