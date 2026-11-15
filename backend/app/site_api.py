"""HTTP routes for site intelligence and the Jezero data pack."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from . import jezero as pack
from .profiles import resolve
from .site_intel import site_report

router = APIRouter(tags=["site"])


def _pack_or_503(value):
    if value is None:
        raise HTTPException(503, "Jezero data pack is not installed. Run backend/scripts/import_jezero_pack.py.")
    return value


@router.get("/api/site")
def site(latitude: float = Query(ge=-90, le=90), longitude: float = Query(ge=-180, le=180),
         profile: str = "astronaut_eva", max_slope_deg: float | None = Query(default=None, ge=4, le=40)) -> dict:
    """Everything known about one coordinate, with a go / caution / no-go / unknown verdict."""
    try:
        mobility = resolve(profile, {"max_slope_deg": max_slope_deg} if max_slope_deg is not None else None)
    except KeyError:
        raise HTTPException(404, f"Unknown profile '{profile}'") from None
    return site_report(latitude, longitude, mobility)


@router.get("/api/jezero/rover")
def rover() -> dict:
    """Recorded Perseverance positions for map overlays."""
    return _pack_or_503(pack.rover_track())


@router.get("/api/jezero/geology")
def geology() -> dict:
    """Legend of USGS SIM 3464 geologic units with descriptions and colours."""
    return _pack_or_503(pack.legend())


@router.get("/api/jezero/manifest")
def manifest() -> dict:
    """Provenance and counts of the imported pack."""
    return _pack_or_503(pack.manifest())
