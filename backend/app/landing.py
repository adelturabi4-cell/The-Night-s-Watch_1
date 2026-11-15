"""Educational Mars terrain screening from public orbital datasets."""
from functools import lru_cache
from math import atan, ceil, cos, degrees, hypot, radians
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt

from .planner import plan_routes
from .profiles import PROFILES
from .terrain import MARS_RADIUS_M, Terrain, load_geotiff
from .data_catalog import pack_topography, region_at, access_summary

DATA = Path(__file__).resolve().parents[1] / "data"
CTX_SOURCE = "Mars 2020 Jezero CTX DEM, NASA/JPL/USGS · 20 m/pixel"
MOLA_SOURCE = "Mars Global Surveyor MOLA MEGDR · 0.25° (~15 km at equator)"
CRATER_SOURCE = "Robbins & Hynek (2012) · craters ≥1 km"
JEZERO_PATH = DATA / "jezero-ctx-20m.tif"
SCREEN_RADIUS_M = 500


@lru_cache(maxsize=1)
def mola():
    path = DATA / "megt90n000cb.img"
    if not path.is_file() or path.stat().st_size != 720 * 1440 * 2:
        return None
    return np.fromfile(path, dtype=">i2").reshape(720, 1440)


@lru_cache(maxsize=1)
def craters():
    path = DATA / "robbins-craters.npz"
    if not path.is_file():
        return None
    with np.load(path) as data:
        lat, lon, diameter = data["craters"].astype(np.float64).T
    phi = np.radians(lat)
    return lat, lon, diameter, phi, np.cos(phi)


@lru_cache(maxsize=1)
def jezero():
    if not JEZERO_PATH.is_file():
        return None
    import rasterio
    with rasterio.open(JEZERO_PATH) as ds:
        projection = ds.crs
        affine = ds.transform
    terrain = load_geotiff(str(JEZERO_PATH), max_cells=640)
    terrain.meta["source"] = CTX_SOURCE
    return terrain, projection, affine


def local_grid(lat, lon, padding=0):
    region = jezero()
    if region is None:
        return None
    from rasterio.transform import rowcol
    from rasterio.warp import transform
    terrain, crs, affine = region
    x, y = transform(crs.geodetic_crs, crs, [lon], [lat])
    row, column = rowcol(affine, x[0], y[0])
    height, width = terrain.shape
    if not (padding <= row < height - padding and padding <= column < width - padding):
        return None
    if terrain.confidence[row, column] < 0.8:
        return None
    return terrain, crs, affine, row, column


def global_topography(lat, lon):
    packed = pack_topography(lat, lon)
    if packed is not None:
        return packed
    z = mola()
    if z is None:
        return None, None
    y = np.clip((90 - lat) * 4 - 0.5, 0, 719)
    x = (lon % 360) * 4 - 0.5
    row, col = int(y), int(np.floor(x))
    y_fraction, x_fraction = y - row, x - col
    south = min(row + 1, 719)
    west, east = col % 1440, (col + 1) % 1440
    nw, ne, sw, se = map(float, (z[row, west], z[row, east], z[south, west], z[south, east]))
    north_height = nw + (ne - nw) * x_fraction
    south_height = sw + (se - sw) * x_fraction
    height = north_height + (south_height - north_height) * y_fraction
    if row == south or abs(lat) > 85:
        return height, None
    spacing = radians(0.25) * MARS_RADIUS_M
    dx = ((ne - nw) * (1 - y_fraction) + (se - sw) * y_fraction) / (spacing * cos(radians(lat)))
    dy = (south_height - north_height) / spacing
    return height, degrees(atan(hypot(dx, dy)))


def crater_context(lat, lon):
    data = craters()
    if data is None:
        return None, None
    lats, lons, diameter, phi, cos_phi = data
    query_phi = radians(lat)
    a = np.sin((phi - query_phi) / 2) ** 2 + cos(query_phi) * cos_phi * np.sin(np.radians(lons - lon) / 2) ** 2
    distances = 2 * MARS_RADIUS_M / 1000 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
    count = int(np.count_nonzero(distances <= 50))
    major = diameter >= 5
    rim_distance = distances - diameter / 2
    idx = int(np.argmin(np.where(major, np.abs(rim_distance), np.inf)))
    return count, {
        "latitude": float(lats[idx]), "longitude": float(lons[idx]), "diameterKm": float(diameter[idx]),
        "rimDistanceKm": round(float(abs(rim_distance[idx])), 2), "inside": bool(rim_distance[idx] < 0),
    }


def assessment(lat, lon):
    elevation, slope = global_topography(lat, lon)
    roughness = zone = access = None
    terrain_source = 'MarsPath MOLA MEGT90N000EB COG · 3,705 m/pixel' if pack_topography(lat, lon) is not None else MOLA_SOURCE
    level = "regional"
    sample = local_grid(lat, lon, padding=26)
    if sample is None:
        from .terrain_api import available_point_sample as point_sample, TerrainCoverageError
        try:
            sample = point_sample(lat, lon)
        except TerrainCoverageError:
            pass
    # Screening requires a complete 500 m neighborhood around the selection.
    if sample:
        t, _, _, r, c = sample
        margin = max(1, int(SCREEN_RADIUS_M / t.cell_size))
        if not (margin <= r < t.shape[0] - margin and margin <= c < t.shape[1] - margin):
            sample = None
    if sample:
        terrain, _, _, row, col = sample
        elevation = float(terrain.elevation[row, col])
        radius = int(SCREEN_RADIUS_M / terrain.cell_size)
        section = np.s_[row - radius:row + radius + 1, col - radius:col + radius + 1]
        rr, cc = np.ogrid[-radius:radius + 1, -radius:radius + 1]
        disk = rr**2 + cc**2 <= radius**2
        valid = disk & (terrain.confidence[section] >= 0.8)
        slope_grid = terrain.slope_deg[section]
        if np.count_nonzero(valid) >= 0.95 * np.count_nonzero(disk):
            level = "local"
            terrain_source = terrain.meta.get("source", CTX_SOURCE)
            slope = float(np.percentile(slope_grid[valid], 90))
            roughness = float(np.sqrt(np.mean(terrain.roughness[section][valid] ** 2)))
            gentle = valid & (slope_grid <= 8)
            clearance = distance_transform_edt(np.pad(gentle, 1))[radius + 1, radius + 1]
            zone = max(0.0, float((clearance - 0.5) * terrain.cell_size * 2))
            near = rr**2 + cc**2 <= (250 / terrain.cell_size) ** 2
            access = float(np.count_nonzero(near & valid & (slope_grid <= 15)) / np.count_nonzero(near))
        else:
            elevation, _ = global_topography(lat, lon)
    count, hazard = crater_context(lat, lon)
    density = count * 1000 / (np.pi * 50**2) if count is not None else None

    def factor(key, value, unit, rating, detail, source):
        return {"key": key, "value": round(value, 3) if value is not None else None, "unit": unit,
                "score": round(float(np.clip(rating, 0, 100))) if rating is not None else None,
                "detail": detail, "source": source}

    return {
        "level": level, "routeAvailable": sample is not None,
        "elevationLookup": _lookup_status(lat, lon, sample),
        "resolutionM": sample[0].cell_size if level == 'local' else (3705 if 'MarsPath' in terrain_source else 14820),
        "region": region_at(lat, lon),
        "accessibility": access_summary(level, slope, roughness, sample is not None),
        "craterCount": count, "hazard": hazard,
        "factors": [
            factor("elevation", elevation, "m", None,
                   "Elevation relative to the Mars datum. Mission-specific atmospheric limits are needed to score it.", terrain_source),
            factor("slope", slope, "°", 100 * (1 - slope / (20 if level == "local" else 8)) if slope is not None else None,
                   "90th percentile within 500 m. Educational scale maps 0–20° to 100–0." if level == "local"
                   else "Slope across MOLA grid cells. Regional scale maps 0–8° to 100–0.", terrain_source),
            factor("rocks", None, "%", None, "Requires a calibrated rock-abundance layer at the site.", None),
            factor("craters", density, " / 1,000 km²", 100 * (1 - density / 60) if density is not None else None,
                   "Catalogued craters ≥1 km within 50 km. Educational scale maps 0–60 per 1,000 km² to 100–0.", CRATER_SOURCE),
            factor("roughness", roughness, "m RMS", 100 * (1 - roughness / 8) if roughness is not None else None,
                   "RMS terrain residual at the source grid scale. Educational scale maps 0–8 m to 100–0."
                   if level == "local" else "A higher-resolution terrain model is required.", terrain_source if level == "local" else None),
            factor("zone", zone, "m diameter", zone / 5 if zone is not None else None,
                   "Estimated circle centered on the selection, constrained by cells ≤8° within 500 m. Diameters ≥500 m score 100."
                   if level == "local" else "Landing-scale elevation coverage is required.", terrain_source if level == "local" else None),
            factor("hazard", hazard["rimDistanceKm"] if hazard else None, "km", None,
                   "Distance to nearest modeled circular rim of a catalogued crater ≥5 km. Rim shape and smaller hazards are unresolved.",
                   CRATER_SOURCE if hazard else None),
            factor("access", access * 100 if access is not None else None, "%", access * 100 if access is not None else None,
                   "Share of cells within 250 m with slope ≤15°. Connectivity, traction and rover limits require a separate study."
                   if level == "local" else "A higher-resolution terrain model is required.", terrain_source if level == "local" else None),
        ],
    }


def _lookup_status(lat, lon, sample):
    from .terrain_api import point_lookup_status
    return {'status': 'ready'} if sample else point_lookup_status(lat, lon)


def surface_routes(lat, lon, mobility=None, weights=None):
    from rasterio.transform import xy
    from rasterio.warp import transform

    sample = local_grid(lat, lon, padding=55)
    if sample is None:
        from .terrain_api import available_point_sample as point_sample, TerrainCoverageError
        try:
            sample = point_sample(lat, lon)
        except TerrainCoverageError:
            return None
    if sample is None:
        return None
    terrain, crs, affine, row, col = sample
    radius = 55
    top, left = max(0, row - radius), max(0, col - radius)
    bottom, right = min(terrain.shape[0], row + radius + 1), min(terrain.shape[1], col + radius + 1)
    section = np.s_[top:bottom, left:right]
    local = Terrain(terrain.elevation[section], terrain.confidence[section], terrain.cell_size, terrain.meta)
    start = (int(row - top), int(col - left))
    mobility = mobility or PROFILES["rover_scout"]
    rr, cc = np.indices(local.shape)
    distance = np.hypot(rr - start[0], cc - start[1]) * local.cell_size
    # Use a common comparison waypoint about 800 m away on mapped, gently sloped ground.
    eligible = (distance >= 700) & (distance <= 900) & (local.confidence > 0.8)
    eligible &= local.slope_deg <= min(12, mobility.max_slope_deg)
    options = np.argwhere(eligible)
    if not len(options):
        return {"routes": {}, "waypoint": None, "reason": "No mapped gentle comparison waypoint was found 700–900 m away."}
    ordering = np.argsort(np.abs(distance[eligible] - 800) + local.slope_deg[eligible] * 10)
    candidates = options[ordering]
    goal = tuple(map(int, candidates[0]))
    planned = plan_routes(local, mobility, start, goal, weights)["routes"]

    def coordinates(path):
        rows, cols = np.asarray(path).T
        x, y = xy(affine, rows + top, cols + left)
        lng, phi = transform(crs, crs.geodetic_crs, x, y)
        return [[round(a, 7), round(b, 7)] for a, b in zip(phi, lng)]

    routes = {}
    for key, route in planned.items():
        if route["status"] == "ok":
            routes[key] = {"points": coordinates(route["path"]), "metrics": route["metrics"]}
    return {
        "routes": routes, "waypoint": coordinates([goal])[0],
        "reason": None if routes else planned["optimal"]["reason"],
    }


def point_to_point_routes(start_lat, start_lon, end_lat, end_lon, mobility=None, weights=None):
    """Use the same elevation provider and routes as the phase-three workspace."""
    import base64
    from types import SimpleNamespace
    from .surface_workspace import workspace
    result = workspace(SimpleNamespace(latitude=start_lat, longitude=start_lon),
                       SimpleNamespace(latitude=end_lat, longitude=end_lon),
                       mobility or PROFILES['rover_scout'], weights or {})
    if result['terrain']['suggested']['start'] == result['terrain']['suggested']['goal']:
        raise ValueError('Choose a destination in a different terrain cell.')
    width = result['terrain']['width']
    latitude = np.frombuffer(base64.b64decode(result['geography']['latitude']), dtype='<f4')
    longitude = np.frombuffer(base64.b64decode(result['geography']['longitude']), dtype='<f4')
    routes = {}
    for key, route in result['result']['routes'].items():
        if route['status'] == 'ok':
            indices = [r * width + c for r, c in route['path']]
            routes[key] = {'points': [[round(float(latitude[i]), 7), round(float(longitude[i]), 7)] for i in indices],
                           'metrics': route['metrics']}
    return {'routes': routes, 'waypoint': [end_lat, end_lon],
            'reason': None if routes else next((r.get('reason') for r in result['result']['routes'].values() if r.get('reason')), 'No traversable route within this elevation window.')}
