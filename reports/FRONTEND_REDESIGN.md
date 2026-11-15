# MARTIAN MAP frontend redesign

## Warm theme and selected-destination navigation — 2026-11-15

The current interface uses beige / white surfaces with orange and yellow accents.
The four Mission Control metrics are grouped in a compact 2 × 2 box beside the
globe (stacked below on phone widths). Home and Explorer share an explicit
planning origin and selected destination, with route calculation and map overlays.
The origin defaults to Jezero and can be set from the selected point or entered
as coordinates; it is not live rover telemetry.

`POST /api/surface/navigation` uses the existing CTX terrain and A* engine for
both selected endpoints. Coverage, valid coordinates, distinct grid cells and a
300-cell (6 km) maximum planning window are checked. Unmapped or unreachable
routes are reported explicitly. Existing comparison-waypoint endpoints remain.
Production build and lint pass; the expanded backend suite has 28 passing tests.

## Existing architecture and preservation plan

React 19 + TypeScript on Vite, Three.js / React Three Fiber, and a FastAPI backend.
There are no accounts or shared database connections. Candidates persist in the
existing `martian-map-candidates-v1` browser storage record.

Preserve the existing `home`, `explore`, `location`, `planner`, `survival`,
`navigation`, `comparison`, and `data` hash routes. Add dedicated `advisor`,
`simulator`, `landing`, `reports`, and `settings` views without replacing the
existing map, route planning, landing assessment, navigation demonstration,
speech, or AI implementations.

API contracts remain unchanged: `/api/health`, `/api/terrain`, `/api/profiles`,
`/api/routes`, `/api/landing`, `/api/landing/routes`, `/api/layers/...`,
`/api/navigation/demo`, `/api/guide`, and `/api/guide/mission`.

## Design and implementation

- Shared collapsible navigation, responsive top bar, searchable workspaces and
  landmarks, actual API connection status, and browser-local profile settings.
- Dark olive / gold design system across every existing workspace.
- Mission Control centered on the existing interactive globe and actual selected
  site assessments, with saved analyses and activity derived from saved records.
- Retain all route strategies, parameter controls, energy constraints, simulation
  events and replanning; expose a dedicated simulator and saved route reports.
- Expand location sections and reuse the site guide and landing engine for the
  dedicated Advisor and Landing Analysis views.
- Searchable dataset registry, browser-local reports, and meaningful display
  preferences. Preserve source citations and clearly label data limitations.

No scientific datasets, scores, backend models, or calculations are replaced.
Current weather, live rover telemetry, account authentication and unimplemented
datasets must never be presented as available.

A source snapshot from before the redesign is in `frontend-before-redesign.zip`.

## Verification — 2026-11-15

- Production TypeScript / Vite build: passed. Existing advisory messages remain
  for the Three.js dependency chunk and the optional speech library's Node module
  externalization. No packages were added.
- Frontend lint: passed without warnings.
- Backend regression suite: 26 passed. The existing Starlette / httpx
  deprecation warning remains. No backend source files were changed.
- Browser verification at 1440 × 1000 and 390 × 844. All 13 workspaces fit the
  narrow viewport without horizontal page overflow; wide data tables scroll
  within their containers. Mobile navigation closes after selection, releases
  the scroll lock, and excludes closed navigation from keyboard focus.
- Actual Jezero CTX assessment and derived factor values render; all eight
  analysis sections are available. Landing Analysis opens its suitability view.
- Three surface strategies recompute when the mobility profile changes. 2D and
  3D terrain render, simulation progresses, and obstacle injection triggers
  replanning. A saved paused simulation includes covered distance, modeled
  mission time, energy use, reported obstacles and the event log.
- Site save, comparison, report archive, JSON download, dataset filtering,
  global region search, explorer side-panel selection, and settings persistence
  were checked in the browser. Test display preferences were restored afterward.
- The original navigation lab still computes matching results; all seven
  survival evidence cards remain available. Arabic narration remains attached
  to the original report component and was not audibly tested.
- The AI request reaches the existing endpoint and reports the unconfigured
  model clearly. The local evidence guide remains usable. Live provider answers
  could not be verified without the existing server-side key and model settings.
- No application console errors occurred during the 3D verification; Three.js
  emits its existing Clock deprecation warning.

## Preview artifacts

- [Mission Control — desktop](mission-control-desktop.jpg)
- [Mission Control — mobile](mission-control-mobile.jpg)
- [Rover planner — desktop](rover-planner-desktop.jpg)

The development server already running at `http://127.0.0.1:5173/` was reused.
This was a local redesign; no Replit app, hosted Site, account, or backend
deployment was created or modified.
