"""MARS NEXUS AI - backend API."""
from __future__ import annotations

import base64
import time
from typing import Annotated

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .explain import explain
from .ai_assistant import router as guide_router
from .imagery_service import router as imagery_router
from .navigation_demo import router as navigation_router
from .site_api import router as site_router
from . import api_platform
from .landing import assessment, surface_routes, point_to_point_routes
from .planner import CLASS_NAMES, DEFAULT_WEIGHTS, G_MARS, analyse, plan_routes
from .profiles import PROFILES, resolve
from .terrain import Terrain, load_terrain
from .data_catalog import region_at

app = FastAPI()
api_platform.install(app)
app.include_router(imagery_router, tags=['imagery'])
app.include_router(navigation_router, tags=['navigation'])
app.include_router(guide_router, tags=['guide'])
app.include_router(site_router)

_terrain: Terrain | None = None


def get_terrain() -> Terrain:
    global _terrain
    if _terrain is None:
        _terrain = load_terrain()
    return _terrain


def _b64(a: np.ndarray, dtype: str) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype=dtype).tobytes()).decode("ascii")


def _suggest_points(t: Terrain) -> dict:
    """Two passable points far apart, for a sensible first view."""
    h, w = t.shape
    an = analyse(t, PROFILES["astronaut_eva"])
    ok = (an["cls"] == 0) & (t.confidence > 0.8)

    def nearest(r0: int, c0: int) -> list[int]:
        rr, cc = np.nonzero(ok)
        if rr.size == 0:
            return [r0, c0]
        i = int(np.argmin((rr - r0) ** 2 + (cc - c0) ** 2))
        return [int(rr[i]), int(cc[i])]

    return {"start": nearest(int(0.88 * h), int(0.10 * w)), "goal": nearest(int(0.12 * h), int(0.90 * w))}


class Obstacle(BaseModel):
    row: int
    col: int
    radius: float = 3.0


class RouteRequest(BaseModel):
    start: tuple[int, int]
    goal: tuple[int, int]
    profile: str = "astronaut_eva"
    overrides: dict[str, float] = Field(default_factory=dict)
    weights: dict[str, float] = Field(default_factory=dict)
    obstacles: list[Obstacle] = Field(default_factory=list)


class SiteRouteRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    profile: str
    overrides: dict[str, Annotated[float, Field(allow_inf_nan=False)]] = Field(default_factory=dict)
    weights: dict[str, Annotated[float, Field(allow_inf_nan=False)]] = Field(default_factory=dict)


class NavigationPoint(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class SurfaceNavigationRequest(BaseModel):
    origin: NavigationPoint
    destination: NavigationPoint


class SurfaceWorkspaceRequest(SurfaceNavigationRequest):
    profile: str = 'rover_scout'
    overrides: dict[str, Annotated[float, Field(allow_inf_nan=False)]] = Field(default_factory=dict)
    weights: dict[str, Annotated[float, Field(allow_inf_nan=False)]] = Field(default_factory=dict)


@app.post('/api/surface/workspace')
def surface_workspace(req: SurfaceWorkspaceRequest):
    from .surface_workspace import WorkspaceUnavailable, workspace
    try:
        mobility = resolve(req.profile, req.overrides)
    except KeyError:
        raise HTTPException(404, f"Unknown profile '{req.profile}'") from None
    try:
        return workspace(req.origin, req.destination, mobility, req.weights)
    except WorkspaceUnavailable as exc:
        return JSONResponse(status_code=422, content={'detail': str(exc), 'code': exc.code,
                                                     'missingEndpoints': exc.missing_endpoints})
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/surface/navigation")
def surface_navigation(req: SurfaceNavigationRequest):
    try:
        return point_to_point_routes(req.origin.latitude, req.origin.longitude,
                                     req.destination.latitude, req.destination.longitude)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

@app.get("/api/health")
def health() -> dict:
    """Service status and which bundled datasets are installed."""
    return api_platform.health_report()


@app.get("/api/landing")
def landing(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)) -> dict:
    return assessment(latitude, longitude)


@app.get("/api/landing/routes")
def landing_routes(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180)) -> dict:
    return site_routes_or_404(latitude, longitude)


@app.post("/api/landing/routes")
def plan_landing_routes(req: SiteRouteRequest) -> dict:
    try:
        mobility = resolve(req.profile, req.overrides)
    except KeyError:
        raise HTTPException(404, f"Unknown profile '{req.profile}'")
    return site_routes_or_404(req.latitude, req.longitude, mobility, req.weights)


def site_routes_or_404(latitude, longitude, mobility=None, weights=None):
    result = surface_routes(latitude, longitude, mobility, weights)
    if result is None:
        raise HTTPException(404, "Surface routes require coverage within the Jezero CTX map.")
    return result


@app.get("/api/profiles")
def profiles() -> dict:
    return {"profiles": [p.to_dict() for p in PROFILES.values()], "default_weights": DEFAULT_WEIGHTS,
            "gravity_mps2": G_MARS}


@app.get("/api/terrain")
def terrain() -> dict:
    t = get_terrain()
    h, w = t.shape
    return {
        "meta": t.meta, "width": w, "height": h, "cell_size": t.cell_size,
        "elevation": _b64(t.elevation, "<f4"), "slope": _b64(t.slope_deg, "<f4"),
        "roughness": _b64(t.roughness, "<f4"),
        "confidence": _b64(np.round(t.confidence * 255), "u1"),
        "science_sites": t.science_sites, "suggested": _suggest_points(t), "class_names": CLASS_NAMES,
    }


@app.get('/api/terrain/cell')
def inspect_cell(row: int = Query(ge=0), col: int = Query(ge=0), profile: str = 'astronaut_eva', max_slope_deg: float | None = Query(default=None,ge=4,le=40)):
    t = get_terrain()
    if row >= t.shape[0] or col >= t.shape[1]: raise HTTPException(422,'Cell is outside the terrain map.')
    if not t.meta.get('transform'): raise HTTPException(422,'This terrain has no geographic reference.')
    try: mobility = resolve(profile, {'max_slope_deg':max_slope_deg} if max_slope_deg is not None else None)
    except KeyError: raise HTTPException(404,'Unknown mobility profile')
    from rasterio.transform import xy, Affine
    from rasterio.warp import transform
    x,y = xy(Affine(*t.meta['transform']),row,col)
    import rasterio
    crs = rasterio.crs.CRS.from_string(t.meta['crs'])
    lon,lat = transform(crs,crs.geodetic_crs,[x],[y])
    analysis = analyse(t,mobility)
    classification = int(analysis['cls'][row,col])
    slope = float(t.slope_deg[row,col])
    roughness = float(t.roughness[row,col])
    reasons = []
    if classification == 4: reasons.append('Elevation or cell coverage is insufficient.')
    if np.isfinite(slope) and slope > mobility.max_slope_deg: reasons.append(f'Slope {slope:.1f}° exceeds the mobility limit of {mobility.max_slope_deg:.1f}°.')
    if np.isfinite(roughness) and roughness > 1.2: reasons.append(f'High roughness ({roughness:.2f} m RMS) increases mobility difficulty.')
    return {'latitude':lat[0], 'longitude':lon[0], 'region':region_at(lat[0],lon[0]),
            'class':CLASS_NAMES[classification], 'traversable':classification not in (3,4),
            'slope':slope if np.isfinite(slope) else None, 'roughness':roughness if np.isfinite(roughness) else None,
            'reasons':reasons or ['This cell meets the mobility model limits. Calculate a route from A to check connectivity and energy.'],
            'source':t.meta['source'], 'resolution':t.cell_size,
            'limits':'Estimated from elevation. Small rocks, soil strength and current weather are unmeasured.'}


@app.post("/api/routes")
def routes(req: RouteRequest) -> dict:
    t = get_terrain()
    try:
        p = resolve(req.profile, req.overrides)
    except KeyError:
        raise HTTPException(404, f"Unknown profile '{req.profile}'")
    t0 = time.perf_counter()
    try:
        res = plan_routes(t, p, req.start, req.goal, req.weights, [o.model_dump() for o in req.obstacles])
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    ms = (time.perf_counter() - t0) * 1000.0
    an = res["analysis"]
    return {
        "profile": p.to_dict(),
        "weights": res["weights"],
        "routes": res["routes"],
        "explanations": explain(t, p, res["routes"], res["weights"]),
        "layers": {
            "risk": _b64(np.round(np.nan_to_num(an["risk"], nan=1.0) * 255), "u1"),
            "cls": _b64(an["cls"], "u1"),
        },
        "compute_ms": round(ms, 1),
    }


api_platform.finalize(app)
