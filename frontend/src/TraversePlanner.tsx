import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { bytes, decodeTerrain, f32 } from './api'
import { coordinatesLabel, LANDING_SITE } from './mars'
import type { Coordinates, SurfaceRoutes } from './mars'
import { key, useSurfaceNavigation } from './surfaceNavigationContext'
import { ROUTE_KEYS, ROUTE_STYLE } from './types'
import type { Cell, LayerId, Obstacle, RouteKey, RouteResult, Site, TerrainData } from './types'
import type { RouteReport } from './missionState'
import { fmtDist, fmtDur, LAYERS, renderLayer } from './render'
import { MOBILITY_OPTIONS } from './siteIntel'
import MapCanvas from './MapCanvas'
import MapBoundary from './MapBoundary'
import PlanetMap from './PlanetMap'
import ProfileChart from './ProfileChart'
import Icon from './Icon'
import { sampleRouteAtFraction } from './routePlayback'
import useRoutePlayback from './useRoutePlayback'
import { buildOrbitalTexture } from './orbitalTexture'

const Terrain3D = lazy(() => import('./Terrain3D'))
type Workspace = { terrain: TerrainData; result: RouteResult; latitude: Float32Array; longitude: Float32Array; evaluatedAt: string }
const LABELS: Record<RouteKey, string> = { safest: 'Lowest risk', shortest: 'Shortest', optimal: 'Balanced' }
const VISIBLE = { safest: true, shortest: true, optimal: true }
const NO_OBSTACLES: Obstacle[] = []
const NO_SITES: Site[] = []
type PlanningError = { message: string; code: string; missingEndpoints: string[] }

function CoordinateEditor({ label, point, unavailable, onChange }: { label: string; point: Coordinates; unavailable?: boolean; onChange: (p: Coordinates) => void }) {
  return <form className="endpoint-form" data-coverage={unavailable ? 'missing' : undefined} key={key(point)} onSubmit={(event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget)
    onChange({ latitude: Number(form.get('lat')), longitude: Number(form.get('lon')) })
  }}><b>{label}</b><label>Latitude<input type="number" name="lat" aria-label={label + ' latitude'} min={-90} max={90} step="any" required defaultValue={point.latitude} /></label><label>Longitude<input type="number" name="lon" aria-label={label + ' longitude'} min={-180} max={180} step="any" required defaultValue={point.longitude} /></label><button type="submit">Apply</button>{unavailable && <small className="endpoint-coverage">Local terrain unavailable at this point</small>}</form>
}

export default function TraversePlanner({ point, onSelect, onSave }: { point: Coordinates; onSelect: (p: Coordinates) => void; onSave: (r: RouteReport) => void }) {
  const navigation = useSurfaceNavigation()
  const origin = navigation.origin
  const [profile, setProfile] = useState('astronaut_eva')
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [attempt, setAttempt] = useState(0)
  const [response, setResponse] = useState<{ key: string; data?: Workspace; error?: PlanningError } | null>(null)
  const [view, setView] = useState<'2d' | '3d' | 'region'>('region')
  const [layer, setLayer] = useState<LayerId>('surface')
  // In 3D the surface defaults to the route map's orbital imagery; the terrain layers stay available.
  const [imagery3d, setImagery3d] = useState(true)
  const [orbital, setOrbital] = useState<{ key: string; canvas: HTMLCanvasElement | null } | null>(null)
  const [pickMode, setPickMode] = useState<'start' | 'goal' | null>(null)
  const [inspected, setInspected] = useState<Cell | null>(null)
  const [focus, setFocus] = useState({ sequence: 1, distance: 1.004 })
  const [zoom, setZoom] = useState({ sequence: 0, direction: 0 })
  const [tileStatus, setTileStatus] = useState('')
  const [saved, setSaved] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageVisible, setStageVisible] = useState(false)
  const [follow, setFollow] = useState(false)
  const requestKey = `${key(origin)}:${key(point)}:${profile}:${JSON.stringify(overrides)}:${attempt}`
  const current = response?.key === requestKey ? response : null
  const data = current?.data
  const error = current?.error
  const showRegion = view === 'region' || Boolean(error)
  const coverageMissing = error?.code === 'missing_local_terrain'
  const busy = !current
  const selected = navigation.strategy
  const route = data?.result.routes[selected]
  const base = useMemo(() => data ? renderLayer(data.terrain, layer, data.result.risk, data.result.cls) : null, [data, layer])
  const start = data?.terrain.suggested.start ?? [0, 0] as Cell
  const goal = data?.terrain.suggested.goal ?? [0, 0] as Cell
  const canAnimate = Boolean(route?.status === 'ok' && route.path.length > 1 && route.metrics.energy_feasible && route.verdict?.status !== 'unknown' && route.verdict?.status !== 'no_go')
  const playback = useRoutePlayback(`${requestKey}:${data?.evaluatedAt ?? 'pending'}:${selected}`, canAnimate,
    pickMode !== null || !stageVisible)
  const movement = useMemo(() => canAnimate ? sampleRouteAtFraction(route, playback.fraction) : null, [route, canAnimate, playback.fraction])
  const animationStatus = !canAnimate ? 'Waiting for a traversable route' : playback.fraction === 1 ? 'Arrived at B' : playback.playing ? 'Moving from A to B' : playback.started ? 'Paused' : 'Ready to play'
  // The same routes, converted from terrain cells to Mars coordinates, so they can be drawn
  // on the orbital map where A and B are chosen.
  const geoRoutes = useMemo<SurfaceRoutes | null>(() => {
    if (!data) return null
    const width = data.terrain.width
    const at = ([row, col]: Cell): [number, number] => [data.latitude[row * width + col], data.longitude[row * width + col]]
    const routes: SurfaceRoutes['routes'] = {}
    for (const k of ROUTE_KEYS) {
      const r = data.result.routes[k]
      if (r.status === 'ok' && r.path.length > 1) routes[k] = { points: r.path.map(at), metrics: r.metrics }
    }
    return { waypoint: [point.latitude, point.longitude], reason: null, routes }
  }, [data, point])
  const travelerOnMap = useMemo(() => {
    if (!data || !route || !movement || route.status !== 'ok') return null
    const width = data.terrain.width, last = route.path.length - 1
    const low = Math.min(last - 1, Math.floor(movement.index)), part = Math.min(1, movement.index - low)
    const a = route.path[low][0] * width + route.path[low][1], b = route.path[low + 1][0] * width + route.path[low + 1][1]
    return {
      position: { latitude: data.latitude[a] + (data.latitude[b] - data.latitude[a]) * part, longitude: data.longitude[a] + (data.longitude[b] - data.longitude[a]) * part },
      toward: { latitude: data.latitude[b], longitude: data.longitude[b] },
      kind: data.result.profile.kind, moving: playback.playing,
    }
  }, [data, route, movement, playback.playing])
  const orbitalKey = data ? `${requestKey}:${data.evaluatedAt}` : ''
  const wantsOrbital = view === '3d' && imagery3d && Boolean(data)
  const orbitalCanvas = orbital?.key === orbitalKey ? orbital.canvas : undefined
  useEffect(() => {
    if (!wantsOrbital || !data || orbital?.key === orbitalKey) return
    const controller = new AbortController()
    buildOrbitalTexture(data.latitude, data.longitude, data.terrain.width, data.terrain.height, controller.signal)
      .then((texture) => { if (!controller.signal.aborted) setOrbital({ key: orbitalKey, canvas: texture?.canvas ?? null }) })
      .catch(() => { if (!controller.signal.aborted) setOrbital({ key: orbitalKey, canvas: null }) })
    return () => controller.abort()
  }, [wantsOrbital, data, orbitalKey, orbital?.key])
  const surface3d = wantsOrbital && orbitalCanvas ? orbitalCanvas : base
  const orbitalStatus = !wantsOrbital ? '' : orbitalCanvas === undefined ? 'Loading orbital imagery for 3D…' : orbitalCanvas === null ? 'Orbital imagery unavailable · showing terrain layer' : ''
  const revealMap = () => {
    setPickMode(null)
    if (!stageVisible) stageRef.current?.scrollIntoView({ block: 'center', behavior: playback.autoplay ? 'smooth' : 'auto' })
  }

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setStageVisible(entry.intersectionRatio >= 0.3), { threshold: [0, 0.3] })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/surface/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ origin, destination: point, profile, overrides }), signal: controller.signal })
        const json = await res.json().catch(() => null)
        if (!res.ok) {
          if (!controller.signal.aborted) setResponse({ key: requestKey, error: {
            message: typeof json?.detail === 'string' ? json.detail : 'Route service unavailable. Try again.',
            code: typeof json?.code === 'string' ? json.code : 'service_error',
            missingEndpoints: Array.isArray(json?.missingEndpoints) ? json.missingEndpoints : [],
          } })
          return
        }
        if (!json?.terrain || !json?.result || !json?.geography) throw new Error('Invalid planning response')
        const result: Workspace = { terrain: decodeTerrain(json.terrain),
          result: { ...json.result, risk: bytes(json.result.layers.risk), cls: bytes(json.result.layers.cls) },
          latitude: f32(json.geography.latitude), longitude: f32(json.geography.longitude), evaluatedAt: json.evaluatedAt }
        if (!controller.signal.aborted) { setResponse({ key: requestKey, data: result }); setSaved(false); setInspected(null) }
      } catch {
        if (!controller.signal.aborted) setResponse({ key: requestKey, error: { message: 'Could not connect to the route service. Try again.', code: 'service_error', missingEndpoints: [] } })
      }
    }, 150)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [requestKey, origin, point, profile, overrides])

  const choose = (p: Coordinates) => {
    if (pickMode === 'start') navigation.setOrigin(p)
    else onSelect(p)
    setPickMode(null)
  }
  const useCoveredExample = () => {
    navigation.setOrigin(LANDING_SITE); onSelect({ latitude: 18.455, longitude: 77.455 }); setView('region'); setPickMode(null)
  }
  const pickCell = (cell: Cell) => {
    if (!data) return
    const index = cell[0] * data.terrain.width + cell[1]
    if (pickMode) choose({ latitude: data.latitude[index], longitude: data.longitude[index] })
    else setInspected(cell)
  }
  const save = () => {
    if (!data) return
    onSave({ id: crypto.randomUUID(), savedAt: new Date().toISOString(), selected, start, goal,
      terrain: data.terrain.meta, profile: data.result.profile, weights: { distance: data.result.weights.distance ?? 0, time: data.result.weights.time ?? 0,
        energy: data.result.weights.energy ?? 0, risk: data.result.weights.risk ?? 0, science: data.result.weights.science ?? 0 },
      routes: Object.fromEntries(ROUTE_KEYS.flatMap((k) => data.result.routes[k].status === 'ok' ? [[k, data.result.routes[k].metrics]] : [])),
      events: [{ clock: 'A → B', text: `${coordinatesLabel(origin)} → ${coordinatesLabel(point)}` }],
      simulation: { status: playback.fraction === 1 ? 'complete' : playback.playing ? 'running' : playback.started ? 'paused' : 'ready',
        covered_m: movement?.distance ?? 0, mission_time_s: movement?.time ?? 0, energy_used_wh: movement?.energy ?? 0,
        remaining_usable_wh: (route?.metrics?.energy_usable_wh ?? 0) - (movement?.energy ?? 0), reported_obstacles: 0 },
    }); setSaved(true)
  }
  const terrainMap = data && base ? <MapCanvas terrain={data.terrain} base={base} risk={data.result.risk} cls={data.result.cls}
    routes={data.result.routes} visible={VISIBLE} selected={selected} start={start} goal={goal} obstacles={NO_OBSTACLES} sites={NO_SITES}
    traveler={movement?.traveler ?? null} progress={movement?.index ?? null} moving={playback.playing} kind={data.result.profile.kind} revealId={playback.revealId}
    pickMode={pickMode} onPick={pickCell} onSelectRoute={navigation.setStrategy} onCancel={() => setPickMode(null)} /> : null
  const local = data && base ? view === '3d' ? <MapBoundary fallback={<div className="planner-empty"><p>3D view is unavailable on this device.</p><button onClick={() => setView('region')}>Open route map</button></div>}><Suspense fallback={<div className="planner-empty" role="status">Building 3D terrain…</div>}><Terrain3D terrain={data.terrain} base={surface3d!} routes={data.result.routes}
    visible={VISIBLE} selected={selected} start={start} goal={goal} obstacles={NO_OBSTACLES} sites={NO_SITES}
    traveler={movement?.traveler ?? null} progress={movement?.index ?? null} moving={playback.playing} kind={data.result.profile.kind}
    exaggeration={2} follow={follow} autoRotate={false} intro={false} revealId={playback.revealId} pickMode={pickMode} onPick={pickCell} onSelectRoute={navigation.setStrategy} /></Suspense></MapBoundary> : terrainMap : null
  return <section className="traverse-page">
    <header className="traverse-heading" dir="ltr"><div><h1>Plan your route</h1><p>{error ? 'Check elevation coverage at A and B before planning.' : 'Set A and B to compare three routes across real terrain.'}</p></div><button className="button-with-icon" disabled={!data || busy || !ROUTE_KEYS.some((k) => data.result.routes[k].status === 'ok')} onClick={save}><Icon name={saved ? 'check' : 'reports'} size={17} />{saved ? 'Report saved' : 'Save report'}</button></header>
    {error && <section className="planner-availability" role="alert" dir="ltr">
      <Icon name="shield" size={24} /><div><h2>{coverageMissing ? 'Elevation coverage is missing' : 'Could not calculate this route'}</h2><p>{error.message}</p><p className="availability-note">{coverageMissing ? 'Missing coverage leaves traversability unknown. Your selected endpoints are preserved.' : 'No route was calculated. Review your endpoints or try again.'}</p><div className="availability-actions"><button className="primary" onClick={useCoveredExample}>Try a covered Jezero route</button><a className="button-link" href="#location">View destination details</a><button onClick={() => setAttempt((v) => v + 1)}>Retry</button></div></div>
    </section>}
    <div className="traverse-endpoints" dir="ltr">
      <CoordinateEditor label="A · Starting point" point={origin} unavailable={error?.missingEndpoints.includes('origin')} onChange={navigation.setOrigin} />
      <button className="swap-endpoints" aria-label="Swap endpoints" onClick={() => { navigation.setOrigin(point); onSelect(origin) }}>⇄</button>
      <CoordinateEditor label="B · Destination" point={point} unavailable={error?.missingEndpoints.includes('destination')} onChange={onSelect} />
    </div>
    <div className="traverse-toolbar">
      <div className="seg" role="group" aria-label="Map view">
        <button aria-pressed={showRegion} onClick={() => setView('region')}>Route map</button>
        <button aria-pressed={view === '2d' && !showRegion} disabled={!data} title={!data ? 'An elevation model is required to show terrain risk' : undefined} onClick={() => setView('2d')}>Terrain risk</button>
        <button aria-pressed={view === '3d' && !showRegion} disabled={!data} title={!data ? 'An elevation model is required to show terrain' : undefined} onClick={() => setView('3d')}>3D terrain</button>
      </div>
      <label>Mobility <select value={profile} onChange={(e) => { setProfile(e.target.value); setOverrides({}) }}>{MOBILITY_OPTIONS.map((p) => <option value={p.id} key={p.id}>{p.label}</option>)}</select></label>
      <label>{view === '3d' && !showRegion ? '3D surface' : 'Terrain layer'} <select disabled={showRegion || !data} value={view === '3d' && imagery3d ? 'imagery' : layer} onChange={(e) => {
        if (e.target.value === 'imagery') setImagery3d(true)
        else { setImagery3d(false); setLayer(e.target.value as LayerId) }
      }}>{view === '3d' && <option value="imagery">Orbital imagery (route map)</option>}{LAYERS.map((l) => <option value={l.id} key={l.id}>{l.label}</option>)}</select></label>
    </div>
    <details className="traverse-assumptions" dir="ltr"><summary>Mobility and energy settings</summary><div><label>Slope limit: {overrides.max_slope_deg ?? data?.result.profile.max_slope_deg ?? '—'}°<input aria-label="Slope limit" type="range" min={4} max={40} step={1} disabled={busy || !data} value={overrides.max_slope_deg ?? data?.result.profile.max_slope_deg ?? 20} onChange={(e) => setOverrides((v) => ({ ...v, max_slope_deg: Number(e.target.value) }))} /></label><label>Energy budget (Wh)<input aria-label="Energy budget" type="number" min={1} max={1000000} disabled={busy || !data} value={overrides.capacity_wh ?? data?.result.profile.capacity_wh ?? ''} onChange={(e) => { const value = Number(e.target.value); if (value >= 1 && value <= 1000000) setOverrides((v) => ({ ...v, capacity_wh: value })) }} /></label><button disabled={!Object.keys(overrides).length} onClick={() => setOverrides({})}>Reset defaults</button></div><p>Routes update automatically. A connected path may still exceed your energy budget.</p></details>
    <div className="traverse-layout">
      <div className="traverse-map-column">
        <div className="traverse-map-panel">
          <div className="traverse-map-title"><span><i className="signal-dot" /> {showRegion ? 'Route map · orbital imagery' : view === '3d' ? (imagery3d ? '3D terrain · orbital imagery on CTX elevation' : '3D terrain · CTX elevation') : 'Terrain risk · CTX elevation'}{orbitalStatus && <small role="status"> · {orbitalStatus}</small>}</span><span>{showRegion ? 'NASA / USGS' : data ? `${data.terrain.cell_size} m / cell` : 'NASA / JPL / USGS'}</span></div>
          <div className="traverse-pick"><button aria-pressed={pickMode === 'start'} onClick={() => setPickMode(pickMode === 'start' ? null : 'start')}><span>A</span> Set starting point</button><button aria-pressed={pickMode === 'goal'} onClick={() => setPickMode(pickMode === 'goal' ? null : 'goal')}><span>B</span> Set destination</button></div>
          <section className="route-playback" aria-label="Route playback" data-state={playback.fraction === 1 ? 'complete' : playback.playing ? 'playing' : 'paused'} dir="ltr">
            <div className="playback-heading"><div><h2>Follow the {data?.result.profile.kind === 'rover' ? 'rover' : 'astronaut'} along your route</h2></div><span className="playback-status" role="status">{animationStatus}</span></div>
            <div className="playback-controls">
              <button className="primary" disabled={!canAnimate} onClick={() => { if (playback.playing) playback.pause(); else { revealMap(); playback.play() } }}>{playback.playing ? '⏸ Pause' : playback.fraction === 1 ? '▶ Replay' : playback.started ? '▶ Resume' : '▶ Play route'}</button>
              <button disabled={!canAnimate} onClick={() => { revealMap(); playback.restart() }}>↺ Restart at A</button>
              <div className="seg" role="group" aria-label="Playback speed">{[0.5, 1, 2, 4].map((speed) => <button key={speed} aria-pressed={playback.speed === speed} disabled={!canAnimate} onClick={() => playback.setSpeed(speed)}>{speed}×</button>)}</div>
              {view === '3d' && <label className="playback-follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />Follow camera</label>}
            </div>
            {canAnimate ? <>
              <div className="playback-timeline"><span>A</span><input aria-label="Route progress" type="range" min={0} max={100} step={0.1} value={playback.fraction * 100} onChange={(e) => playback.seek(Number(e.target.value) / 100)} /><span>B</span><output aria-label="Route completion">{Math.round(playback.fraction * 100)}%</output></div>
              <div className="playback-metrics"><span>Distance travelled<b>{fmtDist(movement?.distance ?? 0)} / {fmtDist(route?.metrics.distance_m ?? 0)}</b></span><span>Elapsed mission time<b>{fmtDur(movement?.time ?? 0)}</b></span><span>Energy used<b>{(movement?.energy ?? 0).toFixed(0)} Wh</b></span></div>
              <p className="playback-note">{LABELS[selected]} · Accelerated simulation, not a live feed. {playback.autoplay ? 'Playback pauses when the map leaves view.' : 'Press Play to begin. Autoplay is disabled by your reduced motion preference.'}</p>
            </> : <div className="playback-unavailable"><p>{busy ? 'Playback will be ready when route calculation finishes.' : error ? 'A route within elevation coverage is required for playback.' : route?.reason ?? route?.verdict?.label ?? 'Set A and B to calculate and animate a route.'}</p>{!busy && (error || !data) && <button onClick={useCoveredExample}>Try a Jezero route</button>}{!busy && data && !error && Object.keys(overrides).length > 0 && <button onClick={() => setOverrides({})}>Reset mobility settings</button>}</div>}
          </section>
          <p id="map-instructions" className="traverse-hint" dir="ltr" role="status">{pickMode ? `Click the ${showRegion ? 'map' : 'terrain'} ${pickMode === 'start' ? 'to set starting point A' : 'to set destination B'}.` : showRegion ? 'Routes calculated on 20 m elevation, drawn over orbital imagery. Select A or B, then click the map to move an endpoint.' : 'Click a route to see its assessment. Select A or B to move an endpoint.'}</p>
          <div ref={stageRef} className={'traverse-stage ' + (view === '3d' ? 'is-3d' : '')} aria-busy={busy} style={{ '--terrain-aspect': data ? data.terrain.width / data.terrain.height : 1 } as CSSProperties}>
            {showRegion ? <><PlanetMap point={point} origin={origin} frameEndpoints minimumFrameSpan={error ? 8 : 0.025} focus={focus} zoom={zoom} layer="natural" grid={false} showSlopes={false} hazard={null} paths={geoRoutes} traveler={travelerOnMap} activeRoute={selected} onSelect={(p) => { if (pickMode) choose(p) }} onTileStatus={setTileStatus} /><div className="mars-stage-controls"><button aria-label="Zoom in" onClick={() => setZoom((z) => ({ sequence: z.sequence + 1, direction: 1 }))}>+</button><button aria-label="Zoom out" onClick={() => setZoom((z) => ({ sequence: z.sequence + 1, direction: -1 }))}>−</button><button aria-label="Show both endpoints" onClick={() => setFocus((f) => ({ sequence: f.sequence + 1, distance: 1.004 }))}>◎</button></div></> : local}
            {canAnimate && <div className="map-playback-controls" role="group" aria-label="Map playback controls" dir="ltr">
              <button className="primary" aria-label={playback.playing ? 'Pause route playback' : 'Play route animation'} onClick={() => { if (playback.playing) playback.pause(); else playback.play() }}>{playback.playing ? '⏸ Pause' : '▶ Play'}</button>
              <button aria-label="Restart animation at A" onClick={playback.restart}>↺ Restart</button>
              <button aria-label="Change playback speed" onClick={() => { const speeds = [.5, 1, 2, 4]; playback.setSpeed(speeds[(speeds.indexOf(playback.speed) + 1) % speeds.length]) }}>{playback.speed}×</button>
              <span className="map-playback-percent">{Math.round(playback.fraction * 100)}% <small>A → B</small></span>
            </div>}
            {busy && <div className="planner-loading" role="status"><span className="orbital-spinner" /><b>Loading elevation and calculating routes…</b><small>Real elevation · mobility and energy limits</small></div>}
          </div>
          <div className="traverse-map-footer"><span>{showRegion ? 'NASA / JPL / USGS orbital imagery' : data ? `${fmtDist(data.terrain.meta.extent_m[0])} × ${fmtDist(data.terrain.meta.extent_m[1])}` : 'Choose endpoints on the map or enter coordinates'}</span><span>{showRegion ? 'Routes from elevation · imagery for context' : view === '3d' ? 'Vertical scale exaggerated ×2' : 'Red: high risk or blocked terrain'}</span></div>
        </div>
        {inspected && data && <div className="inspected-terrain" dir="ltr"><b>Selected point</b><span dir="ltr">{coordinatesLabel({ latitude: data.latitude[inspected[0] * data.terrain.width + inspected[1]], longitude: data.longitude[inspected[0] * data.terrain.width + inspected[1]] })}</span><span>Slope {data.terrain.slope[inspected[0] * data.terrain.width + inspected[1]].toFixed(1)}°</span><button onClick={() => onSelect({ latitude: data.latitude[inspected[0] * data.terrain.width + inspected[1]], longitude: data.longitude[inspected[0] * data.terrain.width + inspected[1]] })}>Set as destination</button></div>}
        {data && <details className="route-elevation"><summary>Elevation and energy profile</summary><ProfileChart routes={data.result.routes} visible={VISIBLE} selected={selected} progress={movement?.index ?? null} usableWh={route?.metrics?.energy_usable_wh ?? 0} /></details>}
        <p className="traverse-source" dir="ltr">{showRegion ? 'Routes are calculated on CTX elevation and drawn over orbital imagery; imagery alone does not establish traversability. ' : `${data?.terrain.meta.source ?? 'NASA / USGS CTX'}. Routes are model estimates; small rocks, soil strength and live weather are unmeasured. `}{data && `Calculated ${new Date(data.evaluatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`} {showRegion && tileStatus}</p>
      </div>
      <aside className="traverse-intelligence" dir="ltr"><div className="route-section-heading"><h2>{error ? 'Assessment unavailable' : 'Compare routes'}</h2><p>{error ? 'No route results are available for these endpoints.' : 'Select a route to see its assessment.'}</p></div>

        {(['safest', 'shortest', 'optimal'] as RouteKey[]).map((strategy) => {
          const r = data?.result.routes[strategy]
          return <button className="traverse-route-card" key={strategy} disabled={!r || busy} aria-pressed={Boolean(r && selected === strategy)} onClick={() => navigation.setStrategy(strategy)} style={{ '--route-color': ROUTE_STYLE[strategy].color } as CSSProperties}>
            <div className="route-card-top"><span className="route-swatch" /><b>{LABELS[strategy]}</b></div><p className="route-card-purpose">{strategy === 'safest' ? 'Reduces exposure to steep, rough and uncertain terrain' : strategy === 'shortest' ? 'Shortest connection within mobility limits' : 'Balances distance, time, energy and terrain risk'}</p>
            {!error && <div className="route-card-metrics"><span>Distance<b>{r?.status === 'ok' ? fmtDist(r.metrics.distance_m) : '—'}</b></span><span>Duration<b>{r?.status === 'ok' ? fmtDur(r.metrics.duration_s) : '—'}</b></span><span>Risk index<b>{r?.status === 'ok' ? `${r.metrics.risk_score.toFixed(0)} / 100` : '—'}</b></span></div>}
            <span className="route-card-verdict" data-status={r?.verdict?.status ?? (error ? 'unknown' : undefined)}>{r?.verdict?.label ?? (busy ? 'Calculating…' : coverageMissing ? 'Not calculated · elevation coverage missing' : 'Not calculated · review the reason above')}</span>
          </button>
        })}
        {route?.verdict && <section className="route-decision" data-status={route.verdict.status} aria-live="polite"><h3>{route.verdict.label}</h3><ul>{route.verdict.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p>The risk index is a relative model score, not an accident probability.</p></section>}
      </aside>
    </div>
  </section>
}
