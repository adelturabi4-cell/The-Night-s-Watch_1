"""Bounded, cached elevation windows from the public USGS Mars STAC API.

Only numeric, geoid-adjusted CTX DTMs are accepted. Orbital photographs and
hillshades are never interpreted as elevations. Missing pixels stay missing.
"""
from functools import lru_cache
from hashlib import sha256
import json
import logging
from pathlib import Path
from threading import Lock
from concurrent.futures import ThreadPoolExecutor
import time
from urllib.parse import urlencode, urlparse
from urllib.request import urlopen

import numpy as np
import rasterio
from rasterio.transform import rowcol
from rasterio.warp import transform
from rasterio.windows import Window

from .terrain import Terrain

CATALOG = 'https://stac.astrogeology.usgs.gov/api'
COLLECTION = 'mro_ctx_controlled_usgs_dtms'
DOCUMENTATION = 'https://stac.astrogeology.usgs.gov/docs/data/mars/ctxdtms/'
CACHE = Path(__file__).resolve().parents[1] / 'data/terrain-cache'
PRODUCTS = CACHE.parent / 'ctx-products'
SOURCE = 'NASA / USGS · CTX stereo elevation'
MAX_SIDE = 300
_lock = Lock()
log = logging.getLogger(__name__)
_point_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='mars-elevation')
_point_jobs = {}
_point_lock = Lock()


class TerrainCoverageError(ValueError):
    pass


class TerrainWindowTooLarge(TerrainCoverageError):
    pass


@lru_cache(maxsize=128)
def _catalog(bounds, hour):
    query = urlencode({'collections': COLLECTION, 'bbox': ','.join(map(str, bounds)), 'limit': 12})
    with urlopen(f'{CATALOG}/search?{query}', timeout=10) as response:
        data = json.load(response)
    return data.get('features', [])


def candidates(points):
    """Search a slightly wider bbox; the raster mask is the final authority."""
    lats, lons = zip(*points)
    if max(lons) - min(lons) > 180:
        raise TerrainCoverageError('Choose endpoints on the same side of the longitude seam.')
    bounds = (max(-180, min(lons) - .02), max(-90, min(lats) - .02),
              min(180, max(lons) + .02), min(90, max(lats) + .02))
    try:
        return _catalog(bounds, int(time.time() // 3600))
    except Exception as error:
        log.warning('USGS terrain catalog unavailable: %s', error)
        raise TerrainCoverageError('The USGS elevation service could not be reached. Retry when the connection is available.') from error


def asset_url(item):
    href = item.get('assets', {}).get('geoid_adjusted_dem', {}).get('href', '')
    parsed = urlparse(href)
    # Catalog URLs are external input. Never allow arbitrary server-side reads.
    if (parsed.scheme != 'https' or parsed.netloc not in
            {'astrogeo-ard.s3-us-west-2.amazonaws.com', 'astrogeo-ard.s3.amazonaws.com'}
            or not parsed.path.startswith('/mars/mro/ctx/controlled/usgs/')
            or not parsed.path.endswith('-DEM-geoid-adj.tif') or parsed.query):
        raise TerrainCoverageError('The catalog did not return a supported numeric elevation asset.')
    return href


def _read_window(item, points):
    href = asset_url(item)
    cache_key = sha256(json.dumps([href, points], sort_keys=True).encode()).hexdigest()
    path = CACHE / f'{cache_key}.tif'
    # Disk windows remain usable offline and have a finite total cache size.
    with _lock:
        if path.exists():
            return _load(path, points)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', GDAL_HTTP_TIMEOUT='10',
                      GDAL_HTTP_CONNECTTIMEOUT='5', GDAL_HTTP_MAX_RETRY='0',
                      CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif'):
        installed = PRODUCTS / f'{sha256(href.encode()).hexdigest()}.tif'
        with rasterio.open(installed if installed.is_file() else href) as ds:
            if ds.crs is None or ds.crs.is_geographic or not 15 <= abs(ds.transform.a) <= 40:
                raise TerrainCoverageError('The elevation model has an unsupported projection or resolution.')
            xs, ys = transform(ds.crs.geodetic_crs, ds.crs, [p[1] for p in points], [p[0] for p in points])
            rows, cols = rowcol(ds.transform, xs, ys)
            if any(not (0 <= r < ds.height and 0 <= c < ds.width) for r, c in zip(rows, cols)):
                return None
            top, left = max(0, min(rows) - 40), max(0, min(cols) - 40)
            bottom, right = min(ds.height, max(rows) + 41), min(ds.width, max(cols) + 41)
            if max(bottom - top, right - left) > MAX_SIDE:
                raise TerrainWindowTooLarge('The detailed planning window is limited to 300 terrain cells. Choose closer endpoints.')
            window = Window(left, top, right - left, bottom - top)
            band = ds.read(1, window=window, masked=True).astype('float32').filled(np.nan)
            band[(band < -10000) | (band > 30000)] = np.nan
            if any(not np.isfinite(band[r - top, c - left]) for r, c in zip(rows, cols)):
                return None
            affine = ds.window_transform(window)
            profile = dict(driver='GTiff', width=band.shape[1], height=band.shape[0], count=1,
                           dtype='float32', crs=ds.crs, transform=affine, nodata=np.nan, compress='deflate')
            with _lock:
                CACHE.mkdir(parents=True, exist_ok=True)
                with rasterio.open(path, 'w', **profile) as out:
                    out.write(band, 1)
                    out.update_tags(product_id=item['id'], asset_url=href, fetched_at=str(time.time()))
                for expired in sorted(CACHE.glob('*.tif'), key=lambda p: p.stat().st_mtime)[:-96]:
                    expired.unlink(missing_ok=True)
    return _load(path, points)


def _load(path, points):
    with rasterio.open(path) as ds:
        crs, affine, tags = ds.crs, ds.transform, ds.tags()
        xs, ys = transform(crs.geodetic_crs, crs, [p[1] for p in points], [p[0] for p in points])
        rows, cols = rowcol(affine, xs, ys)
        if any(not (0 <= r < ds.height and 0 <= c < ds.width) for r, c in zip(rows, cols)):
            return None
        z = ds.read(1, masked=True).filled(np.nan)
    cell = abs(affine.a)
    meta = {'name': 'Selected Mars terrain', 'source': SOURCE, 'simulated': False,
            'resolution_m': cell, 'native_resolution': cell, 'transform': list(affine)[:6],
            'crs': str(crs), 'extent_m': [z.shape[1] * cell, z.shape[0] * cell],
            'provider': 'USGS STAC', 'product_id': tags['product_id'], 'asset_url': tags['asset_url'],
            'source_url': DOCUMENTATION, 'fetched_at': tags['fetched_at'],
            'layers': {'elevation': 'Real geoid-adjusted CTX elevation',
                       'slope': 'Derived from elevation', 'roughness': 'Derived RMS elevation residual',
                       'confidence': 'Valid elevation coverage, not a safety probability',
                       'risk': 'Mobility model estimate'},
            'limitations': ['Orbital stereo elevation; small rocks, soil strength and live weather are not measured.']}
    terrain = Terrain(z, np.isfinite(z).astype('float32'), cell, meta)
    if any(terrain.confidence[r, c] < .8 for r, c in zip(rows, cols)):
        return None
    return terrain, crs, affine, list(zip(map(int, rows), map(int, cols)))


def cached_window(points):
    """Read installed elevation only. This function never opens a network URL."""
    with _lock:
        paths = list(CACHE.glob('*.tif')) if CACHE.exists() else []
    for path in paths:
        try:
            result = _load(path, points)
            if result:
                return result
        except (IndexError, KeyError, ValueError, rasterio.errors.RasterioError):
            continue
    registry = PRODUCTS / 'catalog.json'
    if registry.exists():
        try:
            items = json.loads(registry.read_text(encoding='utf-8'))
        except (ValueError, OSError):
            items = []
        for item in items:
            try:
                href = asset_url(item)
                if not (PRODUCTS / f'{sha256(href.encode()).hexdigest()}.tif').is_file():
                    continue
                result = _read_window(item, points)
                if result:
                    return result
            except (TerrainCoverageError, rasterio.errors.RasterioError, OSError):
                continue
    return None


def remote_window(points):
    """Return one real DEM covering every endpoint; never stitch across holes."""
    if len(points) > 1:
        lats, lons = zip(*points)
        if max(lats) - min(lats) > .2 or max(lons) - min(lons) > .2:
            raise TerrainWindowTooLarge('These endpoints are too far apart for detailed CTX routing. Choose A and B within about 6 km of each other (the local planning window is 300 cells of 20 m).')
    cached = cached_window(points)
    if cached:
        return cached
    items = candidates(points)
    errors = []
    # A bounded number of remote COGs keeps failed requests responsive.
    for item in items[:4]:
        try:
            result = _read_window(item, points)
            if result:
                return result
        except TerrainWindowTooLarge:
            raise
        except (TerrainCoverageError, rasterio.errors.RasterioError, OSError) as error:
            errors.append(str(error))
    if errors:
        raise TerrainCoverageError(errors[0])
    return None


def point_sample(lat, lon):
    result = remote_window([(lat, lon)])
    if result:
        terrain, crs, affine, cells = result
        return terrain, crs, affine, *cells[0]
    return None


def available_point_sample(lat, lon):
    """Return installed data immediately; queue missing CTX coverage in the background."""
    result = cached_window([(lat, lon)])
    if result:
        terrain, crs, affine, cells = result
        return terrain, crs, affine, *cells[0]
    key = (lat, lon)
    with _point_lock:
        previous = _point_jobs.get(key)
        if previous is None or (previous[0].done() and time.monotonic() - previous[1] > 600):
            if sum(not job.done() for job, _ in _point_jobs.values()) < 12:
                _point_jobs[key] = (_point_pool.submit(point_sample, lat, lon), time.monotonic())
        if len(_point_jobs) > 128:
            for old in list(_point_jobs):
                if old != key and _point_jobs[old][0].done():
                    del _point_jobs[old]
                    if len(_point_jobs) <= 128:
                        break
    return None


def point_lookup_status(lat, lon):
    with _point_lock:
        item = _point_jobs.get((lat, lon))
    if item is None:
        return {'status': 'idle'}
    future = item[0]
    if not future.done():
        return {'status': 'pending'}
    try:
        return {'status': 'ready' if future.result() is not None else 'not_available'}
    except Exception:
        return {'status': 'unavailable'}
