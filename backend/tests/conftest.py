"""Keep automated regression tests independent of remote catalog revisions."""
import pytest


@pytest.fixture(autouse=True)
def offline_elevation_catalog(monkeypatch):
    monkeypatch.setattr('app.terrain_api._catalog', lambda *args: [])
