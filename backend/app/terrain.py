"""Terrain model: elevation grid + derived layers.

Two sources are supported:

* ``make_demo_terrain``  - a procedurally generated, clearly labelled SIMULATED
  region used until real NASA data is supplied.
* ``load_geotiff``       - a real Digital Terrain Model (e.g. HiRISE / CTX / MOLA
  GeoTIFF from NASA PDS or USGS Astrogeology).

Everything downstream (slope, roughness, risk, routing) is computed from the
elevation grid only, so swapping the source does not change any other code.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field

import numpy as np
from scipy import ndimage

MARS_RADIUS_M = 3_396_190.0  # IAU mean equatorial radius


@dataclass
class Terrain:
    elevation: np.ndarray  # float32 (H, W), metres, NaN = no data
    confidence: np.ndarray  # float32 (H, W), 0..1 confidence in the terrain data
    cell_size: float  # metres per cell
    meta: dict
    science_sites: list = field(default_factory=list)
    slope_deg: np.ndarray = field(init=False)
    roughness: np.ndarray = field(init=False)

    def __post_init__(self) -> None:
        self.elevation = self.elevation.astype(np.float32)
        self.confidence = self.confidence.astype(np.float32)
        nodata = np.isnan(self.elevation)
        fill = float(np.nanmean(self.elevation)) if (~nodata).any() else 0.0
        z = np.where(nodata, fill, self.elevation).astype(np.float64)

        # Slope: magnitude of the elevation gradient (derived, not measured).
        gy, gx = np.gradient(z, self.cell_size)
        slope = np.degrees(np.arctan(np.hypot(gx, gy)))

        # Roughness: RMS of elevation residual in a 5x5 window (metres).
        resid = z - ndimage.uniform_filter(z, size=5, mode="nearest")
        rough = np.sqrt(np.maximum(ndimage.uniform_filter(resid**2, size=5, mode="nearest"), 0.0))

        # Cells next to missing data have unreliable derivatives.
        near_nodata = ndimage.binary_dilation(nodata, iterations=2)
        slope[nodata] = np.nan
        rough[nodata] = np.nan
        self.confidence = np.where(nodata, 0.0, self.confidence)
        self.confidence = np.where(near_nodata & ~nodata, np.minimum(self.confidence, 0.3), self.confidence).astype(np.float32)
        self.slope_deg = slope.astype(np.float32)
        self.roughness = rough.astype(np.float32)

    @property
    def shape(self) -> tuple[int, int]:
        return self.elevation.shape


def _unit_noise(rng: np.random.Generator, n: int, sigma: float) -> np.ndarray:
    f = ndimage.gaussian_filter(rng.standard_normal((n, n)), sigma, mode="wrap")
    return f / (f.std() + 1e-9)


def make_demo_terrain(n: int = 240, cell: float = 10.0, seed: int = 7) -> Terrain:
    """SIMULATED terrain with crater, scarp, ripple and boulder-like features.

    It is NOT Mars data. It exists so the full pipeline can be developed and
    demonstrated before a real DTM is plugged in.
    """
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)

    z = -2550.0 + 0.015 * cell * x  # gentle regional tilt
    for sigma, amp in ((40, 30.0), (16, 10.0), (6, 3.0), (2, 0.6)):
        z += amp * _unit_noise(rng, n, sigma)

    # Sinuous scarp (steep step) with two gentler ramps through it.
    line = 0.47 * n + 16.0 * np.sin(x / 26.0)
    width_m = 35.0 + 190.0 * np.exp(-(((x - 0.24 * n) / 13.0) ** 2)) + 190.0 * np.exp(-(((x - 0.78 * n) / 10.0) ** 2))
    z += 22.0 * np.tanh((line - y) * cell / width_m)

    # Impact craters: bowl + raised rim.
    for cx, cy, r, depth in ((0.52, 0.72, 13, 30.0), (0.30, 0.25, 9, 20.0), (0.70, 0.30, 11, 26.0), (0.15, 0.62, 6, 12.0), (0.86, 0.60, 7, 15.0)):
        d = np.hypot(x - cx * n, y - cy * n)
        z += np.where(d < r, -depth * (1.0 - (d / r) ** 2), 0.0)
        z += 0.2 * depth * np.exp(-(((d - r) / (0.25 * r)) ** 2))

    # Ripple field (aeolian-bedform-like texture) and a rough blocky patch.
    ripple_mask = np.exp(-(((x - 0.40 * n) / 30.0) ** 2 + ((y - 0.86 * n) / 16.0) ** 2))
    z += 1.3 * ripple_mask * np.sin(2 * np.pi * (0.8 * x + 0.6 * y) * cell / 45.0)
    block_mask = np.exp(-(((x - 0.62 * n) / 18.0) ** 2 + ((y - 0.52 * n) / 14.0) ** 2))
    z += 1.6 * block_mask * rng.standard_normal((n, n))

    # Confidence: high everywhere except one patch standing in for an area
    # without high-resolution stereo coverage.
    conf = np.full((n, n), 0.95)
    conf -= 0.75 * np.exp(-(((x - 0.80 * n) / 22.0) ** 2 + ((y - 0.84 * n) / 18.0) ** 2))
    conf = np.clip(conf + 0.02 * rng.standard_normal((n, n)), 0.05, 1.0)

    sites = [
        {"id": "S1", "name": "Layered scarp exposure", "row": int(0.50 * n), "col": int(0.50 * n), "value": 0.9,
         "rationale": "Steep scarp face: exposed layering is a classic target for reading depositional history."},
        {"id": "S2", "name": "Crater rim outcrop", "row": int(0.30 * n), "col": int(0.58 * n), "value": 0.7,
         "rationale": "Crater rims excavate and uplift deeper material that is otherwise buried."},
        {"id": "S3", "name": "Smooth floor deposits", "row": int(0.20 * n), "col": int(0.86 * n), "value": 0.5,
         "rationale": "Low-roughness plains can preserve fine-grained sediments."},
        {"id": "S4", "name": "Ripple field margin", "row": int(0.80 * n), "col": int(0.30 * n), "value": 0.4,
         "rationale": "Bedform margins record recent wind direction and grain sorting."},
    ]
    for s in sites:
        s["simulated"] = True

    meta = {
        "name": "Demo region (SIMULATED terrain)",
        "simulated": True,
        "source": "Procedurally generated by make_demo_terrain(); not NASA data.",
        "resolution_m": cell,
        "crs": "Local metric grid, no georeference",
        "extent_m": [n * cell, n * cell],
        "layers": {
            "elevation": "SIMULATED",
            "slope": "DERIVED from elevation (gradient magnitude)",
            "roughness": "DERIVED from elevation (RMS residual, 5x5 cells)",
            "confidence": "SIMULATED coverage pattern",
            "risk": "MODEL estimate from slope + roughness for the selected mobility profile",
            "science_sites": "SIMULATED placeholders",
        },
        "limitations": [
            "Terrain is synthetic and only resembles Martian landforms.",
            "Sand, rock abundance and soil strength are not measured; roughness is a proxy.",
        ],
    }
    return Terrain(z, conf, cell, meta, sites)


def load_geotiff(path: str, max_cells: int = 320, sites_path: str | None = None) -> Terrain:
    """Load a real DTM GeoTIFF (band 1 = elevation in metres)."""
    import rasterio
    from rasterio.enums import Resampling

    with rasterio.open(path) as ds:
        scale = max(1, math.ceil(max(ds.width, ds.height) / max_cells))
        out_shape = (max(2, ds.height // scale), max(2, ds.width // scale))
        band = ds.read(1, out_shape=out_shape, resampling=Resampling.average, masked=True)
        z = band.astype(np.float32).filled(np.nan)
        # Guard against sentinel no-data values that were not declared in the file.
        z[(z < -1.0e4) | (z > 3.0e4)] = np.nan
        res_x = abs(ds.transform.a) * ds.width / out_shape[1]
        res_y = abs(ds.transform.e) * ds.height / out_shape[0]
        crs = ds.crs
        bounds = ds.bounds
        if crs is not None and crs.is_geographic:
            lat = math.radians((bounds.top + bounds.bottom) / 2.0)
            res_x = math.radians(res_x) * MARS_RADIUS_M * math.cos(lat)
            res_y = math.radians(res_y) * MARS_RADIUS_M
        native = abs(ds.transform.a)
        working_transform = ds.transform * rasterio.Affine.scale(ds.width/out_shape[1], ds.height/out_shape[0])
        crs_text = crs.to_string() if crs is not None else "unknown (file has no CRS)"

    cell = float((res_x + res_y) / 2.0)
    conf = np.where(np.isnan(z), 0.0, 1.0).astype(np.float32)

    sites: list = []
    if sites_path and os.path.exists(sites_path):
        with open(sites_path, encoding="utf-8") as fh:
            sites = json.load(fh)

    meta = {
        "name": os.path.basename(path),
        "simulated": False,
        "source": f"GeoTIFF DTM: {os.path.basename(path)}",
        "resolution_m": round(cell, 3),
        "native_resolution": native,
        "resampled_by": scale,
        "crs": crs_text,
        "bounds": [bounds.left, bounds.bottom, bounds.right, bounds.top],
        "transform": list(working_transform)[:6],
        "extent_m": [round(z.shape[1] * cell, 1), round(z.shape[0] * cell, 1)],
        "layers": {
            "elevation": "REAL (from supplied DTM)",
            "slope": "DERIVED from elevation (gradient magnitude)",
            "roughness": "DERIVED from elevation (RMS residual, 5x5 cells)",
            "confidence": "Data availability only: 1 where the DTM has a value, 0 where it does not",
            "risk": "MODEL estimate from slope + roughness for the selected mobility profile",
            "science_sites": "From sites file" if sites else "None supplied",
        },
        "limitations": [
            "Hazards smaller than the grid resolution (rocks, sand ripples) cannot be seen.",
            "Sand and soil strength are not measured; roughness is a proxy.",
        ],
    }
    return Terrain(z, conf, cell, meta, sites)


def load_terrain() -> Terrain:
    """Configured DTM, bundled real Jezero crop, then labeled demo fallback."""
    path = os.environ.get("MARS_DEM_PATH")
    if path:
        return load_geotiff(path, int(os.environ.get("MARS_MAX_CELLS", "320")), os.environ.get("MARS_SITES_PATH"))
    from pathlib import Path
    real = Path(__file__).resolve().parents[1] / 'data/jezero-ctx-20m.tif'
    if real.exists():
        import rasterio
        full = load_geotiff(str(real), 640)
        top, left = max(0,(full.shape[0]-240)//2), max(0,(full.shape[1]-240)//2)
        section = np.s_[top:top+240, left:left+240]
        affine = rasterio.Affine(*full.meta['transform']) * rasterio.Affine.translation(left,top)
        meta = {**full.meta, 'name':'Jezero crater · actual CTX elevation',
                'source':'NASA/JPL/USGS Mars 2020 CTX DEM · real elevation, derived hillshade',
                'transform':list(affine)[:6], 'extent_m':[240*full.cell_size,240*full.cell_size]}
        meta['bounds'] = list(rasterio.transform.array_bounds(240,240,affine))
        return Terrain(full.elevation[section],full.confidence[section],full.cell_size,meta)
    return make_demo_terrain()
