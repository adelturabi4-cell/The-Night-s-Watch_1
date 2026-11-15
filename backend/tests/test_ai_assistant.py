import io
import json

from fastapi.testclient import TestClient

from app.main import app
from app import ai_assistant


def test_mission_advisor_uses_computed_evidence_and_cites_sources(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("MARS_GUIDE_MODEL", "test-model")
    monkeypatch.setattr(ai_assistant, "assessment", lambda latitude, longitude: {
        "level": "local", "routeAvailable": True, "factors": [{"key": "slope", "score": 90}],
    })
    monkeypatch.setattr(ai_assistant, "surface_routes", lambda latitude, longitude: {
        "routes": {"safest": {"metrics": {"risk_score": 4, "science_score": 0.6}}},
        "reason": None,
    })
    requests = []

    def fake_urlopen(request, timeout):
        requests.append(request)
        return io.BytesIO(json.dumps({
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "التوصية [CTX]"}]}],
        }).encode())

    monkeypatch.setattr(ai_assistant, "urlopen", fake_urlopen)
    with TestClient(app) as client:
        response = client.post("/api/guide/mission", json={"candidates": [
            {"latitude": 18.45, "longitude": 77.45},
            {"latitude": 18.46, "longitude": 77.46},
        ]})

    assert response.status_code == 200
    assert response.json()["answer"] == "التوصية [CTX]"
    assert response.json()["sources"] == [{"id": "CTX", "url": ai_assistant.SOURCES["CTX"]}]
    assert len(requests) == 1
    assert requests[0].get_header("Authorization") == "Bearer test-key"
    payload = json.loads(requests[0].data)
    prompt = json.loads(payload["input"])
    assert len(prompt["candidates"]) == 2
    assert prompt["candidates"][0]["default_scout_route_metrics"]["safest"]["risk_score"] == 4
    assert "limited proxy" in payload["instructions"]


def test_mission_advisor_requires_two_candidates():
    with TestClient(app) as client:
        response = client.post("/api/guide/mission", json={"candidates": [
            {"latitude": 18.45, "longitude": 77.45},
        ]})

    assert response.status_code == 422


def test_mission_advisor_ranks_locally_without_a_model(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("MARS_GUIDE_MODEL", raising=False)
    with TestClient(app) as client:
        response = client.post("/api/guide/mission", json={"candidates": [
            {"latitude": 18.45, "longitude": 77.45},
            {"latitude": -14.02, "longitude": -63.32},
        ]})
    body = response.json()
    assert response.status_code == 200 and body["mode"] == "local"
    ranked = {row["candidate"]: row for row in body["ranking"]}
    assert ranked[1]["score"] is not None and ranked[2]["score"] is None  # regional-only site is not ranked
    assert any(source["id"] == "CTX" for source in body["sources"])


def test_guide_answers_from_site_evidence_without_a_model(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as client:
        english = client.post("/api/guide", json={"latitude": 18.45, "longitude": 77.45, "question": "Which route should I take?"}).json()
        arabic = client.post("/api/guide", json={"latitude": 18.45, "longitude": 77.45, "question": "شو الجيولوجيا هون؟"}).json()
        remote = client.post("/api/guide", json={"latitude": -14.02, "longitude": -63.32, "question": "Can I go there?"}).json()
    assert english["mode"] == "local" and english["topic"] == "route" and "route" in english["answer"].lower()
    assert arabic["topic"] == "geology" and "Nle" in arabic["answer"] and "الوحدة" in arabic["answer"]
    assert {source["id"] for source in arabic["sources"]} >= {"SIM3464"}
    assert "Unconfirmed" in remote["answer"] and "not a safety guarantee" in remote["answer"]


def test_guide_falls_back_to_evidence_when_the_provider_fails(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("MARS_GUIDE_MODEL", "test-model")
    def fail(*_args, **_kwargs):
        raise ai_assistant.HTTPException(502, "The AI provider is currently unavailable.")
    monkeypatch.setattr(ai_assistant, "_ask_model", fail)
    with TestClient(app) as client:
        body = client.post("/api/guide", json={"latitude": 18.45, "longitude": 77.45, "question": "Explain the terrain risks"}).json()
    assert body["mode"] == "local" and body["providerError"] is True
