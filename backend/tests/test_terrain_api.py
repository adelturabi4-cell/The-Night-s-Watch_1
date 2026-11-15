"""Real GeoTIFF windows with mocked transport; no internet required."""
from types import SimpleNamespace

import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.transform import from_origin, xy
from rasterio.warp import transform

from app import terrain_api as api
from app.profiles import PROFILES
from app.surface_workspace import workspace


@pytest.fixture
def dem(tmp_path, monkeypatch):
    path = tmp_path / 'source.tif'
    crs = CRS.from_string('+proj=eqc +R=3396190 +units=m +no_defs')
    affine = from_origin(100000, 200000, 20, 20)
    z = np.zeros((400, 400), dtype='float32') + 120
    z[100:110, 100:110] = np.nan
    with rasterio.open(path, 'w', driver='GTiff', height=400, width=400, count=1,
                       dtype='float32', crs=crs, transform=affine, nodata=np.nan) as ds:
        ds.write(z, 1)
    href = 'https://astrogeo-ard.s3-us-west-2.amazonaws.com/mars/mro/ctx/controlled/usgs/test/test-DEM-geoid-adj.tif'
    item = {'id': 'official-test-product', 'assets': {'geoid_adjusted_dem': {'href': href}}}
    real_open = rasterio.open
    monkeypatch.setattr(api, 'CACHE', tmp_path / 'cache')
    monkeypatch.setattr(api, 'PRODUCTS', tmp_path / 'products')
    monkeypatch.setattr(api, 'candidates', lambda points: [item])
    calls = []

    def open_raster(source, *args, **kwargs):
        if source == href:
            calls.append(source)
            return real_open(path, *args, **kwargs)
        return real_open(source, *args, **kwargs)

    monkeypatch.setattr(api.rasterio, 'open', open_raster)

    def point(row, col):
        x, y = xy(affine, row, col)
        lon, lat = transform(crs, crs.geodetic_crs, [x], [y])
        return lat[0], lon[0]
    return point, calls


def test_numeric_window_preserves_resolution_provenance_and_offline_cache(dem, monkeypatch):
    point, calls = dem
    points = [point(200, 200), point(210, 210)]
    terrain, _, _, cells = api.remote_window(points)
    assert terrain.cell_size == 20 and terrain.meta['simulated'] is False
    assert terrain.meta['product_id'] == 'official-test-product'
    assert terrain.elevation[cells[0]] == 120
    assert max(terrain.shape) <= 300 and len(calls) == 1
    monkeypatch.setattr(api, 'candidates', lambda points: pytest.fail('cache should work offline'))
    cached = api.remote_window(points)
    assert cached[3] == cells and len(calls) == 1


def test_missing_pixels_are_not_filled_or_reported_as_traversable(dem):
    point, _ = dem
    assert api.remote_window([point(105, 105)]) is None


def test_cached_pixels_cannot_wrap_to_a_different_location(dem):
    point, calls = dem
    api.remote_window([point(200, 200)])
    second = api.remote_window([point(50, 50)])
    assert second is not None and len(calls) == 2
    assert second[0].shape[0] > 40


def test_large_windows_fail_before_reading_unbounded_elevation(dem):
    point, _ = dem
    with pytest.raises(api.TerrainWindowTooLarge):
        api.remote_window([point(20, 20), point(380, 380)])


@pytest.mark.parametrize('href', [
    'http://localhost/private.tif',
    'https://astrogeo-ard.s3.amazonaws.com/other/test-DEM-geoid-adj.tif',
    'https://astrogeo-ard.s3.amazonaws.com/mars/mro/ctx/controlled/usgs/test-hs.tif',
    'https://astrogeo-ard.s3.amazonaws.com:8080/mars/mro/ctx/controlled/usgs/a-DEM-geoid-adj.tif',
])
def test_only_official_numeric_elevation_assets_are_accepted(href):
    with pytest.raises(api.TerrainCoverageError):
        api.asset_url({'assets': {'geoid_adjusted_dem': {'href': href}}})


def test_remote_terrain_drives_phase_three_without_changing_endpoints(dem, monkeypatch):
    point, _ = dem
    monkeypatch.setattr('app.surface_workspace.local_grid', lambda *args: None)
    start, end = point(200, 200), point(210, 210)
    result = workspace(SimpleNamespace(latitude=start[0], longitude=start[1]),
                       SimpleNamespace(latitude=end[0], longitude=end[1]), PROFILES['rover_scout'], {})
    assert result['terrain']['meta']['provider'] == 'USGS STAC'
    assert all(route['status'] == 'ok' for route in result['result']['routes'].values())
    assert all(route['verdict']['status'] == 'go' for route in result['result']['routes'].values())
    assert result['terrain']['suggested']['start'] != result['terrain']['suggested']['goal']


def test_service_failure_is_not_reported_as_unsafe_terrain(monkeypatch):
    def fail(points):
        raise api.TerrainCoverageError('USGS is temporarily unavailable.')
    monkeypatch.setattr('app.site_intel.point_sample', lambda *args: fail(args))
    from app.site_intel import site_report
    report = site_report(0, 0, PROFILES['rover_scout'])
    assert report['verdict']['status'] == 'unknown'
    assert 'elevation_service_unavailable' in [r['code'] for r in report['verdict']['reasons']]


def test_external_elevation_is_shared_by_site_details_and_landing_screening(dem):
    from app.site_intel import site_report
    from app.landing import assessment
    point, _ = dem
    lat, lon = point(200, 200)
    api.point_sample(lat, lon)  # Install first; normal point reports never wait on a remote read.
    report = site_report(lat, lon, PROFILES['rover_scout'])
    screening = assessment(lat, lon)
    assert report['terrain']['source'] == api.SOURCE
    assert report['terrain']['productId'] == 'official-test-product'
    assert report['terrain']['resolutionM'] == screening['resolutionM'] == 20
    assert report['routeAvailable'] and screening['routeAvailable']
    assert report['verdict']['status'] == 'go' and screening['level'] == 'local'
    assert all('Jezero' not in (r['source'] or '') for r in report['verdict']['reasons'])


def test_remote_comparison_routes_share_the_landing_coverage(dem):
    from app.landing import surface_routes
    point, _ = dem
    api.point_sample(*point(200, 200))
    result = surface_routes(*point(200, 200), PROFILES['rover_scout'])
    assert result is not None and result['routes']
    assert result['waypoint'] is not None


def test_local_data_are_returned_while_extra_elevation_is_still_loading(monkeypatch):
    from threading import Event
    from app.site_intel import site_report
    from app.landing import global_topography
    release = Event()
    key = (-44.12345, 90.45678)
    def slow_remote(*args):
        release.wait(4)
        return None
    monkeypatch.setattr(api, 'cached_window', lambda points: None)
    monkeypatch.setattr(api, 'point_sample', slow_remote)
    monkeypatch.setattr('app.site_intel.point_sample', api.available_point_sample)
    try:
        report = site_report(*key, PROFILES['rover_scout'])
        assert report['elevationLookup']['status'] == 'pending'
        assert report['terrain']['elevationM'] == round(global_topography(*key)[0], 1)
        assert report['verdict']['status'] == 'unknown'
        assert any(reason['code'] == 'local_elevation_loading' for reason in report['verdict']['reasons'])
    finally:
        release.set()
        with api._point_lock:
            job = api._point_jobs.pop(key, None)
        if job:
            job[0].result(timeout=5)


def test_installed_full_model_supports_new_windows_without_any_network(dem, monkeypatch):
    import json
    from hashlib import sha256
    from pathlib import Path
    from shutil import copy2
    point, calls = dem
    item = api.candidates([])[0]
    href = api.asset_url(item)
    api.PRODUCTS.mkdir()
    copy2(Path(api.CACHE).parent / 'source.tif', api.PRODUCTS / f'{sha256(href.encode()).hexdigest()}.tif')
    (api.PRODUCTS / 'catalog.json').write_text(json.dumps([item]))
    monkeypatch.setattr(api, 'candidates', lambda points: pytest.fail('No network discovery should be needed'))
    terrain = api.cached_window([point(200, 200), point(210, 210)])
    assert terrain is not None and terrain[0].cell_size == 20
    assert calls == []
