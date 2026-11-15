# Mars Nexus — orange exploration workflow

Updated locally on 2026-11-15.

## User-visible changes

- Black planetary explorer with orange actions, an animated globe camera and route reveals. Motion respects the browser preference and the existing reduced-motion setting.
- Every selection keeps the same coordinates through the location report and the A/B planner. The selected-site card includes the official naming context, real orbital imagery, modeled risk and an evaluation time.
- A dedicated route page supports manual coordinates, selecting both endpoints on 2D or 3D terrain, three A* strategies, clicking routes to read their reasons, adjustable slope/energy assumptions, elevation profiles and saving reports to the existing Reports library.
- The primary workflow has three stages: Explore, Analyze, Plan route. Route animation now runs directly on the third-stage A/B map. The former independent Mission Simulator entry is removed; old #simulator links resolve to #planner.

## Data and integration

The existing supplied MOLA, partial HiRISE, USGS naming/geology and Jezero CTX DEM data are retained. Geographic imagery replaces the unrelated Jezero reference image previously displayed for every location.

Added the official NASA Mars Trek Viking MDIM 2.1 color mosaic tile service (native 232 m, levels 0–7), verified against its WMTS capabilities. Natural-color maps load more detailed Viking imagery on zoom, with automatic CTX imagery inside Jezero and the supplied partial HiRISE footprint. Unavailable imagery falls back to the bundled real Viking mosaic.

Source documentation: https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars
Capabilities: https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml

POST /api/surface/workspace returns a local georeferenced elevation window around the user's actual A/B selections, the corresponding coordinate grid, full route geometry/metrics and Arabic route verdicts. Connectivity, energy reserves, maximum slope and confidence determine the verdict. An energy-infeasible connected path is never presented as usable. Same-cell selections return a terrain preview and request a distinct destination. Missing local coverage returns an explicit coverage error without replacing the selected point.

Precise surface routing requires the supplied local Jezero CTX elevation. Its planning window is limited to 300 cells (6 km), including the terrain context margin. Global imagery is not a global rover-scale terrain model. Hazard estimates use archival orbital data; live weather, soil strength, small obstacles and live hazard telemetry remain unavailable.

## Verification

- Frontend TypeScript and production build pass.
- Full backend suite: 58 passed. Existing library deprecation warnings remain.
- Browser checks: globe and location details; actual A/B route calculation through the main development URL; 2D/3D terrain; selecting B directly on 3D terrain; strategy selection updates reasons; low energy produces a no-go verdict with the computed deficit; saved report confirmation.
- Responsive checks at 1440 × 1000 and 390 × 844. The mobile route page has no horizontal overflow.
- The main backend was restarted to load the new endpoint. The existing development URL is http://127.0.0.1:5173/.

Screenshots: orange-globe-desktop.jpg, orange-route-2d.jpg, orange-route-3d.jpg, orange-globe-mobile.jpg.
Source snapshot before edits: before-orange-workflow.zip.

## Cerberus coverage follow-up

Fixed the empty-route screen reported at 7.145° N, 166.786° E. Missing-coverage responses now identify the affected endpoint(s) with code `missing_local_terrain`; oversized planning windows return a distinct `window_too_large` code. The existing string `detail` is retained.

The planner displays the explanation before the map and beside the route cards, labels the affected endpoint, disables unsupported terrain controls, and fits both A/B markers into the regional image. Cards no longer show blank metrics or an active strategy when no calculation exists. The user's coordinates remain unchanged until they explicitly select the Jezero example or edit the endpoints.

Verified the exact Cerberus coordinates in the browser, checked 390 px mobile layout without horizontal overflow, and verified that the Jezero action restores actual routes and enables 3D. Eight surface-workspace regression tests pass; the production frontend build passes. Screenshot: `cerberus-coverage-fixed.jpg`.

## Animation integrated into stage three

The existing A/B terrain map now receives an actual traveler position, path progress and moving state from one shared playback clock. 2D draws an astronaut/rover marker and highlights the traveled path; 3D animates the corresponding model and traveled trail. Switching view preserves progress. Changing the route, profile or endpoints resets the preview to the new route's A point.

Playback controls are embedded in the map panel and over the map itself: play/pause, replay from A, 0.5×/1×/2×/4× speed, seeking and 3D camera following. The compressed preview shows interpolated planned distance, time and energy, and saved reports capture its current totals. It is labeled as a modeled preview, not live tracking.

Autoplay waits until the map is visible, suspends when the map or browser document is hidden, and respects reduced-motion preferences. Invalid or unavailable routes cannot leave an old traveler running. Terrain inputs use stable empty site/obstacle arrays so animation frames do not rebuild all 3D route meshes. WebGL scene/model resources are disposed when the view or mobility profile changes.

Verification: production build passes; four Node tests validate distance-based interpolation, endpoint arrival, seeking boundaries and unavailable geometry. Browser checks verified movement to 100%, replay, 4× completion, pausing at 27% and preserving 27% on 2D→3D switch, resetting on strategy/profile change, astronaut and rover models, 390 px mobile controls without overflow, stopping on missing coverage, and the legacy #simulator→#planner redirect. Console checks showed no application errors.

Final UI proof: `stage-three-route-animation.jpg` shows the original third-stage 2D terrain map, the moving astronaut, the traveled orange trail and the embedded map controls. The captured preview was paused at 63% after confirming movement. Existing open/legacy page state is normalized to the planner; final build passes.

## English interface and connected USGS elevation

All interface strings, accessibility labels, terrain explanations, error messages, report narration and report audio now use English with left-to-right layout. Dates use English formatting. Removed repeated workspace headings, decorative section codes, card numbers and duplicate error panels, while preserving form labels, data provenance and material coverage limitations. The black/orange globe and the integrated stage-three animation remain in place.

`backend/app/terrain_api.py` connects the official USGS STAC collection `mro_ctx_controlled_usgs_dtms`. It selects numeric geoid-adjusted CTX elevation assets, streams bounded raster windows, preserves native resolution and missing pixels, and caches up to 96 windows for offline reuse. It accepts only the official HTTPS data hosts and numeric elevation asset path. Public access requires no key. Catalog and raster reads have timeouts; distant endpoints and oversized windows are rejected before unbounded reads.

The A/B planner, site details, landing screening, point-to-point navigation and comparison routes share the provider. Bundled Jezero data remains the first source. Outside that crop, available CTX models now supply real elevation, slope, roughness, route geometry and risk estimates. Source links and product IDs accompany downloaded data. Remote-service failures remain distinct from terrain no-go decisions.

Live verification used A (7.145 N, 166.680 E) and B (7.150 N, 166.685 E), near Cerberus. The provider returned native 20 m elevation and three usable-with-caution routes: shortest 438.2 m and lowest-risk/balanced 461.3 m. The running HTTP API also returned local site details, local landing screening and three comparison routes. Reproducible check: `backend/scripts/verify_terrain_api.py`; results: `usgs-terrain-verification.json`.

Coverage is still limited by actual stereo observations and valid pixels. The original location at 7.145 N, 166.786 E lies in a gap in the nearby CTX models checked. The interface preserves those coordinates and reports missing coverage; orbital photographs are never substituted for elevation or labeled as safe terrain.

Browser verification: English home and location details; 2D and 3D views on downloaded terrain; rover playback reaching 100%; 390 px home/planner layouts without horizontal overflow; missing-coverage feedback and disabled invalid animation. Proof images: `english-home.jpg`, `english-usgs-route-3d.jpg`, `english-mobile-coverage.jpg`. Source scan finds no remaining Arabic in frontend or backend application source. Node playback tests: 4 passed. Production build passed; backend regression results are recorded in `english-api-tests.log`.
