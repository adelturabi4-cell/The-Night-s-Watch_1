"""Local MarsPath measurements and official IAU/USGS feature-name lookup."""
import json
from functools import lru_cache
from math import radians, cos
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
PACK = ROOT / 'frontend/public/mars-data'


@lru_cache(maxsize=1)
def names():
    return json.loads((ROOT / 'backend/data/mars-names.json').read_text(encoding='utf-8'))['features']


def region_at(lat, lon):
    features = names()
    phi = np.radians([item['latitude'] for item in features])
    lons = np.array([item['longitude'] for item in features])
    a = np.sin((phi - radians(lat))/2)**2 + cos(radians(lat))*np.cos(phi)*np.sin(np.radians(lons-lon)/2)**2
    distances = 6792.38*np.arcsin(np.sqrt(np.clip(a,0,1)))
    radii = np.array([max(0.1, item['diameter']/2) for item in features])
    inside = distances <= radii
    candidates = np.flatnonzero(inside)
    index = int(candidates[np.argmin(radii[candidates])]) if candidates.size else int(np.argmin(distances))
    item = features[index]
    return {**item, 'distanceKm': round(float(distances[index]),2),
            'match': 'approximate_extent' if inside[index] else 'nearest_named_feature',
            'displayName': item['name'] if inside[index] else 'Near ' + item['name']}


def pack_topography(lat, lon):
    import rasterio
    from rasterio.warp import transform
    from rasterio.windows import Window
    path = PACK / 'mola/elevation.cog.tif'
    if not path.exists(): return None
    with rasterio.open(path) as ds:
        x,y = transform(ds.crs.geodetic_crs, ds.crs, [lon], [lat])
        row,col = ds.index(x[0],y[0])
        col %= ds.width
        row = min(ds.height-1,max(0,row))
        z = ds.read(1,window=Window(col,row,1,1),masked=True)
        if np.ma.is_masked(z[0,0]): return None
        # A regional derivative, never a local hazard/rover assessment.
        if row < 1 or row >= ds.height-1 or abs(lat)>85:
            return float(z[0,0]), None
        west = float(ds.read(1,window=Window((col-1)%ds.width,row,1,1))[0,0])
        east = float(ds.read(1,window=Window((col+1)%ds.width,row,1,1))[0,0])
        north = float(ds.read(1,window=Window(col,row-1,1,1))[0,0])
        south = float(ds.read(1,window=Window(col,row+1,1,1))[0,0])
        if min(west,east,north,south) <= -32768: return float(z[0,0]), None
        slope = np.degrees(np.arctan(np.hypot((east-west)/(2*3705*max(.05,cos(radians(lat)))),(south-north)/7410)))
        return float(z[0,0]), float(slope)


def access_summary(level, slope, roughness, route_available):
    reasons = []
    if level != 'local':
        return {'status':'insufficient_data','label':'Access unconfirmed',
                'reasons':['Regional MOLA elevations cannot resolve small rocks or local obstacles.', 'Detailed elevation coverage is insufficient for a local route at this point.'],
                'limits':'Unknown terrain is not classified as safe.'}
    if slope is not None and slope > 15: reasons.append('Steep local slopes may restrict rover mobility.')
    if roughness is not None and roughness > 1.2: reasons.append('The elevation model indicates rough terrain.')
    if not route_available: reasons.append('This point is close to the edge of terrain coverage.')
    return {'status':'caution' if reasons else 'requires_route','label':'Route assessment required' if reasons else 'Local route assessment available',
            'reasons': reasons or ['Local CTX terrain is available. Calculate a route to check connectivity, energy and slope.'],
            'limits':'Rock abundance, soil strength and live weather are unavailable. This is not a safety guarantee.'}
