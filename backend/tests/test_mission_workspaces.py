from fastapi.testclient import TestClient

from app.main import app
from app import imagery_service


def test_navigation_demo_matches_jezero_and_validates_controls():
    with TestClient(app) as client:
        for mode in ("trn", "lvs"):
            response = client.get("/api/navigation/demo", params={"mode": mode, "x": 146, "y": 130})
            assert response.status_code == 200
            demo = response.json()
            assert demo["mode"] == mode
            assert demo["cellSize"] == 20
            assert demo["fine"] == demo["truth"]
            assert demo["errorM"] == 0
            assert 0 < demo["confidence"] <= 1
            assert len(demo["reference"]) == 128
            assert len(demo["observation"]) == demo["templateSize"]
        assert client.get("/api/navigation/demo", params={"mode": "invalid"}).status_code == 422


def test_layer_proxy_bounds_and_source(monkeypatch):
    def fetch_tile(address):
        assert address == "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/1/0/0.jpg"
        return "image/jpeg", b"test tile"

    monkeypatch.setattr(imagery_service, "fetch_tile", fetch_tile)
    with TestClient(app) as client:
        response = client.get("/api/layers/relief/1/0/0")
        assert response.content == b"test tile"
        assert response.headers["content-type"] == "image/jpeg"
        assert "max-age" in response.headers["cache-control"]
        assert client.get("/api/layers/relief/1/2/0").status_code == 404
        assert client.get("/api/layers/unknown/0/0/0").status_code == 404
