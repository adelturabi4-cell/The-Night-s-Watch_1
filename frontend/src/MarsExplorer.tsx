import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import LandingReport from './LandingReport'
import PlanetMap from './PlanetMap'
import { coordinatesLabel, fetchMars, fetchSiteRoutes, LANDMARKS } from './mars'
import type { Assessment, Coordinates, SiteRouteSettings, SurfaceRoutes } from './mars'
import { ROUTE_STYLE } from './types'
import type { RouteKey } from './types'
import { HIRISE_BOUNDS, HIRISE_CENTER, PLANET_LAYERS } from './planetLayers'
import type { PlanetLayer } from './planetLayers'
import './mars.css'
import MapBoundary from './MapBoundary'
import type { AnalysisTab } from './LandingReport'
import SurfaceNavigation from './SurfaceNavigation'
import { useSurfaceNavigation } from './surfaceNavigationContext'
import SiteVerdict from './SiteVerdict'
import { fetchRoverTrack } from './siteIntel'
import type { RoverTrack } from './siteIntel'

const MarsGlobe = lazy(() => import('./MarsGlobe'))
const INITIAL_POINT: Coordinates = { latitude: 12.5, longitude: 48.5 }

function supportsGlobe() {
  try {
    const context = document.createElement('canvas').getContext('webgl2')
    context?.getExtension('WEBGL_lose_context')?.loseContext()
    return context !== null
  } catch {
    return false
  }
}

function CoordinateForm({ point, onSelect }: { point: Coordinates; onSelect: (point: Coordinates) => void }) {
  return (
    <form className="mars-coordinate-form" key={coordinatesLabel(point)} onSubmit={(e) => {
      e.preventDefault()
      const data = new FormData(e.currentTarget)
      onSelect({ latitude: Number(data.get('latitude')), longitude: Number(data.get('longitude')) })
    }}>
      <label>Latitude <input name="latitude" aria-label="Latitude" type="number" min={-90} max={90} step="any" required defaultValue={point.latitude.toFixed(4)} /></label>
      <label>Longitude <input name="longitude" aria-label="Longitude" type="number" min={-180} max={180} step="any" required defaultValue={point.longitude.toFixed(4)} /></label>
      <button type="submit">Locate</button>
    </form>
  )
}

interface Props {
  reportTarget: HTMLDivElement | null
  settings: SiteRouteSettings
  activeRoute: RouteKey
  onSelectRoute: (strategy: RouteKey) => void
  selectedSite: Coordinates | null
  onSite: (point: Coordinates, openReport?: boolean) => void
  onSave: (point: Coordinates, assessment: Assessment) => void
  onOpenReport: () => void
  reportPage: boolean
  reportSection?: AnalysisTab
}

export default function MarsExplorer({ reportTarget, settings, activeRoute, onSelectRoute, selectedSite: point, onSite, onSave, onOpenReport, reportPage, reportSection = 'overview' }: Props) {
  const [request, setRequest] = useState(0)
  const [report, setReport] = useState<{ point: Coordinates; assessment: Assessment | null; error: string | null; request: number } | null>(null)
  const activeReport = report?.point === point && report.request === request ? report : null
  const assessment = activeReport?.assessment ?? null
  const error = activeReport?.error ?? null
  const [routeAttempt, setRouteAttempt] = useState(0)
  const [routeResponse, setRouteResponse] = useState<{
    point: Coordinates; settings: SiteRouteSettings; attempt: number; paths: SurfaceRoutes | null; error: string | null
  } | null>(null)
  const atHirise = point && point.latitude >= HIRISE_BOUNDS.south && point.latitude <= HIRISE_BOUNDS.north && point.longitude >= HIRISE_BOUNDS.west && point.longitude <= HIRISE_BOUNDS.east
  const [focus, setFocus] = useState({ sequence: 0, distance: atHirise ? 1.001 : 3.45 })
  const [zoom, setZoom] = useState({ sequence: 0, direction: 0 })
  const [showRelief, setShowRelief] = useState(true)
  const [showHazard, setShowHazard] = useState(false)
  const [showSlopes, setShowSlopes] = useState(false)
  const [layer, setLayer] = useState<PlanetLayer>(() => atHirise ? 'packHirise' : 'natural')
  const [globeAvailable] = useState(supportsGlobe)
  const [mapView, setMapView] = useState(() => globeAvailable ? '3d' : '2d')
  const [grid, setGrid] = useState(false)
  const [showLandmarks, setShowLandmarks] = useState(true)
  const [showRover, setShowRover] = useState(false)
  const [roverTrack, setRoverTrack] = useState<RoverTrack | null>(null)
  const [roverError, setRoverError] = useState('')
  const navigation = useSurfaceNavigation()
  const [tileStatus, setTileStatus] = useState('')
  const [search, setSearch] = useState('')
  const globeStage = useRef<HTMLDivElement>(null)
  const currentResponse = routeResponse?.point === point && routeResponse.settings === settings && routeResponse.attempt === routeAttempt ? routeResponse : null
  const paths = assessment?.routeAvailable ? currentResponse?.paths ?? null : null
  const navigationPaths = navigation.pathsFor(point)
  const routeError = assessment?.routeAvailable ? currentResponse?.error ?? null : null

  const focusAt = (distance: number) => setFocus((current) => ({ sequence: current.sequence + 1, distance }))

  const select = (coordinates: Coordinates, distance = 2.85, openReport = false) => {
    setShowHazard(false)
    onSite({ latitude: coordinates.latitude, longitude: coordinates.longitude }, openReport)
    focusAt(distance)
  }

  useEffect(() => {
    if (!point) return
    const controller = new AbortController()
    let timer = 0, polls = 0
    const load = async () => {
      try {
        const result = await fetchMars<Assessment>('', point, controller.signal)
        if (controller.signal.aborted) return
        setReport({ point, assessment: result, error: null, request })
        if (result.elevationLookup?.status === 'pending' && polls++ < 40) timer = window.setTimeout(load, 1500)
      } catch (e) {
        if (!controller.signal.aborted) setReport((previous) => previous?.point === point && previous.assessment
          ? previous : { point, assessment: null, error: e instanceof Error ? e.message : 'Site data unavailable.', request })
      }
    }
    void load()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [point, request])

  useEffect(() => {
    if (!point || !assessment?.routeAvailable) return
    const controller = new AbortController()
    // Use the same delay as the local planner when the mission sliders move.
    const timer = window.setTimeout(() => {
      fetchSiteRoutes(point, settings, controller.signal)
        .then((paths) => {
          if (!controller.signal.aborted) setRouteResponse({ point, settings, attempt: routeAttempt, paths, error: null })
        })
        .catch((e) => {
          if (!controller.signal.aborted) setRouteResponse({ point, settings, attempt: routeAttempt, paths: null, error: e.message })
        })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [point, assessment, settings, routeAttempt])

  useEffect(() => {
    if (!showRover || roverTrack) return
    let active = true
    fetchRoverTrack().then((track) => { if (active) setRoverTrack(track) })
      .catch((e) => { if (active) { setRoverError(e.message); setShowRover(false) } })
    return () => { active = false }
  }, [showRover, roverTrack])

  const showRoutes = () => {
    if (!point) return
    if (!paths?.waypoint) {
      setRouteAttempt((attempt) => attempt + 1)
      return
    }
    if (reportPage) location.hash = 'explore'
    focusAt(1.00145)
    requestAnimationFrame(() => globeStage.current?.scrollIntoView({ block: 'center' }))
  }

  return (
    <div className="mars-explorer">
      {!reportPage && <section className="mars-workspace" aria-label="Mars globe controls">
        <div className="mars-stage" ref={globeStage}>
          <div className="mars-stage-top">
            <div><strong>{PLANET_LAYERS[layer].label}</strong><span>{PLANET_LAYERS[layer].source} · {PLANET_LAYERS[layer].resolution}</span>
              {tileStatus && <span role="status">{tileStatus}</span>}
              {paths?.routes[activeRoute] && <span className="mars-active-route">{ROUTE_STYLE[activeRoute].label} route highlighted</span>}
            </div>
            <span className="mars-stage-north"><i /> N</span>
          </div>
          {mapView === '3d' ? <MapBoundary fallback={<div className="mars-globe-fallback"><p>3D rendering is unavailable.</p><button onClick={() => setMapView('2d')}>Use interactive 2D map</button></div>}><Suspense fallback={<p className="mars-globe-fallback" role="status">Loading Mars imagery…</p>}>
            <MarsGlobe point={point ?? INITIAL_POINT} marked={point !== null} onSelect={select} hazard={assessment?.hazard ?? null} showHazard={showHazard} showSlopes={showSlopes}
              showRelief={showRelief} layer={layer} grid={grid} showLandmarks={showLandmarks} onTileStatus={setTileStatus} paths={navigationPaths ?? paths} activeRoute={navigationPaths ? navigation.strategy : activeRoute} focus={focus} zoom={zoom} />
          </Suspense></MapBoundary> : <PlanetMap point={point} focus={focus} zoom={zoom} layer={layer} grid={grid} showSlopes={showSlopes} rover={showRover ? roverTrack : null}
            hazard={showHazard ? assessment?.hazard ?? null : null} paths={navigationPaths ?? paths} activeRoute={navigationPaths ? navigation.strategy : activeRoute} onSelect={select} onTileStatus={setTileStatus} />}
          <div className="mars-stage-controls" role="group" aria-label="Globe camera">
            <button aria-label="Zoom in" title="Zoom in" onClick={() => setZoom((current) => ({ sequence: current.sequence + 1, direction: 1 }))}>+</button>
            <button aria-label="Zoom out" title="Zoom out" onClick={() => setZoom((current) => ({ sequence: current.sequence + 1, direction: -1 }))}>−</button>
            <button aria-label="Reset globe view" title="Reset globe view" onClick={() => focusAt(3.45)}>↺</button>
          </div>
          <div className="mars-stage-bottom">
            <span>{mapView === '3d' ? 'Drag to rotate · Select a site' : 'Drag to pan · Select a site'}</span>
            {point && <span>{coordinatesLabel(point)}</span>}
          </div>
        </div>
        {layer === 'packHirise' && <p className="map-service-note">HiRISE quicklook: partial coverage only. Transparent gaps show the Viking base layer; no missing observations are filled in. Placement uses label bounds, not a precision orthoimage.</p>}
        {point && <SurfaceNavigation point={point} onFocus={() => focusAt(1.003)} />}
        <div className="mars-map-tools">
          <CoordinateForm point={point ?? INITIAL_POINT} onSelect={select} />
          <div className="mars-layers" role="group" aria-label="Globe layers">
            <label>View <select aria-label="Map view" value={mapView} onChange={(e) => { setTileStatus(''); setMapView(e.target.value) }}>
              <option value="3d" disabled={!globeAvailable}>3D globe</option><option value="2d">2D map</option>
            </select></label>
            <label>Map layer <select value={layer} onChange={(e) => {
              const next = e.target.value as PlanetLayer
              setTileStatus('')
              setLayer(next)
              if (next === 'ctx') select(LANDMARKS[0], 1.002, false)
              if (next === 'packHirise') select(HIRISE_CENTER, 1.001, false)
            }}>
              {Object.entries(PLANET_LAYERS).map(([id, info]) => <option key={id} value={id}>{info.label}</option>)}
            </select></label>
            <label><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Coordinate grid</label>
            <label><input type="checkbox" checked={mapView === '3d' && showLandmarks} disabled={mapView === '2d'} onChange={(e) => setShowLandmarks(e.target.checked)} /> Named region markers · 3D</label>
            <label><input type="checkbox" disabled={mapView === '2d'} checked={mapView === '3d' && showRelief} onChange={(e) => setShowRelief(e.target.checked)} /> MOLA relief</label>
            <label><input type="checkbox" checked={showHazard} disabled={!assessment?.hazard} onChange={(e) => {
              setShowHazard(e.target.checked)
              if (e.target.checked && !paths) focusAt(1.18)
            }} /> Nearest crater rim</label>
            <label><input type="checkbox" checked={showSlopes} onChange={(e) => {
              setShowSlopes(e.target.checked)
              if (e.target.checked && assessment?.level === 'local') focusAt(1.002)
            }} /> Steep terrain · Jezero</label>
            <label><input type="checkbox" checked={showRover} onChange={(e) => {
              setRoverError('')
              setShowRover(e.target.checked)
              if (e.target.checked) { setMapView('2d'); select(LANDMARKS[0], 1.004, false) }
            }} /> Perseverance traverse · 2D</label>
            {roverError && <span role="alert">{roverError}</span>}
          </div>
        </div>
        <div className="mars-landmarks" role="group" aria-label="Explore named regions">
          <input aria-label="Search regions" placeholder="Search regions" value={search} onChange={(e) => setSearch(e.target.value)} />
          {LANDMARKS.filter(({ feature, name }) => `${feature} ${name}`.toLowerCase().includes(search.trim().toLowerCase())).map((feature) => (
            <button key={feature.name} aria-pressed={point?.latitude === feature.latitude && point.longitude === feature.longitude} onClick={() => select(feature)}>{feature.name}</button>
          ))}
        </div>
        {point && (
          <button className="mars-jump-report" onClick={() => {
            onOpenReport()
          }}>Open site report</button>
        )}
        <details className="mars-data">
          <summary>Data sources and coverage</summary>
          <ul>
            <li>Display imagery · <a href="https://maps.jpl.nasa.gov/tmaps/mars.html" target="_blank" rel="noreferrer">Viking mosaic, Caltech/JPL/USGS</a>, 4 pixels per degree.</li>
            <li>Global topography · <a href="https://pds-geosciences.wustl.edu/missions/mgs/megdr.html" target="_blank" rel="noreferrer">NASA PDS MOLA MEGDR</a>, 0.25° cells (about 15 km near the equator).</li>
            <li>Local terrain · <a href="https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic" target="_blank" rel="noreferrer">Mars 2020 Jezero CTX DEM</a>, 20 m cells, 12.8 × 12.8 km study area.</li>
            <li>Impact craters · <a href="https://doi.org/10.1029/2011JE003966" target="_blank" rel="noreferrer">Robbins and Hynek catalog</a>, diameters of 1 km and larger.</li>
            <li>Named features · <a href="https://planetarynames.wr.usgs.gov/Page/MARS/system" target="_blank" rel="noreferrer">IAU/USGS Gazetteer</a>, approximate region matching.</li>
            <li>Gold rings mark approximate named regions. They are not live rover positions; live rover tracking is not connected.</li>
            <li>Supplied MarsPath MOLA: 3,705 m elevation cells. HiRISE ESP_052869_1660_RED: partial imagery only; no DTM, and missing tiles remain transparent.</li>
          </ul>
        </details>
      </section>}
      {point && reportTarget && createPortal(
        <><SiteVerdict point={point} defaultProfile={settings.profile} onPlanRoute={() => { location.hash = 'planner' }} />
        <LandingReport key={coordinatesLabel(point) + reportSection} initialTab={reportSection} point={point} assessment={assessment} error={error}
          onRetry={() => setRequest((value) => value + 1)} full={reportPage}
          onOpenReport={onOpenReport} onSave={() => { if (assessment) onSave(point, assessment) }}
          showHazard={showHazard} onShowHazard={() => { setShowHazard(true); focusAt(1.08); if (reportPage) location.hash = 'explore' }}
          onShowSlopes={() => { setShowSlopes(true); focusAt(1.002); if (reportPage) location.hash = 'explore' }}
          paths={paths} activeRoute={activeRoute} routeBusy={Boolean(assessment?.routeAvailable && !paths && !routeError)}
          routeError={routeError} onShowRoutes={showRoutes} onSelectRoute={onSelectRoute} /></>,
        reportTarget,
      )}
    </div>
  )
}
