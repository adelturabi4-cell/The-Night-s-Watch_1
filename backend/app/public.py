"""Serve the built application and its existing APIs from one public origin.

Run with: python -m uvicorn app.public:app --host 127.0.0.1 --port 8080
An HTTPS tunnel or hosting reverse proxy can forward to this loopback listener.
"""
from pathlib import Path

from fastapi.staticfiles import StaticFiles

from .main import app

DIST = Path(__file__).resolve().parents[2] / 'frontend/dist'
if not (DIST / 'index.html').is_file():
    raise RuntimeError('Build the frontend before starting the public server: npm run build')

# Register last, keeping every existing /api endpoint ahead of the static mount.
app.mount('/', StaticFiles(directory=str(DIST), html=True), name='built-frontend')
