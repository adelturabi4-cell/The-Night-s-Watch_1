import base64

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.landing import local_grid
from app.main import app
from app.profiles import PROFILES
from app.surface_workspace import route_verdict

client = TestClient(app)
ORIGIN = {'latitude': 18.45, 'longitude': 77.45}
DESTINATION = {'latitude': 18.455, 'longitude': 77.455}


def test_workspace_preserves_selected_coordinates_and_route_grid():
    response = client.post('/api/surface/workspace', json={'origin': ORIGIN, 'destination': DESTINATION})
    assert response.status_code == 200, response.text
    data = response.json()
    terrain = data['terrain']
    latitude = np.frombuffer(base64.b64decode(data['geography']['latitude']), dtype='<f4')
    longitude = np.frombuffer(base64.b64decode(data['geography']['longitude']), dtype='<f4')
    assert latitude.size == longitude.size == terrain['width'] * terrain['height']
    assert terrain['meta']['simulated'] is False
    for endpoint, selected in [('start', ORIGIN), ('goal', DESTINATION)]:
        row, col = terrain['suggested'][endpoint]
        index = row * terrain['width'] + col
        assert local_grid(float(latitude[index]), float(longitude[index]))[3:] == local_grid(**{'lat': selected['latitude'], 'lon': selected['longitude']})[3:]
    for route in data['result']['routes'].values():
        assert route['verdict']['reasons']
        if route['status'] == 'ok':
            assert route['path'][0] == terrain['suggested']['start']
            assert route['path'][-1] == terrain['suggested']['goal']
            if not route['metrics']['energy_feasible']:
                assert route['verdict']['status'] == 'no_go'
    assert data['live'] is False
    assert data['evaluatedAt']


def test_same_cell_is_a_selection_preview_never_a_valid_traverse():
    response = client.post('/api/surface/workspace', json={'origin': ORIGIN, 'destination': ORIGIN})
    assert response.status_code == 200
    data = response.json()
    assert data['terrain']['suggested']['start'] == data['terrain']['suggested']['goal']
    assert all(route['status'] == 'unreachable' for route in data['result']['routes'].values())


def test_coverage_and_validation_do_not_replace_the_users_selection():
    for destination in [{'latitude': 0, 'longitude': 0}, {'latitude': 91, 'longitude': 0}]:
        response = client.post('/api/surface/workspace', json={'origin': ORIGIN, 'destination': destination})
        assert response.status_code == 422
    assert client.post('/api/surface/workspace', json={'origin': ORIGIN, 'destination': DESTINATION, 'profile': 'missing'}).status_code == 404


def test_uncovered_endpoint_is_identified_without_fabricating_route_verdicts():
    cerberus = {'latitude': 7.145, 'longitude': 166.786}
    for origin, destination, missing in [(ORIGIN, cerberus, ['destination']), (cerberus, ORIGIN, ['origin']),
                                         (cerberus, cerberus, ['origin', 'destination'])]:
        response = client.post('/api/surface/workspace', json={'origin': origin, 'destination': destination})
        assert response.status_code == 422
        data = response.json()
        assert data['code'] == 'missing_local_terrain'
        assert data['missingEndpoints'] == missing
        assert 'USGS' in data['detail']
        assert 'routes' not in data
        assert 'result' not in data


def test_large_window_is_distinct_from_missing_terrain():
    destination = {'latitude': 18.52, 'longitude': 77.52}
    assert local_grid(destination['latitude'], destination['longitude']) is not None
    response = client.post('/api/surface/workspace', json={'origin': ORIGIN, 'destination': destination})
    assert response.status_code == 422
    assert response.json()['code'] == 'window_too_large'
    assert response.json()['missingEndpoints'] == []


def test_energy_and_uncertainty_take_precedence_over_connected_path():
    metrics = {'max_slope_deg': 7, 'energy_feasible': False, 'energy_wh': 950,
               'energy_margin_wh': -50, 'distance_m': 600, 'min_confidence': 0.9, 'max_risk': 0.3}
    assert route_verdict({'status': 'ok', 'metrics': metrics}, PROFILES['rover_scout'])['status'] == 'no_go'
    metrics.update(energy_feasible=True, energy_margin_wh=100, min_confidence=0.2)
    assert route_verdict({'status': 'ok', 'metrics': metrics}, PROFILES['rover_scout'])['status'] == 'unknown'


def test_global_orbital_imagery_uses_verified_nasa_grid():
    from app.imagery_service import tile_address
    assert '/Mars_Viking_MDIM21_ClrMosaic_global_232m/' in tile_address('viking', 7, 64, 128)
    assert tile_address('viking', 8, 0, 0) is None


def test_low_energy_and_slope_limits_produce_real_rejection_reasons():
    request = {'origin': ORIGIN, 'destination': DESTINATION, 'overrides': {'capacity_wh': 1}}
    response = client.post('/api/surface/workspace', json=request)
    assert response.status_code == 200
    assert all(route['verdict']['status'] == 'no_go' for route in response.json()['result']['routes'].values())
    request['overrides'] = {'max_slope_deg': 0.1}
    response = client.post('/api/surface/workspace', json=request)
    assert response.status_code == 200
    for route in response.json()['result']['routes'].values():
        assert route['status'] == 'unreachable'
        assert 'exceeding the mobility limit' in route['verdict']['reasons'][0]


@pytest.fixture(autouse=True)
def isolate_remote_catalog(monkeypatch):
    monkeypatch.setattr('app.surface_workspace.remote_window', lambda points: None)
