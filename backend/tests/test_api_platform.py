"""API contract: one error shape, health with dataset readiness, CORS, caching, docs."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import api_platform
from app.main import app

client = TestClient(app, raise_server_exceptions=False)


def test_validation_errors_have_a_readable_detail_and_field_list():
    response = client.get("/api/site", params={"latitude": 95, "longitude": 0})
    body = response.json()
    assert response.status_code == 422 and body["code"] == "invalid_request"
    assert isinstance(body["detail"], str) and "latitude" in body["detail"]
    assert body["errors"] == [{"field": "latitude", "message": body["errors"][0]["message"]}]


def test_nested_body_fields_are_named_with_dots():
    body = client.post("/api/surface/workspace", json={"origin": {"latitude": 0}}).json()
    fields = {error["field"] for error in body["errors"]}
    assert {"origin.longitude", "destination"} <= fields


def test_http_errors_keep_their_message_and_gain_a_code():
    unknown = client.get("/api/site", params={"latitude": 0, "longitude": 0, "profile": "submarine"}).json()
    assert unknown == {"detail": "Unknown profile 'submarine'", "code": "not_found"}
    assert client.get("/api/does-not-exist").json()["code"] == "not_found"


def test_workspace_coverage_errors_keep_their_specific_code():
    body = client.post("/api/surface/workspace", json={"origin": {"latitude": 0, "longitude": 0},
                                                      "destination": {"latitude": 1, "longitude": 1}}).json()
    assert isinstance(body["detail"], str) and body["code"] != "unprocessable"


def test_unexpected_errors_return_json_not_a_stack_trace():
    # A separate app with the same platform layer, so the shared app is not modified.
    isolated = FastAPI()
    api_platform.install(isolated)

    @isolated.get("/api/boom")
    def boom():
        raise RuntimeError("secret internals")

    response = TestClient(isolated, raise_server_exceptions=False).get("/api/boom")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error" and "secret" not in response.text


def test_health_reports_dataset_readiness():
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["version"] == api_platform.API_VERSION
    assert body["datasets"]["jezero_ctx_dem"] == {"available": True, "required": True}
    assert body["missingRequired"] == []


def test_health_is_degraded_when_a_required_dataset_is_missing(monkeypatch, tmp_path):
    monkeypatch.setitem(api_platform.DATASETS, "jezero_ctx_dem", (tmp_path / "absent.tif", True))
    body = client.get("/api/health").json()
    assert body["status"] == "degraded" and body["missingRequired"] == ["jezero_ctx_dem"]


def test_cors_allows_the_dev_frontend_but_not_other_sites():
    allowed = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-origin" not in client.get("/api/health", headers={"Origin": "https://evil.example"}).headers


def test_static_data_is_cacheable_and_responses_are_timed():
    rover = client.get("/api/jezero/rover")
    assert rover.headers["cache-control"] == "public, max-age=3600"
    assert rover.headers["x-response-time"].endswith("ms")
    assert "cache-control" not in client.get("/api/site", params={"latitude": 0, "longitude": 0}).headers


def test_openapi_is_titled_and_every_route_is_tagged():
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "Martian Map API"
    untagged = [f"{method.upper()} {path}" for path, operations in schema["paths"].items()
                for method, operation in operations.items() if not operation.get("tags")]
    assert untagged == []
