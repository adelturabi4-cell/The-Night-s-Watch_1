import numpy as np
import rasterio
from fastapi.testclient import TestClient
from rasterio.warp import transform

from app.main import app, get_terrain
from app.data_catalog import PACK, region_at, pack_topography, names

client = TestClient(app)


def test_pack_elevation_is_sampled_from_native_mars_crs_not_color_tiles():
    lat, lon = -14.02, -63.32
    with rasterio.open(PACK / 'mola/elevation.cog.tif') as ds:
        x,y = transform(ds.crs.geodetic_crs,ds.crs,[lon],[lat])
        expected = next(ds.sample([(x[0],y[0])]))[0]
    assert pack_topography(lat,lon)[0] == float(expected)
    report = client.get('/api/landing',params={'latitude':lat,'longitude':lon}).json()
    assert report['resolutionM'] == 3705
    assert report['accessibility']['status'] == 'insufficient_data'
    assert not report['routeAvailable']
    assert 'Coprates' in report['region']['displayName']


def test_official_names_cover_the_globe_without_claiming_exact_boundaries():
    assert len(names()) >= 2000
    assert region_at(18.45,77.45)['name'] == 'Jezero'
    assert region_at(0,0)['name'] == 'Meridiani Planum'
    for point in [(89,170),(-70,-179),(35,32)]:
        region = region_at(*point)
        assert region['source'].startswith('https://planetarynames.wr.usgs.gov/Feature/')
        assert region['match'] in ('approximate_extent','nearest_named_feature')


def test_real_planner_cell_has_geographic_location_and_profile_aware_block_reason():
    t = get_terrain()
    assert not t.meta['simulated'] and not t.science_sites
    row,col = np.unravel_index(np.nanargmax(t.slope_deg),t.shape)
    response = client.get('/api/terrain/cell',params={'row':int(row),'col':int(col),'max_slope_deg':4})
    assert response.status_code == 200
    data = response.json()
    assert 18 < data['latitude'] < 19 and 77 < data['longitude'] < 78
    assert data['slope'] > 4 and not data['traversable']
    assert any('4.0' in reason for reason in data['reasons'])
    assert client.get('/api/terrain/cell',params={'row':9999,'col':0}).status_code == 422
    assert client.get('/api/terrain/cell',params={'row':0,'col':0,'profile':'invalid'}).status_code == 404


def test_hirise_has_real_texture_and_explicit_missing_coverage():
    with rasterio.open(PACK / 'hirise/site-equirect.png') as ds:
        rgba = ds.read()
    valid = rgba[3] > 0
    assert valid.any() and (~valid).any()
    assert np.std(rgba[0][valid]) > 5
