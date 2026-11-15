# MARTIAN MAP Engineering Report

Current data integration: [MarsPath coverage and validation](reports/MARS_DATA_INTEGRATION.md)
documents supplied MOLA measurements, partial HiRISE imagery, 2,055 official
names, real CTX terrain as the planner default, access explanations and 32 tests.

Frontend redesign and current validation (2026-11-15): see
[the redesign report](reports/FRONTEND_REDESIGN.md). It records the shared
application shell, all 13 workspaces, preserved API contracts, browser checks,
source snapshot and the latest 26-test backend regression result.

## Implementation

MARTIAN MAP extends the existing MarsNexus React and TypeScript application and FastAPI service. Three.js and React Three Fiber render the globe. Canvas 2D provides an interactive view for devices with limited graphics support. NumPy, SciPy and Rasterio handle elevation and matching. The original local rover planner, configurable mission weights and traverse simulation remain accessible in the Route Planner.

| Workspace | Current behavior |
| --- | --- |
| Mission home | Entry points and linked NASA findings with Viking imagery |
| Global explorer | Rotate and zoom the globe, switch datasets and views, locate coordinates, search five named regions, select a point, and display hazard and route overlays |
| Location intelligence | Site imagery and context, weighted landing factors, local coverage, hazards, historical weather where applicable, routes and a source-linked guide with Arabic narration |
| Route planner | Three A* objectives, shared mobility profile and weights, energy model, local map and simulated traversal with replanning |
| Survival center | Sourced evidence for water, temperature, radiation, atmosphere, energy, agriculture and communications |
| Navigation technology | TRN-style matching and LVS-style landmark and slope screening on terrain-derived input |
| Mission comparison | Save and remove candidates, rank by local terrain score or date, and export JSON with factors, survival evidence and sources |
| Data center | Dataset provenance, resolution and coverage information |

The interface uses a dark neutral palette with yellow for selections. Red marks steep terrain and orange marks crater rims or navigation hazards. Scientific map layers retain their source colors. The globe and 2D map use planetocentric latitude and east-positive longitude from −180° to 180°. Longitude wraps at the antimeridian.

## Sources and coverage

| Product | Use |
| --- | --- |
| [Viking orbital mosaic](https://maps.jpl.nasa.gov/tmaps/mars.html) and [NASA PIA04304](https://science.nasa.gov/resource/valles-marineris-the-grand-canyon-of-mars/) | Bundled global color imagery at 0.25° per pixel and the home photograph |
| [MOLA MEGDR](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) | Bundled global elevation at 0.25° cells, approximately 15 km at the equator, and a derived elevation texture |
| [NASA Mars Trek WMTS](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) | MOLA color shading, regional roughness proxy, THEMIS daytime IR and a 6 m Jezero CTX image mosaic |
| [USGS SIM 3292](https://pubs.usgs.gov/publication/sim3292) | Global geologic map at 1:20,000,000, rendered with published ArcGIS tiles |
| [Jezero CTX stereo-derived elevation](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) | Bundled 12.8 × 12.8 km grid with 20 m cells. Used for local terrain factors, rover routing, shade and the red overlay for slopes above 15° |
| [Robbins and Hynek crater catalog](https://doi.org/10.1029/2011JE003966) | Detection of nearby catalogued craters with diameters of at least 1 km. Rims are approximated as circles |
| [Perseverance MEDA](https://doi.org/10.1038/s41561-022-01084-0), [SWIM](https://science.nasa.gov/resource/swim-map-shows-subsurface-water-ice-on-mars/), [RAD](https://science.nasa.gov/resource/radiation-measurements-on-mars/) | Historical weather and environmental context. The Data and Survival workspaces link the underlying evidence |

## Methods and simulations

- The landing screen weights available slope, roughness, crater, clear-circle and access factors and exposes their contributions. Mission Comparison uses the default weights and ranks sites covered by the local terrain grid.
- The surface routes share a waypoint and mobility configuration. Shortest minimizes traversable distance. Safest penalizes slope, roughness and low-confidence terrain. Optimal combines the configured mission weights. The tables expose distance, modeled time, maximum slope, hazard exposure, confidence and energy margins. Rover mobility and energy are model estimates.
- The [navigation demonstration](https://www.nasa.gov/space-technology-mission-directorate/tdm/terrain-relative-navigation-trn/) generates a noisy camera crop from CTX hillshade. Normalized cross-correlation searches at an eight-cell stride and refines at one cell. The lab shows the estimated position, reference truth, match similarity, competing peak and position error. LVS mode adds terrain-gradient landmarks and a candidate based on a slope window. Both modes model translation on a fixed reference grid.
- The guide answers built-in questions from the selected site and linked references. An optional server-side model can synthesize answers from the report and default rover route metrics. Arabic report audio uses local synthesis and loads on demand.

## Reliability and scope

Layer tiles use a same-origin FastAPI endpoint with a fixed partner URL mapping, coordinate validation, a bounded cache, an upstream timeout and response size checks. The globe and map retain bundled imagery if a remote layer fails. Candidate reports use browser-local storage and JSON export. The application uses bundled raster and catalog files and adds no shared database or accounts.

Global CTX, HiRISE and HRSC ingestion, sub-cell obstacles, site soil mechanics, ice depth and extraction yield, site-level radiation and power models, and dated relay geometry remain outside the ingested coverage. Live weather is unavailable. Global MOLA supports regional screening. Detailed routes and hazard screening are limited to the Jezero CTX elevation crop. A large crater rim derived from the catalog carries geometric uncertainty.

This version supports educational mission planning. Operational approval would require vehicle-specific constraints, higher-resolution site surveys, and independent hazard and trajectory validation. Navigation results omit camera calibration, altitude changes, attitude, flight dynamics and independent sensor data. The legacy local planner uses a synthetic demonstration terrain by default and supports a configured GeoTIFF.

## Run locally

Install Python 3.11 or later and a supported Node.js 20.19+ or 22.12+ release. From the project root, use two PowerShell terminals.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

```powershell
cd frontend
npm install
npm run dev
```

Open [MARTIAN MAP](http://localhost:5173/). When using a different API port, set `MARS_API_TARGET` before starting Vite. To enable open-ended model responses, configure `OPENAI_API_KEY` and `MARS_GUIDE_MODEL` in the backend process environment. The live provider was unconfigured in this workspace.

## Verification

Run `npm run lint` and `npm run build` in the frontend and `.\.venv\Scripts\python.exe -m pytest -q` in the backend. The 23 backend tests include local and regional assessments, coordinate bounds, antimeridian equivalence, route and energy tests, navigation matching, and layer proxy validation. Live tile requests for MOLA shading, roughness, THEMIS, USGS geology and Jezero CTX returned imagery through the development server.

The build reports a speech synthesis library browser-compatibility advisory and a large Three.js bundle advisory. The core interface defers loading Three.js and the Arabic speech module until needed. Production load testing and a broad device matrix remain pending.
