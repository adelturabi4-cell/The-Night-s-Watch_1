"""Read-only repository for the Jezero data pack (USGS SIM 3464 + Mars 2020 MMGIS).

Files are produced by ``backend/scripts/import_jezero_pack.py``. All coordinates
are Mars planetocentric latitude / east longitude in degrees. Every lookup
returns ``None`` when the point is outside the mapped area: absence of data is
never reported as a measurement.
"""
from __future__ import annotations

import json
from functools import lru_cache
from math import cos, radians
from pathlib import Path

import numpy as np

from .terrain import MARS_RADIUS_M

DATA = Path(__file__).resolve().parents[1] / "data" / "jezero"
IMAGE_MATCH_M = 25.0  # a panorama is "at" the selection only within this distance


class PolygonSet:
    """Packed polygons with bounding-box prefilter and even-odd ray casting."""

    def __init__(self, arrays, prefix: str) -> None:
        self.coords = arrays[f"{prefix}_coords"]
        self.ring_start = arrays[f"{prefix}_ring_start"]
        self.feature_ring_start = arrays[f"{prefix}_feature_ring_start"]
        self.bbox = arrays[f"{prefix}_bbox"]

    def __len__(self) -> int:
        return len(self.bbox)

    def _contains(self, feature: int, lon: float, lat: float) -> bool:
        inside = False
        for ring in range(self.feature_ring_start[feature], self.feature_ring_start[feature + 1]):
            xy = self.coords[self.ring_start[ring]:self.ring_start[ring + 1]]
            x1, y1, x2, y2 = xy[:-1, 0], xy[:-1, 1], xy[1:, 0], xy[1:, 1]
            spans = (y1 > lat) != (y2 > lat)
            if not spans.any():
                continue
            crossing = x1[spans] + (lat - y1[spans]) * (x2[spans] - x1[spans]) / (y2[spans] - y1[spans])
            if np.count_nonzero(lon < crossing) % 2:
                inside = not inside
        return inside

    def find(self, lat: float, lon: float) -> int | None:
        """Index of the smallest polygon containing the point, or None."""
        b = self.bbox
        hits = np.flatnonzero((b[:, 0] <= lon) & (lon <= b[:, 2]) & (b[:, 1] <= lat) & (lat <= b[:, 3]))
        area = (b[hits, 2] - b[hits, 0]) * (b[hits, 3] - b[hits, 1])
        for feature in hits[np.argsort(area)]:
            if self._contains(int(feature), lon, lat):
                return int(feature)
        return None


@lru_cache(maxsize=1)
def _store() -> dict | None:
    if not (DATA / "polygons.npz").is_file():
        return None
    with np.load(DATA / "polygons.npz") as arrays:
        loaded = {key: arrays[key] for key in arrays.files}
    geology = json.loads((DATA / "geology.json").read_text(encoding="utf-8"))
    rover = json.loads((DATA / "rover.json").read_text(encoding="utf-8"))
    waypoints = rover["waypoints"]
    return {
        "units": PolygonSet(loaded, "units"), "surface": PolygonSet(loaded, "surface"),
        "ellipse": PolygonSet(loaded, "ellipse"), "boundary": PolygonSet(loaded, "boundary"),
        "unit_index": loaded["unit_index"], "surface_index": loaded["surface_index"],
        "small_craters": loaded["small_craters"], "geology": geology, "rover": rover,
        "waypoint_lon": np.asarray([w["longitude"] for w in waypoints]),
        "waypoint_lat": np.asarray([w["latitude"] for w in waypoints]),
        "manifest": json.loads((DATA / "manifest.json").read_text(encoding="utf-8")),
    }


def available() -> bool:
    return _store() is not None


def distance_m(lat: float, lon: float, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Great-circle distance on the Mars sphere (never an Earth radius)."""
    p1, p2 = radians(lat), np.radians(lats)
    a = np.sin((p2 - p1) / 2) ** 2 + cos(p1) * np.cos(p2) * np.sin(np.radians(lons - lon) / 2) ** 2
    return 2 * MARS_RADIUS_M * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def in_map(lat: float, lon: float) -> bool:
    store = _store()
    return store is not None and store["boundary"].find(lat, lon) is not None


def in_landing_ellipse(lat: float, lon: float) -> bool | None:
    store = _store()
    if store is None or not in_map(lat, lon):
        return None
    return store["ellipse"].find(lat, lon) is not None


def geologic_unit_at(lat: float, lon: float) -> dict | None:
    store = _store()
    if store is None or not in_map(lat, lon):
        return None
    feature = store["units"].find(lat, lon)
    if feature is None:
        return None
    geology = store["geology"]
    return {**geology["units"][int(store["unit_index"][feature])], "scale": geology["scale"],
            "citation": geology["citation"], "note": geology["note"]}


def surface_feature_at(lat: float, lon: float) -> str | None:
    store = _store()
    if store is None or not in_map(lat, lon):
        return None
    feature = store["surface"].find(lat, lon)
    return None if feature is None else store["geology"]["surfaceTypes"][int(store["surface_index"][feature])]


def small_craters_near(lat: float, lon: float, radius_m: float = 300.0) -> dict | None:
    """Mapped 200-500 m craters (USGS location features) near the point."""
    store = _store()
    if store is None or not in_map(lat, lon):
        return None
    points = store["small_craters"]
    distances = distance_m(lat, lon, points[:, 1], points[:, 0])
    return {"count": int(np.count_nonzero(distances <= radius_m)), "radiusM": radius_m,
            "nearestM": round(float(distances.min()), 1)}


def nearest_waypoint(lat: float, lon: float, max_m: float = 60_000.0) -> dict | None:
    """Closest recorded Perseverance position, with the distance made explicit."""
    store = _store()
    if store is None:
        return None
    distances = distance_m(lat, lon, store["waypoint_lat"], store["waypoint_lon"])
    index = int(np.argmin(distances))
    if distances[index] > max_m:
        return None
    waypoint = store["rover"]["waypoints"][index]
    separation = float(distances[index])
    return {**waypoint, "index": index, "distanceM": round(separation, 1),
            "imageAtSelection": bool(waypoint["images"]) and separation <= IMAGE_MATCH_M,
            "credit": store["rover"]["credit"], "disclaimer": store["rover"]["note"]}


def rover_track() -> dict | None:
    """Compact traverse for map overlays: [lat, lon, sol] per recorded position."""
    store = _store()
    if store is None:
        return None
    rover = store["rover"]
    return {"credit": rover["credit"], "source": rover["source"], "note": rover["note"],
            "points": [[w["latitude"], w["longitude"], w["sol"]] for w in rover["waypoints"]]}


def legend() -> dict | None:
    store = _store()
    return None if store is None else store["geology"]


def manifest() -> dict | None:
    store = _store()
    return None if store is None else store["manifest"]
