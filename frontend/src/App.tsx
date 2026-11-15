import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Assessment, Coordinates } from './mars'
import { fetchProfiles, fetchRoutes, fetchTerrain } from './api'
import MapCanvas from './MapCanvas'
import MarsExplorer from './MarsExplorer'
import ProfileChart from './ProfileChart'
import { CLASS_INFO, LAYERS, fmtDist, fmtDur, lerpAt, renderLayer, rgbCss } from './render'
import type { Cell, LayerId, Metrics, Obstacle, Profile, RouteKey, RouteResult, TerrainData, Weights } from './types'
import { ROUTE_KEYS, ROUTE_OBJECTIVE, ROUTE_STYLE } from './types'
import Icon from './Icon'
import CellInspector from './CellInspector'
import type { RouteReport } from './missionState'
import { LANDMARKS } from './mars'
import { HIRISE_CENTER } from './planetLayers'

const Terrain3D = lazy(() => import('./Terrain3D'))

interface LogEntry {
  id: number
  clock: string
  kind: 'info' | 'warn' | 'ok'
  text: string
}

interface Pending {
  route: RouteKey
  remainingBefore: number
}

const WEIGHT_LABELS: Record<keyof Weights, string> = {
  distance: 'Distance',
  time: 'Travel time',
  energy: 'Energy',
  risk: 'Terrain risk',
  science: 'Science value',
}

const SIM_SECONDS = 24 // wall-clock seconds for a full traverse at 1x
const MISSION_STRATEGIES: RouteKey[] = ['safest', 'optimal', 'shortest']

interface AppProps {
  page: 'explore' | 'location' | 'planner' | 'advisor' | 'simulator' | 'landing' | null
  point: Coordinates | null
  selectSite: (point: Coordinates, openReport?: boolean) => void
  saveSite: (point: Coordinates, assessment: Assessment) => void
  saveRoute: (report: RouteReport) => void
}

export default function App({ page, point, selectSite, saveSite, saveRoute }: AppProps) {
  const [terrain, setTerrain] = useState<TerrainData | null>(null)
  const [inspectedCell, setInspectedCell] = useState<Cell | null>(null)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [defaultWeights, setDefaultWeights] = useState<Weights | null>(null)
  const [profileId, setProfileId] = useState('astronaut_eva')
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [weights, setWeights] = useState<Weights | null>(null)
  const [start, setStart] = useState<Cell | null>(null)
  const [goal, setGoal] = useState<Cell | null>(null)
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [result, setResult] = useState<RouteResult | null>(null)
  const [before, setBefore] = useState<Partial<Record<RouteKey, Metrics>> | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [selected, setSelected] = useState<RouteKey>('safest')
  const [visible, setVisible] = useState<Record<RouteKey, boolean>>({ shortest: true, safest: true, optimal: true })
  const [pickMode, setPickMode] = useState<'start' | 'goal' | null>(null)
  const [layer, setLayer] = useState<LayerId>('surface')
  const [view, setView] = useState<'globe' | '2d' | '3d'>('2d')
  const [reportTarget, setReportTarget] = useState<HTMLDivElement | null>(null)
  const [exaggeration, setExaggeration] = useState(2)
  const [follow, setFollow] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(0)
  const [speed, setSpeed] = useState(1)
  const [log, setLog] = useState<LogEntry[]>([])
  const pending = useRef<Pending | null>(null)
  const resultRef = useRef<RouteResult | null>(null)
  const logId = useRef(0)
  const [alertTick, setAlertTick] = useState(0)
  // Distance, time and energy already spent before the last mid-mission replan.
  const [carried, setCarried] = useState({ dist: 0, time: 0, energy: 0 })

  const profile = profiles.find((p) => p.id === profileId) ?? null
  const siteSettings = useMemo(() => weights ? { profile: profileId, overrides, weights } : null, [profileId, overrides, weights])
  const route = result?.routes[selected]
  const routeOk = route?.status === 'ok'

  const restartTraverse = useCallback(() => {
    progressRef.current = 0
    setProgress(0)
  }, [])

  const addLog = useCallback((kind: LogEntry['kind'], text: string, missionSeconds?: number) => {
    const clock = missionSeconds === undefined ? '--:--' : `T+${fmtDur(missionSeconds)}`
    setLog((l) => [{ id: ++logId.current, clock, kind, text }, ...l].slice(0, 60))
  }, [])

  // Initial load
  useEffect(() => {
    let active = true
    Promise.all([fetchTerrain(), fetchProfiles()])
      .then(([t, p]) => {
        if (!active) return
        setTerrain(t)
        setProfiles(p.profiles)
        setDefaultWeights(p.default_weights)
        setWeights(p.default_weights)
        setStart(t.suggested.start)
        setGoal(t.suggested.goal)
        addLog('info', `Terrain loaded: ${t.meta.name}, ${t.width} x ${t.height} cells at ${t.cell_size.toFixed(1)} m.`)
      })
      .catch((e) => {
        if (active) setError(`Cannot reach the backend: ${e.message}`)
      })
    return () => { active = false }
  }, [addLog, loadAttempt])

  // Route computation (debounced so sliders stay responsive)
  useEffect(() => {
    if (!terrain || !start || !goal || !weights) return
    const ctl = new AbortController()
    const timer = setTimeout(() => {
      fetchRoutes({ start, goal, profile: profileId, overrides, weights, obstacles }, ctl.signal)
        .then((r) => {
          if (ctl.signal.aborted) return
          const prev = resultRef.current
          if (prev) {
            const snap: Partial<Record<RouteKey, Metrics>> = {}
            for (const k of ROUTE_KEYS) if (prev.routes[k].status === 'ok') snap[k] = prev.routes[k].metrics
            setBefore(snap)
          }
          resultRef.current = r
          setResult(r)
          setError(null)
          restartTraverse()
          const replan = pending.current
          if (!replan) return
          pending.current = null
          const next = r.routes[replan.route]
          if (next.status === 'ok') {
            const diff = next.metrics.distance_m - replan.remainingBefore
            addLog('ok', `Replanned in ${r.compute_ms.toFixed(0)} ms. ${fmtDist(next.metrics.distance_m)} remaining (${diff >= 0 ? '+' : ''}${diff.toFixed(0)} m). Resuming traverse.`)
            setPlaying(true)
          } else {
            addLog('warn', `Safe stop. ${next.reason ?? 'No route remains.'}`)
          }
        })
        .catch((e) => {
          if (ctl.signal.aborted) return
          setError(e.message)
          if (pending.current) {
            pending.current = null
            addLog('warn', `Safe stop. Replanning failed: ${e.message}`)
          }
        })
        .finally(() => {
          if (!ctl.signal.aborted) setBusy(false)
        })
    }, 180)
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [terrain, start, goal, profileId, overrides, weights, obstacles, addLog, restartTraverse])

  // Simulation clock
  useEffect(() => {
    if (!playing || !routeOk || !route) return
    const n = route.path.length - 1
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.max(0, now - last) / 1000
      last = now
      next = Math.min(n, next + (n / SIM_SECONDS) * dt * speed)
      progressRef.current = next
      setProgress(next)
      if (next < n) {
        raf = requestAnimationFrame(tick)
        return
      }
      setPlaying(false)
      addLog(
        'ok',
        `Arrived at B. ${fmtDist(carried.dist + route.metrics.distance_m)} covered, ${(carried.energy + route.metrics.energy_wh).toFixed(0)} Wh used, ` +
          `${(route.metrics.energy_margin_wh - carried.energy).toFixed(0)} Wh above reserve.`,
        carried.time + route.metrics.duration_s,
      )
    }
    let next = progressRef.current
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, routeOk, route, speed, addLog, carried])

  const base = useMemo(
    () => (terrain ? renderLayer(terrain, layer, result?.risk ?? null, result?.cls ?? null) : null),
    [terrain, layer, result?.risk, result?.cls],
  )

  const traveler = useMemo<[number, number] | null>(() => {
    if (!routeOk || !route || (progress === 0 && !playing)) return null
    const index = Math.min(Math.floor(progress), route.path.length - 1)
    const [row, column] = route.path[index]
    const [nextRow, nextColumn] = route.path[index + 1] ?? route.path[index]
    const fraction = progress - index
    return [row + (nextRow - row) * fraction, column + (nextColumn - column) * fraction]
  }, [route, routeOk, progress, playing])

  const telemetry = routeOk && route
    ? {
        dist: carried.dist + lerpAt(route.profile.dist, progress),
        energy: carried.energy + lerpAt(route.profile.energy, progress),
        time: carried.time + lerpAt(route.profile.time, progress),
        slope: lerpAt(route.profile.slope, progress),
        risk: lerpAt(route.profile.risk, progress),
      }
    : null

  const param = (key: keyof Profile) => overrides[key] ?? (profile ? (profile[key] as number) : 0)
  const setParam = (key: string, v: number) => setOverrides((o) => ({ ...o, [key]: v }))

  const updatePlan = () => {
    pending.current = null
    setBusy(true)
    setError(null)
    setPlaying(false)
    setCarried({ dist: 0, time: 0, energy: 0 })
    restartTraverse()
  }

  const editParam = (key: string, value: number) => {
    updatePlan()
    setParam(key, value)
  }

  const changeProfile = (id: string) => {
    updatePlan()
    setProfileId(id)
    setOverrides({})
    addLog('info', `Mobility profile set to "${profiles.find((p) => p.id === id)?.label}".`)
  }

  const resetMission = () => {
    if (!terrain || !defaultWeights) return
    updatePlan()
    setBusy(false)
    resultRef.current = null
    setObstacles([])
    setOverrides({})
    setWeights(defaultWeights)
    setStart(terrain.suggested.start)
    setGoal(terrain.suggested.goal)
    setPickMode(null)
    setBefore(null)
    addLog('info', 'Mission reset to the default scenario.')
  }

  const onPick = (cell: Cell) => {
    setInspectedCell(cell)
    if (!pickMode) return
    const current = pickMode === 'start' ? start : goal
    setPickMode(null)
    if (current?.[0] === cell[0] && current[1] === cell[1]) return
    updatePlan()
    if (pickMode === 'start') setStart(cell)
    else setGoal(cell)
    addLog('info', `${pickMode === 'start' ? 'Start (A)' : 'Destination (B)'} moved to row ${cell[0]}, col ${cell[1]}.`)
  }

  /** Stop, replan from the current position, then resume (see the effect above). */
  const replanFromHere = (reason: string, apply: () => void) => {
    if (!routeOk || !route) return
    const i = Math.min(route.path.length - 1, Math.floor(progress))
    pending.current = { route: selected, remainingBefore: route.metrics.distance_m - route.profile.dist[i] }
    setBusy(true)
    setError(null)
    setPlaying(false)
    setAlertTick((n) => n + 1)
    addLog('warn', `${reason} Traverse paused at row ${route.path[i][0]}, col ${route.path[i][1]}; re-evaluating the route.`, carried.time + route.profile.time[i])
    setCarried({ dist: carried.dist + route.profile.dist[i], time: carried.time + route.profile.time[i], energy: carried.energy + route.profile.energy[i] })
    restartTraverse()
    setStart(route.path[i])
    apply()
  }

  const reportObstacle = () => {
    if (!routeOk || !route || !goal) return
    const i = Math.floor(progress)
    const j = i + 12
    const radius = 4
    if (j >= route.path.length - 1 || Math.hypot(route.path[j][0] - goal[0], route.path[j][1] - goal[1]) <= radius + 2) {
      addLog('info', 'Too close to the destination to place an obstacle ahead.')
      return
    }
    const [row, col] = route.path[j]
    replanFromHere(`Obstacle reported ${fmtDist(route.profile.dist[j] - route.profile.dist[i])} ahead (simulated event).`, () =>
      setObstacles((o) => [...o, { row, col, radius }]),
    )
  }

  const mobilityFault = () => {
    const reduced = Math.max(4, Math.round(param('max_slope_deg') * 0.6))
    replanFromHere(`Mobility degraded: safe slope limit reduced to ${reduced}° (simulated event).`, () => setParam('max_slope_deg', reduced))
  }

  if (page === null) return null
  if (error && !terrain) {
    return (
      <div className="fatal" role="alert">
        <h1>Martian Map</h1>
        <p>{error}</p>
        <button onClick={() => {
          setError(null)
          setLoadAttempt((attempt) => attempt + 1)
        }}>Retry connection</button>
      </div>
    )
  }
  if (!terrain || !profile || !weights || !siteSettings || !start || !goal || !base) return <div className="fatal" role="status">Loading terrain…</div>

  const layerInfo = LAYERS.find((l) => l.id === layer)!
  const routesForView = busy ? {} : result?.routes ?? {}
  const atEnd = routeOk && route ? progress >= route.path.length - 1 : false
  const remainingWh = telemetry && route ? route.metrics.energy_usable_wh - telemetry.energy : 0
  const readyCount = ROUTE_KEYS.filter((key) => result?.routes[key].status === 'ok').length
  const canStart = routeOk && !busy && !error && !pickMode
  const chooseRoute = (key: RouteKey) => {
    if (key === selected || pending.current) return
    setPlaying(false)
    restartTraverse()
    setSelected(key)
  }
  const globeProps = {
    reportTarget, settings: siteSettings, activeRoute: selected, onSelectRoute: chooseRoute,
    selectedSite: point, onSite: selectSite, onSave: saveSite, onOpenReport: () => { location.hash = 'location' },
  }
  if (page === 'explore' || page === 'location' || page === 'advisor' || page === 'landing') return (
    <section className={page === 'explore' ? 'mission-content explorer-page' : 'mission-content location-page'}>
      <div className="page-heading"><div><h1>{page === 'explore' ? 'Mars Explorer' : page === 'advisor' ? 'AI Mission Advisor' : page === 'landing' ? 'Landing Site Analysis' : 'Location Analysis'}</h1><p className="page-description">{page === 'explore' ? 'Click the map to inspect a point: what is there, whether it can be reached, and why.' : page === 'advisor' ? 'Ask questions about the selected site. Answers are built from its report and cited sources.' : 'Terrain, landing factors, hazards, environment and routes for the selected site.'}</p></div>
        <label className="site-picker">Focus region<select aria-label="Focus region" value={LANDMARKS.find((region) => region.latitude === point?.latitude && region.longitude === point.longitude)?.name ?? ''} onChange={(event) => { const region = LANDMARKS.find((item) => item.name === event.target.value); if (region) selectSite(region, false) }}><option value="" disabled>Custom coordinates</option>{LANDMARKS.map((region) => <option value={region.name} key={region.name}>{region.feature}</option>)}</select></label>
      </div>
      <div className={page === 'explore' ? 'explorer-grid' : 'analysis-workspace'}>
        <MarsExplorer {...globeProps} reportPage={page !== 'explore'} reportSection={page === 'advisor' ? 'guide' : page === 'landing' ? 'landing' : 'overview'} />
        {!point && <p className="workspace-empty">Choose a point in the <a href="#explore">Mars Explorer</a> to open a report.</p>}
        <div className="globe-report-slot" ref={setReportTarget} />
      </div>
    </section>
  )

  return (
    <div className={page === 'simulator' ? 'app simulator-workspace' : 'app planner-workspace'}>
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          <div>
            <h1>{page === 'simulator' ? 'Mission Simulator' : 'Rover Route Planner'}</h1>
            <p>{page === 'simulator' ? 'Run the planned traverse, add obstacles and watch the route replan.' : 'Set start and destination, then compare the shortest, safest and balanced routes.'}</p>
          </div>
        </div>
        <div className={terrain.meta.simulated ? 'source demo' : 'source real'}>
          <b>{terrain.meta.simulated ? 'Simulated terrain' : 'Real elevation data'}</b>
          <span>{terrain.meta.name}</span>
        </div>
        <div className="status">
          <span role="status">{busy
            ? 'Calculating routes…'
            : error ? 'Route calculation failed' : `${readyCount} of 3 routes available`}</span>
          <button onClick={resetMission}>Reset mission</button>
          <button onClick={() => { selectSite(HIRISE_CENTER,false); window.location.assign('#explore') }}>Show HiRISE imagery</button>
          <button className="button-with-icon" disabled={busy || Boolean(error) || !result} onClick={() => {
            if (!result) return
            saveRoute({ id: crypto.randomUUID(), savedAt: new Date().toISOString(), selected, start, goal,
              terrain: terrain.meta, profile: result.profile, weights: { ...weights },
              routes: Object.fromEntries(ROUTE_KEYS.flatMap((key) => result.routes[key].status === 'ok' ? [[key, result.routes[key].metrics]] : [])),
              events: log.map(({ clock, text }) => ({ clock, text })),
              simulation: { status: atEnd ? 'complete' : playing ? 'running' : progress > 0 ? 'paused' : 'ready',
                covered_m: telemetry?.dist ?? 0, mission_time_s: telemetry?.time ?? 0,
                energy_used_wh: telemetry?.energy ?? 0, remaining_usable_wh: remainingWh,
                reported_obstacles: obstacles.length },
            })
          }}><Icon name="reports" size={16} />Save report</button>
        </div>
      </header>

      <div className="grid">
        {/* LEFT: mission setup */}
        <section className="col setup" aria-label="Mission setup">
          <div className="panel">
            <h2>Mission setup</h2>
            <label className="field">
              <span>Mobility profile</span>
              <select value={profileId} onChange={(e) => changeProfile(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="note">{profile.notes}</p>
            <label className="field strategy-field">
              <span>Route strategy</span>
              <select value={selected} disabled={busy} onChange={(e) => chooseRoute(e.target.value as RouteKey)}>
                {MISSION_STRATEGIES.map((key) => <option key={key} value={key}>{ROUTE_STYLE[key].label}</option>)}
              </select>
            </label>
            <p className="note" aria-live="polite">{ROUTE_OBJECTIVE[selected]}</p>
          </div>

          <details className="panel">
            <summary>What-if parameters</summary>
            <Slider label="Slope limit" unit="°" min={4} max={40} step={1} value={param('max_slope_deg')} onChange={(v) => editParam('max_slope_deg', v)} />
            <Slider label="Total mass" unit=" kg" min={Math.round(profile.mass_kg * 0.5)} max={Math.round(profile.mass_kg * 2)} step={5} value={param('mass_kg')} onChange={(v) => editParam('mass_kg', v)} />
            <Slider
              label="Nominal speed"
              unit=" m/s"
              min={+(profile.speed_mps * 0.4).toFixed(3)}
              max={+(profile.speed_mps * 2).toFixed(3)}
              step={+(profile.speed_mps / 50).toFixed(4)}
              digits={3}
              value={param('speed_mps')}
              onChange={(v) => editParam('speed_mps', v)}
            />
            <Slider label={profile.resource_name} unit=" Wh" min={Math.round(profile.capacity_wh * 0.1)} max={Math.round(profile.capacity_wh * 2)} step={10} value={param('capacity_wh')} onChange={(v) => editParam('capacity_wh', v)} />
            <h3>Priorities for the optimal route</h3>
            {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((k) => (
              <Slider
                key={k}
                label={WEIGHT_LABELS[k]}
                unit={result ? ` → ${(100 * (result.weights[k] ?? 0)).toFixed(0)}%` : ''}
                min={0}
                max={1}
                step={0.05}
                digits={2}
                value={weights[k]}
                onChange={(v) => {
                  updatePlan()
                  setWeights({ ...weights, [k]: v })
                }}
              />
            ))}
            <p className="note">Weights are normalised to 100%. Every change recomputes all three routes.</p>
            {before && route && routeOk && before[selected] && <BeforeAfter before={before[selected]!} after={route.metrics} label={ROUTE_STYLE[selected].label} />}
          </details>

          <details className="panel">
            <summary>Data sources and limits</summary>
            <dl className="prov">
              <dt>Dataset</dt>
              <dd>{terrain.meta.source}</dd>
              <dt>Resolution</dt>
              <dd>
                {terrain.cell_size.toFixed(1)} m per cell · {fmtDist(terrain.meta.extent_m[0])} x {fmtDist(terrain.meta.extent_m[1])}
              </dd>
              <dt>Coordinates</dt>
              <dd>{terrain.meta.crs}</dd>
              {Object.entries(terrain.meta.layers).map(([k, v]) => (
                <div key={k} className="prov-row">
                  <dt>{k.replace('_', ' ')}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <ul className="limits">
              {terrain.meta.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
              <li>Risk score, energy and duration are model estimates under the stated assumptions, not validated probabilities or telemetry.</li>
            </ul>
          </details>
        </section>

        {/* CENTRE: map, simulator, profile */}
        <section className="col wide" aria-label="Terrain and simulation">
          <div className="panel map-panel">
            <div className="map-heading">
              <h2>{view === 'globe' ? 'Mars globe' : 'Terrain map'}</h2>
              <span>{view === 'globe' ? 'Viking imagery · MOLA relief' : `${terrain.cell_size.toFixed(1)} m per cell`}</span>
            </div>
            <div className="toolbar">
              <div className="seg" role="group" aria-label="Terrain view">
                <button aria-pressed={view === 'globe'} className={view === 'globe' ? 'on' : ''} onClick={() => {
                  setPickMode(null)
                  setView('globe')
                }}>
                  Mars globe
                </button>
                <button aria-pressed={view === '2d'} className={view === '2d' ? 'on' : ''} onClick={() => {
                  setView('2d')
                }}>
                  2D map
                </button>
                <button aria-pressed={view === '3d'} className={view === '3d' ? 'on' : ''} onClick={() => {
                  setPickMode(null)
                  setView('3d')
                }}>
                  3D local terrain
                </button>
              </div>
            </div>
            {view === 'globe' ? (
              <MarsExplorer {...globeProps} reportPage={false} />
            ) : (
              <>
            <div className="pick" aria-label="Route endpoints" role="group">
              {(['start', 'goal'] as const).map((endpoint) => {
                const cell = endpoint === 'start' ? start : goal
                return (
                  <button
                    key={endpoint}
                    aria-pressed={pickMode === endpoint}
                    className={`endpoint ${pickMode === endpoint ? 'on' : ''}`}
                    onClick={() => {
                      setView('2d')
                      setPickMode(pickMode === endpoint ? null : endpoint)
                    }}
                  >
                    <span aria-hidden="true" className={`pin ${endpoint}`}>{endpoint === 'start' ? 'A' : 'B'}</span>
                    <span className="endpoint-copy">
                      <b>{endpoint === 'start' ? profile.kind === 'astronaut' ? 'Set astronaut position' : 'Set rover position' : 'Set destination'}</b>
                      <small>Row {cell[0]} · Col {cell[1]}</small>
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="note pick-note" id="map-instructions">Choose A or B, then click a terrain cell. With the map focused, use arrow keys to move and Enter to select.</p>
            <div className="toolbar">
              <label className="inline">
                <span>Layer</span>
                <select value={layer} onChange={(e) => setLayer(e.target.value as LayerId)}>
                  {LAYERS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              {view === '3d' && (
                <>
                  <label className="inline">
                    <span>Vertical x{exaggeration}</span>
                    <input type="range" min={1} max={5} step={0.5} value={exaggeration} onChange={(e) => setExaggeration(+e.target.value)} />
                  </label>
                  <label className="inline check">
                    <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                    <span>Follow</span>
                  </label>
                </>
              )}
            </div>
            <div className={busy ? 'stage busy' : 'stage'} style={{ aspectRatio: `${terrain.width} / ${terrain.height}` }}>
              {alertTick > 0 && <div key={alertTick} className="alert-flash" aria-hidden="true" />}
              {view === '2d' ? (
                <MapCanvas
                  terrain={terrain}
                  base={base}
                  risk={result?.risk ?? null}
                  cls={result?.cls ?? null}
                  routes={routesForView}
                  visible={visible}
                  selected={selected}
                  start={start}
                  goal={goal}
                  obstacles={obstacles}
                  sites={terrain.science_sites}
                  traveler={traveler}
                  progress={traveler ? progress : null}
                  pickMode={pickMode}
                  onPick={onPick}
                  onCancel={() => setPickMode(null)}
                />
              ) : (
                <Suspense fallback={<div className="fatal" role="status">Loading 3D terrain…</div>}>
                  <Terrain3D
                    terrain={terrain}
                    base={base}
                    routes={routesForView}
                    visible={visible}
                    selected={selected}
                    start={start}
                    goal={goal}
                    obstacles={obstacles}
                    sites={terrain.science_sites}
                    traveler={traveler}
                    progress={traveler ? progress : null}
                    moving={playing}
                    kind={profile.kind}
                    exaggeration={exaggeration}
                    follow={follow}
                  />
                </Suspense>
              )}
              <div className="legend">
                {layer === 'class' ? (
                  CLASS_INFO.map((c) => (
                    <span key={c.key} className="lg-item">
                      <i style={{ background: rgbCss(c.color) }} />
                      {c.label}
                    </span>
                  ))
                ) : layerInfo.ramp ? (
                  <span className="lg-ramp">
                    {layerInfo.label}: {layerInfo.ramp.min}
                    <i style={{ background: `linear-gradient(90deg, ${rgbCss(layerInfo.ramp.from)}, ${rgbCss(layerInfo.ramp.to)})` }} />
                    {layerInfo.ramp.max}
                  </span>
                ) : (
                  <span className="lg-ramp">Shaded relief</span>
                )}
                {terrain.science_sites.length > 0 && <span className="lg-item">
                  <i className="diamond" />
                  Science site
                </span>}
                {view === '3d' && <span className="lg-item">Figure, beams and dust are visual markers, not to scale</span>}
              </div>
            </div>

              </>
            )}
            <CellInspector cell={inspectedCell} profile={profileId} slopeLimit={param('max_slope_deg')} blocked={Boolean(inspectedCell && obstacles.some((obstacle) => Math.hypot(obstacle.row-inspectedCell[0],obstacle.col-inspectedCell[1]) <= obstacle.radius))} />
            <div className="sim">
              <div className="sim-heading">
                <h2>Traverse simulation</h2>
                <span>{ROUTE_STYLE[selected].label} local route</span>
              </div>
              {error && <p className="warn-text" role="alert">{error}</p>}
              <div className="sim-controls">
                <button
                  className="primary"
                  disabled={!canStart && !playing}
                  onClick={() => {
                    if (atEnd) {
                      restartTraverse()
                      setCarried({ dist: 0, time: 0, energy: 0 })
                    }
                    if (!playing && (progress === 0 || atEnd)) {
                      addLog('info', `Traverse started on the ${ROUTE_STYLE[selected].label.toLowerCase()} route.`, atEnd ? 0 : carried.time)
                    }
                    if (!playing && view === 'globe') setView('2d')
                    setPlaying(!playing)
                  }}
                >
                  {playing ? 'Pause' : atEnd ? 'Replay' : progress > 0 ? 'Resume' : 'Start traverse'}
                </button>
                <div className="seg small" role="group" aria-label="Simulation speed">
                  {[0.5, 1, 2, 4].map((s) => (
                    <button key={s} aria-pressed={speed === s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
                      {s}x
                    </button>
                  ))}
                </div>
                <button disabled={!playing} onClick={reportObstacle} title="Simulated event: an obstacle is reported on the path ahead">
                  Report obstacle ahead
                </button>
                <button disabled={!playing} onClick={mobilityFault} title="Simulated event: mobility degrades, lowering the safe slope limit">
                  Mobility fault
                </button>
              </div>
              {telemetry && route && !busy && !error && (
                <>
                  <progress aria-label="Traverse distance" value={telemetry.dist} max={carried.dist + route.metrics.distance_m || 1} />
                  <div className="telemetry">
                    <Stat label="Covered" value={`${fmtDist(telemetry.dist)} / ${fmtDist(carried.dist + route.metrics.distance_m)}`} />
                    <Stat label="Mission time" value={fmtDur(telemetry.time)} />
                    <Stat label="Above reserve" value={`${remainingWh.toFixed(0)} Wh`} warn={remainingWh < 0} />
                    <Stat label="Slope here" value={`${telemetry.slope.toFixed(1)}°`} />
                    <Stat label="Risk here" value={telemetry.risk.toFixed(2)} />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="panel">
            <h2>
              Route profile <small>hover for values · thick line = selected route</small>
            </h2>
            <ProfileChart routes={routesForView} visible={visible} selected={selected} progress={traveler ? progress : null} usableWh={result?.routes[selected]?.metrics?.energy_usable_wh ?? 0} />
          </div>
        </section>

        {/* RIGHT: route intelligence */}
        <section className="col comparison" aria-label="Route comparison">
          {view === 'globe' && <div className="globe-report-slot" ref={setReportTarget} />}
          {view === '2d' && <div className="panel map-key" aria-label="Map color key">
            <h2>Map colors</h2>
            <div className="map-key-item"><i className="key-line straight" /><span><b>Yellow dashed</b> · direct straight line between A and B</span></div>
            <div className="map-key-item"><i className="key-line safest" /><span><b>Gold dotted</b> · lowest modeled terrain exposure</span></div>
            <div className="map-key-item"><i className="key-line shortest" /><span><b>Ivory dashed</b> · shortest route; may cross riskier terrain</span></div>
            <div className="map-key-item"><i className="key-line optimal" /><span><b>Copper solid</b> · route balanced by mission priorities</span></div>
            <div className="map-key-item"><i className="key-terrain hazard" /><span><b>Red terrain</b> · high mobility risk</span></div>
            <div className="map-key-item"><i className="key-terrain blocked" /><span><b>Dark red</b> · impassable terrain; no route can cross it</span></div>
            <div className="map-key-item"><i className="key-pin start">A</i><span>A · selected mobility starting position</span></div>
            <div className="map-key-item"><i className="key-pin goal">B</i><span>B · selected destination</span></div>
          </div>}
          <div className="panel">
            <h2>Compare local routes</h2>
            {ROUTE_KEYS.map((k) => {
              const r = result?.routes[k]
              const st = ROUTE_STYLE[k]
              return (
                <article key={k} className={k === selected ? 'route on' : 'route'}>
                  <div className="route-head">
                    <button className="route-select" aria-pressed={k === selected} disabled={busy || Boolean(error) || r?.status !== 'ok'} onClick={() => chooseRoute(k)}>
                      <svg width="30" height="10" aria-hidden="true">
                        <line x1="2" x2="28" y1="5" y2="5" stroke={st.color} strokeWidth="4" strokeDasharray={st.dash.join(' ')} strokeLinecap="round" />
                      </svg>
                      <span><b>{st.label}</b><small>{st.goal}</small></span>
                    </button>
                    <label className="eye">
                      <input type="checkbox" checked={visible[k]} onChange={(e) => setVisible({ ...visible, [k]: e.target.checked })} />
                      <span className="sr-only">Show {st.label.toLowerCase()} route on map</span>
                      <span aria-hidden="true">Map</span>
                    </label>
                  </div>
                  {!r ? (
                    <p className="note">{error ? 'Route unavailable' : 'Calculating…'}</p>
                  ) : r.status !== 'ok' ? (
                    <p className="warn-text">Unreachable. {r.reason}</p>
                  ) : (
                    <div className="metrics">
                      <Stat label="Distance" value={<Num value={r.metrics.distance_m} fmt={fmtDist} />} />
                      <Stat label="Duration" value={<Num value={r.metrics.duration_s} fmt={fmtDur} />} />
                      <Stat label="Energy" value={<Num value={r.metrics.energy_wh} fmt={fmtWh} />} warn={!r.metrics.energy_feasible} />
                      <Stat label="Risk score" value={<Num value={r.metrics.risk_score} fmt={fmtScore} />} />
                      <Stat label="Max slope" value={`${r.metrics.max_slope_deg.toFixed(1)}°`} />
                      <Stat label="Min confidence" value={r.metrics.min_confidence.toFixed(2)} warn={r.metrics.min_confidence < 0.35} />
                      <Stat label="Hazard exposure index" value={r.metrics.hazard_exposure.toFixed(1)} />
                      <Stat label="Climb" value={`${r.metrics.ascent_m.toFixed(0)} m`} />
                      <Stat label="Science sites" value={`${r.metrics.science_sites.length}`} />
                      <div className="riskbar" title="Risk score, 0 to 100">
                        <i style={{ width: `${r.metrics.risk_score}%` }} />
                      </div>
                      <div className={r.metrics.energy_feasible ? 'feas ok' : 'feas bad'}>
                        {r.metrics.energy_feasible
                          ? `Feasible: ${r.metrics.energy_margin_wh.toFixed(0)} Wh above reserve`
                          : `Not feasible: ${Math.abs(r.metrics.energy_margin_wh).toFixed(0)} Wh short of reserve`}
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
            <p className="note">Risk score (0–100) is a relative index based on slope and roughness.</p>
          </div>

          <div className="panel">
            <h2>Why these routes</h2>
            {(result?.explanations ?? []).map((e) => (
              <div key={e.title + e.text} className={e.kind === 'warning' ? 'explain warn' : 'explain'}>
                <b>{e.title}</b>
                <p>{e.text}</p>
              </div>
            ))}
          </div>

          <div className="panel">
            <h2>Mission event log</h2>
            <ol className="log">
              {log.map((l) => (
                <li key={l.id} className={l.kind}>
                  <time>{l.clock}</time>
                  <span>{l.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  )
}

const fmtWh = (v: number) => `${v.toFixed(0)} Wh`
const fmtScore = (v: number) => `${v.toFixed(0)} / 100`

/** Eases a number towards its new value so metric changes are visible, not abrupt. */
function useTween(target: number, ms = 600): number {
  const [v, setV] = useState(target)
  const cur = useRef(target)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      cur.current = target
      const frame = requestAnimationFrame(() => setV(target))
      return () => cancelAnimationFrame(frame)
    }
    const from = cur.current
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      cur.current = from + (target - from) * (1 - Math.pow(1 - k, 3))
      setV(cur.current)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

function Num({ value, fmt }: { value: number; fmt: (v: number) => string }) {
  return <>{fmt(useTween(value))}</>
}

function Stat({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className={warn ? 'stat warn' : 'stat'}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function Slider(p: { label: string; unit: string; min: number; max: number; step: number; value: number; digits?: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>
        {p.label}
        <b>
          {p.value.toFixed(p.digits ?? 0)}
          {p.unit}
        </b>
      </span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(+e.target.value)} />
    </label>
  )
}

function BeforeAfter({ before, after, label }: { before: Metrics; after: Metrics; label: string }) {
  const rows: [string, number, number, (v: number) => string][] = [
    ['Distance', before.distance_m, after.distance_m, fmtDist],
    ['Duration', before.duration_s, after.duration_s, fmtDur],
    ['Energy', before.energy_wh, after.energy_wh, (v) => `${v.toFixed(0)} Wh`],
    ['Risk score', before.risk_score, after.risk_score, (v) => v.toFixed(0)],
    ['Max slope', before.max_slope_deg, after.max_slope_deg, (v) => `${v.toFixed(1)}°`],
  ]
  if (rows.every(([, b, a]) => Math.abs(a - b) < 1e-6)) return null
  return (
    <table className="ba">
      <caption>{label} route: before and after the last change</caption>
      <thead>
        <tr>
          <th />
          <th>Before</th>
          <th>After</th>
          <th>Change</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, b, a, f]) => (
          <tr key={name}>
            <th>{name}</th>
            <td>{f(b)}</td>
            <td>{f(a)}</td>
            <td>{b !== 0 && Math.abs(a - b) > 1e-6 ? `${a > b ? '+' : ''}${((100 * (a - b)) / b).toFixed(0)}%` : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
