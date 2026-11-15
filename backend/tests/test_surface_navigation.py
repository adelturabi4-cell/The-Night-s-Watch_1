from fastapi.testclient import TestClient
from app.main import app
from app.landing import local_grid

client = TestClient(app)
ORIGIN = {"latitude": 18.45, "longitude": 77.45}
DESTINATION = {"latitude": 18.455, "longitude": 77.455}


def test_explicit_destination_uses_selected_endpoint_and_existing_metrics():
    response = client.post('/api/surface/navigation', json={"origin": ORIGIN, "destination": DESTINATION})
    assert response.status_code == 200
    data = response.json()
    assert data['waypoint'] == list(DESTINATION.values())
    assert data['routes']
    for route in data['routes'].values():
        assert local_grid(*route['points'][0])[3:] == local_grid(*ORIGIN.values())[3:]
        assert local_grid(*route['points'][-1])[3:] == local_grid(*DESTINATION.values())[3:]
        assert route['metrics']['distance_m'] > 0


def test_navigation_rejects_missing_coverage_same_cell_and_bad_coordinates():
    for destination in [ORIGIN, {"latitude": 0, "longitude": 0}, {"latitude": 91, "longitude": 0}]:
        response = client.post('/api/surface/navigation', json={"origin": ORIGIN, "destination": destination})
        assert response.status_code == 422
