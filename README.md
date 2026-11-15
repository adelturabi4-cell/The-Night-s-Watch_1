# MARTIAN MAP

Mars exploration and mission planning in the existing MarsNexus application.
See the [engineering report](ENGINEERING_REPORT.md) for the current architecture, datasets and verification.

The supplied MarsPath data pack is integrated. See the
[data integration and coverage report](reports/MARS_DATA_INTEGRATION.md).
Click a point in the globe for its official naming context and access evidence.
Click a cell in the route map for geographic coordinates and profile-aware
terrain screening. Mars Explorer includes supplied MOLA and partial HiRISE
layers; missing HiRISE tiles are transparent, and imagery alone does not establish
whether a rover can traverse a site.

The aerospace workspace includes a collapsible sidebar, global workspace and
region search, an interactive Mission Control globe, and a shared dark olive /
gold design across all pages. Existing hash URLs remain available. Dedicated
AI Mission Advisor, Mission Simulator, Landing Site Analysis, Reports and
Settings views reuse the existing services and scientific engines.

Save candidates from a site report or Mission Control. In the planner or
simulator, **Save report** captures the current route comparison, mobility
settings, simulation totals and event log. **Reports** supports JSON export.
Route reports retain the latest 50 records in this browser; candidates keep
their original storage format. Settings provide a browser-local display name,
compact information density and reduced interface motion.

See the [redesign notes and verification](reports/FRONTEND_REDESIGN.md) for
the preservation plan, checks, screenshots and source snapshot.

Open **Mars Explorer** to use the Mars globe or the interactive 2D map.
Select a point or enter planetocentric latitude and east-positive longitude
(−180° to 180°) for terrain details, safety, weather coverage and available
surface routes. Use **استمع للتقرير بالعربي** to hear the selected report.
The **2D map** and **3D local terrain** views support the original A* routes
and traverse simulation.

In the 2D route planner, choose **Set astronaut position** (A) or **Set
destination** (B), then click the map to place it. The shortest, safest and
mission-optimized A* routes recalculate automatically. A yellow dashed line
marks the direct straight-line reference; gold dots show the safest strategy,
ivory dashes the shortest route, and solid copper the mission-optimized route. Red terrain marks
high-risk areas and dark red marks impassable terrain. Use the map color key to
identify each layer. All terrain classifications are model estimates, not a
guarantee of surface safety.

## Landing-site datasets

| Layer | Product and scope |
|---|---|
| Globe imagery | [Caltech/JPL/USGS Viking mosaic](https://maps.jpl.nasa.gov/tmaps/mars.html), 1,440 × 720 pixels |
| Global terrain | [MGS MOLA MEGDR MEGT90N000CB](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html), 0.25° per cell. The globe uses a grayscale relief derivative. |
| Local terrain | [Mars 2020 Jezero CTX DEM](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic), a 12.8 × 12.8 km crop centered near 18.45° N, 77.45° E at the native 20 m resolution. The globe overlays a tinted hillshade derived from that crop. |
| Impact craters | [Robbins and Hynek (2012)](https://doi.org/10.1029/2011JE003966). The bundled extract retains center coordinates and diameters for craters ≥1 km from the [author's archive](https://craters.sjrdesign.net/). |

The explorer derives a weighted educational score from available factors and
shows each factor's assumptions. The global score compares broad terrain only.
The Jezero crop supports local slope, roughness, an estimated clear-circle
diameter and rover access indicators. Local rock abundance and vehicle-specific
landing constraints are unavailable. The three mapped routes compare surface
travel to a shared waypoint after touchdown using the selected mobility profile.
They do not simulate spacecraft descent.

The weather section identifies availability for the selected point. Jezero has
historical rover observations from [Perseverance MEDA](https://doi.org/10.1038/s41561-022-01084-0).
The app has no live Mars weather feed and makes no site-specific weather prediction.

> **Surface planner default: REAL Jezero CTX elevation, derived hillshade.**
> The planner uses a 4.8 × 4.8 km crop at 20 m/cell. A configured GeoTIFF takes
> precedence. Synthetic demo terrain is retained only as a labeled fallback if
> the actual terrain file is unavailable. Traverse progress and injected events
> are simulations, even when elevation is real.

## What works today

| Area | Status |
|---|---|
| Terrain engine: slope, roughness, risk, traversability classes, confidence | Working |
| Three routes (shortest, safest, optimal) with A* | Working, validated against SciPy Dijkstra |
| Explainability: segment-level reasons built from computed values | Working |
| Energy model with feasibility and reserve margin | Working |
| What-if sliders with before/after comparison | Working |
| 2D map with six layers, hover inspection, science sites | Working |
| 3D terrain view with routes and follow camera | Working |
| Traverse simulation, obstacle and mobility-fault events, live replanning, event log | Working |
| Real GeoTIFF DTM loading | Working (tested with a generated GeoTIFF; not yet run on a real NASA file) |
| Site-scoped AI Q&A and saved-site recommendations | Working when an AI model is configured; grounded in computed terrain and route evidence |
| Multi-rover cooperation, communication windows, D* Lite | Not built yet |

## Site intelligence: "can I go there, and why?"

Selecting any point (globe, 2D map or coordinates) shows one verdict with its reasons.

| Layer | File | Responsibility |
| --- | --- | --- |
| Import | `backend/scripts/import_jezero_pack.py` | Repack the `Martian_Map_Web_Data` pack into `backend/data/jezero/` |
| Repository | `backend/app/jezero.py` | Point-in-polygon geology, landing ellipse, small craters, nearest rover waypoint |
| Domain | `backend/app/site_intel.py` | `decide()` access rules (pure) and `site_report()` evidence assembly |
| HTTP | `backend/app/site_api.py` | `GET /api/site`, `/api/jezero/rover`, `/api/jezero/geology`, `/api/jezero/manifest` |
| UI | `frontend/src/SiteVerdict.tsx`, `siteIntel.ts` | Verdict panel, mobility selector, rover traverse overlay (2D) |
| Tests | `backend/tests/test_site_intel.py` | Rules, pack lookups, HTTP contract |

Verdicts: `go` and `caution` need local 20 m CTX terrain; `no_go` means a blocking rule fired
(slope above the selected profile limit); everywhere without local terrain is `unknown`, never "safe".
Rocks, soil strength, weather and radiation are listed as unavailable instead of being estimated.

```powershell
# Re-import after the data pack changes
backend\.venv\Scripts\python.exe backend\scripts\import_jezero_pack.py "<path>\Martian_Map_Web_Data"
# Preview on alternate ports (API 8010, UI 5273) without touching a running 8000/5173 pair
cd backend;  .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8010
cd frontend; npm run dev -- --mode next --port 5273
```

## API conventions

Interactive documentation: `http://127.0.0.1:8000/docs` (OpenAPI, grouped by tag). The cross-cutting
behaviour lives in `backend/app/api_platform.py` and is covered by `backend/tests/test_api_platform.py`.

- **Errors.** Every non-2xx JSON response is `{"detail": "<sentence>", "code": "<machine code>"}`.
  `detail` is always a string the UI can show as is. Validation errors (`invalid_request`) add
  `errors: [{"field": "origin.longitude", "message": "..."}]`. Unexpected failures return
  `internal_error` without internals; the traceback goes to the server log.
- **Health.** `GET /api/health` reports `status` (`ok` or `degraded`), the API version and which bundled
  datasets are installed. `degraded` means a required dataset is missing; the UI lists it under notifications.
- **CORS.** Only the local dev origins are allowed by default. Set `MARS_ALLOWED_ORIGINS`
  (comma-separated) to change this. The dev proxy and the public server are same-origin and need no CORS.
- **Caching and timing.** Jezero pack data and mobility profiles are sent with
  `Cache-Control: public, max-age=3600`. Every response carries `X-Response-Time`.

## Run it

Requirements: Python 3.11+ and Node.js 20+.

Backend (terminal 1):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Frontend (terminal 2):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Public HTTPS sharing

The complete production build and APIs can share one public HTTPS origin.
`Start-Public.ps1` starts a separate loopback production server and a Cloudflare
Quick Tunnel. It leaves the original development servers unchanged, downloads
the official pinned Cloudflare executable if needed, and verifies its SHA256.
It prints the current public URL and stores session state in the ignored
`.public/` folder. `Stop-Public.ps1` stops this sharing session.

```powershell
# Run from the project root, after building frontend with npm run build:
.\Start-Public.ps1
# To stop public access:
.\Stop-Public.ps1
```

This link is temporary and works while this computer, its Internet connection,
the production server and the tunnel are running. A restarted tunnel may get a
different URL. This is public sharing from the current computer, not permanent
cloud hosting. Saved candidates and reports remain local to each browser.

To enable the AI guide and mission advisor, configure an OpenAI API key and a
Responses API model in the same terminal before starting the backend:

```powershell
$env:OPENAI_API_KEY = "your-key"
$env:MARS_GUIDE_MODEL = "your-model"
uvicorn app.main:app --port 8000
```

The mission advisor compares 2–8 saved sites. It uses scientific evidence
coverage only as a limited proxy for research opportunity and identifies
missing local data; it does not estimate discovery probability or certify
landing safety. Saved-site coordinates and server-derived assessment and route
metrics are sent to the configured AI provider for the comparison. If the
model is not configured, the existing local terrain screening and route planner
remain available.

Tests:

```bash
cd backend
python -m pytest -q
```

On Windows, keep the project in a short path (for example `C:\dev\mars-nexus`).
Very long folder paths break `pip` inside a virtual environment.

## Using real NASA data

The backend reads any single-band elevation GeoTIFF (metres).

```bash
set MARS_DEM_PATH=C:\data\jezero_dtm.tif
set MARS_MAX_CELLS=320
uvicorn app.main:app --port 8000
```

- `MARS_DEM_PATH`: the DTM file. When set, the header badge switches to "REAL ELEVATION DATA".
- `MARS_MAX_CELLS`: the longest side of the working grid. Larger files are averaged down to this size.
- `MARS_SITES_PATH` (optional): a JSON list of science sites, each
  `{"id": "S1", "name": "...", "row": 120, "col": 80, "value": 0.8, "rationale": "..."}`.

Good candidates for Jezero Crater, to be confirmed on the source sites:

- USGS Astrogeology (https://astrogeology.usgs.gov/): Mars 2020 landing-site HiRISE and CTX DTM mosaics.
- NASA PDS (https://pds.nasa.gov/): HiRISE DTMs and MOLA gridded elevation.
- NASA Mars Trek (https://trek.nasa.gov/mars/): browsing and locating products.

Crop the file to the area of interest first. A 2 to 5 km window keeps the grid
resolution meaningful for a walk or a short drive.

## The model, and what is assumed

Everything below is a planning model. None of it is spacecraft telemetry.

| Quantity | How it is obtained |
|---|---|
| Elevation | Read from the DTM (or simulated in the demo) |
| Slope | Derived: gradient magnitude of elevation |
| Roughness | Derived: RMS elevation residual in a 5 x 5 cell window |
| Confidence | Real data: 1 where the DTM has a value, 0 where it does not, reduced next to gaps |
| Risk (0 to 1) | `0.65 * slope / max_slope + 0.35 * roughness / 1.2 m`, clipped |
| Impassable | Slope above the profile's limit, missing data, or a reported obstacle |
| Speed | `v * max(0.25, 1 - 0.5 * grade / max_slope - 0.3 * roughness_n)` |
| Energy | `max(0, m g (crr cos(theta) d + dz)) / efficiency + P_base * t`, Mars gravity 3.721 m/s2, no downhill recovery |
| Risk score (0 to 100) | `100 * (1 - exp(-sum(risk^2 * d) / 400 m))`, a relative index, not a failure probability |

Route objectives:

- Shortest: 3D path length.
- Safest: `d * (1 + 40 * risk^2 + 6 * (1 - confidence)^2)`.
- Optimal: `d * (w_distance + w_time * time_factor + w_energy * energy_factor + w_risk * penalty - 0.6 * w_science * science)`.

Known limits:

- Hazards smaller than one grid cell (rocks, ripples) are invisible.
- Sand and soil strength are not measured. Roughness is only a proxy.
- Low confidence means "not well known". It is never treated as safe.
- Mobility profile numbers (mass, speed, slope limit, energy budget) are assumptions in `backend/app/profiles.py`.

## Layout

```
backend/app/terrain.py    elevation grid, derived layers, demo generator, GeoTIFF loader
backend/app/profiles.py   mobility profiles and their assumptions
backend/app/planner.py    risk model, energy model, edge costs, A*, route metrics
backend/app/explain.py    explanations from computed route attributes
backend/app/main.py       FastAPI endpoints
backend/tests/            validation tests
frontend/src/             React app: map, 3D view, charts, simulator
```
