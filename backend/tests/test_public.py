from fastapi.testclient import TestClient
from pathlib import Path
import pytest


def test_built_frontend_and_api_share_one_origin():
    if not (Path(__file__).resolve().parents[2] / 'frontend/dist/index.html').is_file():
        pytest.skip('Build the frontend to check the production web entry point.')
    from app.public import app
    client = TestClient(app)
    page = client.get('/')
    assert page.status_code == 200
    assert 'text/html' in page.headers['content-type']
    assert '/assets/' in page.text
    assert client.get('/api/health').json()['status'] == 'ok'
    assert client.get('/mars-data/layers.json').json()['schemaVersion'] == 1
    assert client.get('/app/main.py').status_code == 404
    assert client.get('/.env').status_code == 404
