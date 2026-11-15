# MarsPath data integration — 2026-11-15

## Installed data and provenance

The supplied `MarsPath_Web_Data/public/mars-data` directory was copied into the
existing frontend public directory. Source files were retained unchanged.

- MOLA MEGT90N000EB COG: 5760 × 2880 cells, 3,705 m projected spacing, native
  Mars simple cylindrical CRS with central longitude 180°. Elevation queries
  transform the selected coordinates into that CRS and read the raster values,
  never color pixels. Regional slope is a coarse derivative, not a rover-scale
  hazard observation.
- MOLA globe display texture: shifted from its 0–360° seam to the application's
  −180–180° convention. Original texture and XYZ tiles are retained.
- HiRISE ESP_052869_1660_RED: the manifest advertises levels 8–17, but only level
  17 exists in this pack. There are 1,316 supplied tiles versus 2,150 tiles in
  the rectangular footprint. A bounded RGBA equirectangular mosaic was assembled
  from those tiles for the globe and 2D map. Missing tiles remain transparent.
  This is a lossy quicklook with label-bound placement, not a georeferenced DTM,
  calibrated rock-abundance layer or precision orthoimage.
- Official IAU/USGS gazetteer: 2,055 approved Mars names were imported from the
  official center-point KMZ linked by
  <https://planetarynames.wr.usgs.gov/Page/MARS/target>. The original KMZ is in
  backend/data. Lookup uses an approximate diameter extent; where there is no
  match, the nearest named feature and distance are explicitly identified.
  The result never claims exact feature boundaries or invents an official name.

The source normalization script is `backend/scripts/import_web_data.py`.
The machine-readable tile audit is `/mars-data/integration-audit.json`.

## Real terrain and access analysis

The surface planner now defaults to a 240 × 240 cell crop of the existing
NASA/JPL/USGS Jezero CTX DEM at 20 m/cell (4.8 × 4.8 km). Hillshade, slope,
roughness and route costs are computed from those actual elevation values.
Synthetic S1–S4 science sites are absent. A configured MARS_DEM_PATH still takes
precedence, and the labeled demo generator remains the last fallback if real
terrain is unavailable.

`GET /api/terrain/cell` returns the selected cell's geographic coordinates,
official naming context, profile-aware slope and roughness screening, and
reasons for blocked or uncertain travel. Map clicks inspect the cell while A/B
selection and all three existing route strategies remain available. The complete
route comparison checks connectivity, distance, energy reserve and terrain risk.
Point-to-point route failures retain the actual planner's failure reason.

Global selection reports distinguish insufficient local data from blocked
terrain. MOLA and HiRISE alone cannot establish small-obstacle traversability.
Unknown coverage is not treated as safe. Soil strength, calibrated rock
abundance, local weather and operational validation remain unavailable.

## User interface

- Every globe selection resolves a named feature or an explicitly qualified
  nearest named feature. Site panels show evidence coverage and access reasons.
- Mars Explorer offers `MOLA · supplied data` and `HiRISE · supplied imagery`
  layers in both 3D and 2D views. The planner's HiRISE button opens its footprint.
- The scientific data registry includes the new pack and official naming data.
- Real-terrain clicks show site names, coordinates, slope, roughness, the
  modeled cell class and a stated reason. The assessment follows the selected
  mobility profile and its slope override. Simulated obstacle reports remain
  explicitly identified as simulations.

## Verification

32 backend tests pass, including native-CRS COG sampling, global naming,
actual terrain and removal of synthetic sites, geographic cell inspection,
blocked-cell reasons under changed slope limits, invalid input, and transparent
HiRISE coverage gaps. Frontend TypeScript production build and lint pass.
Browser checks confirmed real CTX route results and cell inspection, supplied
HiRISE rendering, Coprates Catena naming, and the insufficient-data explanation
for the HiRISE footprint. Global lookup and map-layer controls were also checked.

Existing dependency advisories remain for Three.js bundle size, optional speech
module externalization, and library deprecations. No new package was installed.
