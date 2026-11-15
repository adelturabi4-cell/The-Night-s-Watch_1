import base64
from io import BytesIO
from types import SimpleNamespace

from app import imagery_service as imagery


def test_downloaded_tiles_survive_memory_cache_clear_and_upstream_failure(tmp_path, monkeypatch):
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEEsAAAAASUVORK5CYII=')
    url = imagery.tile_address('relief', 0, 0, 0)
    calls = []
    def upstream(*args, **kwargs):
        calls.append(1)
        response = BytesIO(png)
        response.headers = SimpleNamespace(get_content_type=lambda: 'image/png')
        return response
    monkeypatch.setattr(imagery, 'CACHE', tmp_path)
    monkeypatch.setattr(imagery, 'urlopen', upstream)
    imagery.fetch_tile.cache_clear()
    assert imagery.fetch_tile(url) == ('image/png', png)
    imagery.fetch_tile.cache_clear()
    monkeypatch.setattr(imagery, 'urlopen', lambda *args, **kwargs: (_ for _ in ()).throw(OSError('offline')))
    assert imagery.fetch_tile(url) == ('image/png', png)
    assert calls == [1]
    imagery.fetch_tile.cache_clear()
