"""Normalise the Martian_Map_Web_Data pack into compact backend files.

Usage (from the project root):

    python backend/scripts/import_jezero_pack.py "<path>/Martian_Map_Web_Data"

Reads the pack's GeoJSON (Mars lon/lat degrees, never Earth WGS84) and writes
``backend/data/jezero/``:

* ``polygons.npz``  - packed rings for geologic units, surface features, the
  landing ellipse and the map boundary (fast point-in-polygon queries).
* ``geology.json``  - one legend entry per geologic unit with the published
  description, interpretation and map colour.
* ``rover.json``    - Perseverance waypoints, panorama links and traverse.
* ``manifest.json`` - provenance, counts and retrieval date.

Nothing is invented: geometry and attributes are copied, only repacked.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parents[1] / "data" / "jezero"
CITATION = ("Sun, V.Z., and Stack, K.M., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars: "
            "USGS Scientific Investigations Map 3464, scale 1:75,000, https://doi.org/10.3133/sim3464")
ROVER_SOURCE = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"


def read(pack: Path, name: str):
    return json.loads((pack / name).read_text(encoding="utf-8"))


def rings_of(geometry: dict) -> list:
    if geometry["type"] == "Polygon":
        return geometry["coordinates"]
    if geometry["type"] == "MultiPolygon":
        return [ring for polygon in geometry["coordinates"] for ring in polygon]
    raise ValueError(f"Unsupported geometry {geometry['type']}")


def pack_polygons(features: list) -> dict:
    """Flatten polygon features into arrays: coords, ring offsets, feature offsets, bounding boxes."""
    coords, ring_start, feature_ring_start, bbox = [], [0], [0], []
    for feature in features:
        points = []
        for ring in rings_of(feature["geometry"]):
            xy = np.asarray(ring, dtype=np.float64)[:, :2]
            if not np.array_equal(xy[0], xy[-1]):
                xy = np.vstack([xy, xy[:1]])
            coords.append(xy)
            points.append(xy)
            ring_start.append(ring_start[-1] + len(xy))
        feature_ring_start.append(len(ring_start) - 1)
        stacked = np.vstack(points)
        bbox.append([*stacked.min(axis=0), *stacked.max(axis=0)])
    return {"coords": np.vstack(coords), "ring_start": np.asarray(ring_start, dtype=np.int64),
            "feature_ring_start": np.asarray(feature_ring_start, dtype=np.int64),
            "bbox": np.asarray(bbox, dtype=np.float64)}


def main(pack: Path) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = {entry["name"]: entry for entry in read(pack, "data/geology_catalog.json")}

    units = read(pack, "data/usgs_geologic_units.geojson")["features"]
    colours = {info["value"]: info["symbol"]["color"][:3]
               for info in catalog["Geologic Units"]["drawing_info"]["renderer"]["uniqueValueInfos"]}
    legend, order = [], {}
    for feature in units:
        p = feature["properties"]
        if p["symbol"] in order:
            continue
        order[p["symbol"]] = len(legend)
        legend.append({
            "symbol": p["symbol"], "name": p["name"], "unitId": p["unit"],
            "color": "#%02x%02x%02x" % tuple(colours[p["unit"]]) if p["unit"] in colours else None,
            "description": p["Unit_Description"], "characteristics": p["Additional_Characteristics"],
            "interpretation": p["Unit_Interpretation"], "polygonCount": 0,
        })
    unit_index = np.asarray([order[f["properties"]["symbol"]] for f in units], dtype=np.int16)
    for index in unit_index:
        legend[index]["polygonCount"] += 1

    surface = read(pack, "data/usgs_surface_features.geojson")["features"]
    surface_types = sorted({f["properties"]["TYPE"] for f in surface})
    surface_index = np.asarray([surface_types.index(f["properties"]["TYPE"]) for f in surface], dtype=np.int16)
    ellipse = read(pack, "data/usgs_landingellipse.geojson")["features"]
    boundary = read(pack, "data/usgs_mapboundary.geojson")["features"]
    craters = np.asarray([f["geometry"]["coordinates"][:2]
                          for f in read(pack, "data/usgs_location_features.geojson")["features"]], dtype=np.float64)

    arrays = {"unit_index": unit_index, "surface_index": surface_index, "small_craters": craters}
    for prefix, features in (("units", units), ("surface", surface), ("ellipse", ellipse), ("boundary", boundary)):
        for key, value in pack_polygons(features).items():
            arrays[f"{prefix}_{key}"] = value
    np.savez_compressed(OUT / "polygons.npz", **arrays)

    (OUT / "geology.json").write_text(json.dumps({
        "citation": CITATION, "scale": "1:75,000", "units": legend, "surfaceTypes": surface_types,
        "note": "Interpreted regional geologic map. Not an obstacle inventory or a soil-strength measurement.",
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    waypoints = read(pack, "data/perseverance_waypoints.geojson")["features"]
    keep = ("sol", "site", "drive", "elev_geoid", "tilt", "dist_total_m", "Note")
    rover = {
        "source": ROVER_SOURCE, "credit": "NASA/JPL-Caltech · Mars 2020 MMGIS",
        "note": "Recorded rover positions in sequence. The connecting line is not a certified walking route.",
        "waypoints": [{
            "longitude": f["geometry"]["coordinates"][0], "latitude": f["geometry"]["coordinates"][1],
            **{key.lower(): f["properties"].get(key) for key in keep},
            "images": [{"name": image["name"], "url": image["url"], "panoramic": bool(image.get("isPanoramic"))}
                       for image in f["properties"].get("images") or []],
        } for f in waypoints],
    }
    (OUT / "rover.json").write_text(json.dumps(rover, ensure_ascii=False), encoding="utf-8")

    validation = read(pack, "metadata/validation_report.json")
    (OUT / "manifest.json").write_text(json.dumps({
        "pack": "Martian_Map_Web_Data", "imported_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "pack_validated_utc": validation.get("checked_utc"), "pack_validation": validation.get("status"),
        "coordinate_system": "Mars 2000 sphere, planetocentric latitude / east longitude, R = 3,396,190 m",
        "counts": {"geologic_polygons": len(units), "geologic_units": len(legend), "surface_features": len(surface),
                   "small_craters": len(craters), "rover_waypoints": len(waypoints),
                   "rover_images": sum(len(w["images"]) for w in rover["waypoints"])},
        "sources": {"geology": CITATION, "rover": ROVER_SOURCE},
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))["counts"]))


if __name__ == "__main__":
    if len(sys.argv) != 2 or not (Path(sys.argv[1]) / "data" / "usgs_geologic_units.geojson").is_file():
        sys.exit("Pass the path of the Martian_Map_Web_Data folder.")
    main(Path(sys.argv[1]))
