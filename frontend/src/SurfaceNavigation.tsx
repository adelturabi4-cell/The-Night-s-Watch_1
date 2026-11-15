import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { coordinatesLabel, LANDING_SITE } from './mars'
import type { Coordinates, SurfaceRoutes } from './mars'
import type { RouteKey } from './types'
import { ROUTE_KEYS, ROUTE_STYLE } from './types'
import { fmtDist, fmtDur } from './render'

import { key, NavigationContext, useSurfaceNavigation } from './surfaceNavigationContext'
import type { NavigationState } from './surfaceNavigationContext'

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [origin, updateOrigin] = useState<Coordinates>(LANDING_SITE)
  const [strategy, setStrategy] = useState<RouteKey>('safest')
  const [response, setResponse] = useState<{ key: string; paths: SurfaceRoutes } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<NavigationState['error']>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const setOrigin = (point: Coordinates) => { request.current?.abort(); updateOrigin(point); setResponse(null); setBusy(''); setError(null) }
  const plan = async (point: Coordinates) => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const requestKey = key(origin) + ':' + key(point)
    setBusy(requestKey); setResponse(null); setError(null)
    try {
      const result = await fetch('/api/surface/navigation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin, destination: point }), signal: controller.signal })
      const data = await result.json()
      if (!result.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to plan this route.')
      if (!controller.signal.aborted) setResponse({ key: requestKey, paths: data })
    } catch (err) { if (!controller.signal.aborted) setError({ key: requestKey, message: err instanceof Error ? err.message : 'Route service unavailable.' }) }
    finally { if (!controller.signal.aborted) setBusy('') }
  }
  return <NavigationContext.Provider value={{ origin, setOrigin, plan, pathsFor: (point) => point && response?.key === key(origin) + ':' + key(point) ? response.paths : null, strategy, setStrategy, busy, error }}>{children}</NavigationContext.Provider>
}

export default function SurfaceNavigation({ point, onFocus }: { point: Coordinates; onFocus: () => void }) {
  const navigation = useSurfaceNavigation()
  const requestKey = key(navigation.origin) + ':' + key(point)
  const paths = navigation.pathsFor(point)
  const route = paths?.routes[navigation.strategy]
  const busy = navigation.busy === requestKey
  return <section className="surface-navigation" aria-label="Point to point surface navigation">
    <div className="panel-title"><h2>Surface navigation</h2><span className="tag">A → B</span></div>
    <div className="navigation-body"><p>Set your starting point, select a destination on Mars, then calculate a route.</p>
      <dl><div><dt>A · Starting point</dt><dd>{coordinatesLabel(navigation.origin)}</dd></div><div><dt>B · Destination</dt><dd>{coordinatesLabel(point)}</dd></div></dl>
      <p className="note">Default origin: the Perseverance landing point. No live rover position is connected.</p>
      <div className="navigation-actions"><button onClick={() => navigation.setOrigin(point)}>Start here</button><button className="primary" disabled={busy || key(navigation.origin) === key(point)} onClick={() => navigation.plan(point)}>{busy ? 'Calculating route…' : 'Plan a route here'}</button></div>
      <details><summary>Edit origin coordinates</summary><form key={key(navigation.origin)} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); navigation.setOrigin({ latitude: Number(data.get('lat')), longitude: Number(data.get('lon')) }) }}><label>Latitude<input aria-label="Origin latitude" name="lat" type="number" required step="any" min={-90} max={90} defaultValue={navigation.origin.latitude} /></label><label>Longitude<input aria-label="Origin longitude" name="lon" type="number" required step="any" min={-180} max={180} defaultValue={navigation.origin.longitude} /></label><button>Set origin</button></form></details>
      {navigation.error?.key === requestKey && <p className="inline-error" role="alert">{navigation.error.message}</p>}
      {paths?.reason && <p role="status">{paths.reason}</p>}
      {paths && Object.keys(paths.routes).length > 0 && <><label className="navigation-strategy">Route strategy<select value={navigation.strategy} onChange={(event) => navigation.setStrategy(event.target.value as RouteKey)}>{ROUTE_KEYS.map((strategy) => <option key={strategy} value={strategy} disabled={!paths.routes[strategy]}>{ROUTE_STYLE[strategy].label}</option>)}</select></label>{route ? <div className="navigation-metrics"><span>Distance<b>{fmtDist(route.metrics.distance_m)}</b></span><span>Travel time<b>{fmtDur(route.metrics.duration_s)}</b></span><span>Model risk<b>{route.metrics.risk_score.toFixed(1)} / 100</b></span></div> : <p>This strategy could not reach the selected destination.</p>}<button onClick={onFocus}>Show route on map</button></>}
      <p className="note">Local Jezero CTX coverage only, up to a 6 km planning window. Routes are modeled estimates, not guaranteed safe.</p>
    </div>
  </section>
}
