from fastapi.testclient import TestClient
import pytest

from app.main import app


def test_global_screening_at_antimeridian():
    client = TestClient(app)
    east = client.get("/api/landing", params={"latitude": 10, "longitude": 180})
    west = client.get("/api/landing", params={"latitude": 10, "longitude": -180})
    assert east.status_code == 200
    assert east.json() == west.json()
    data = east.json()
    factors = {factor["key"]: factor for factor in data["factors"]}
    assert data["level"] == "regional"
    assert not data["routeAvailable"]
    assert factors["elevation"]["value"] is not None
    assert factors["rocks"]["value"] is None
    assert factors["zone"]["score"] is None
    assert client.get("/api/landing", params={"latitude": 91, "longitude": 10}).status_code == 422


def test_jezero_assessment_and_traverses():
    point = {"latitude": 18.45, "longitude": 77.45}
    client = TestClient(app)
    report = client.get("/api/landing", params=point).json()
    assert report["level"] == "local"
    assert report["routeAvailable"]
    factors = {factor["key"]: factor for factor in report["factors"]}
    assert factors["elevation"]["value"] == pytest.approx(-2571.122, abs=0.1)
    assert factors["zone"]["value"] > 0
    assert factors["rocks"]["score"] is None
    routes = client.get("/api/landing/routes", params=point).json()
    assert set(routes["routes"]) == {"shortest", "optimal", "safest"}
    shortest, safest = (routes["routes"][key] for key in ("shortest", "safest"))
    assert shortest["metrics"]["distance_m"] < safest["metrics"]["distance_m"]
    assert safest["metrics"]["risk_score"] < shortest["metrics"]["risk_score"]
    assert all(route["points"][-1] == routes["waypoint"] for route in routes["routes"].values())


def test_jezero_routes_use_mission_weights_and_energy_budget():
    client = TestClient(app)
    request = {
        "latitude": 18.45, "longitude": 77.45, "profile": "rover_scout",
        "overrides": {"capacity_wh": 20},
        "weights": {"distance": 1, "time": 0, "energy": 0, "risk": 0, "science": 0},
    }
    response = client.post("/api/landing/routes", json=request)
    assert response.status_code == 200
    routes = response.json()["routes"]
    assert routes["optimal"]["points"] == routes["shortest"]["points"]
    assert routes["optimal"]["metrics"]["energy_usable_wh"] == 15
    assert not routes["optimal"]["metrics"]["energy_feasible"]
    assert client.post("/api/landing/routes", json={**request, "profile": "unknown"}).status_code == 404
