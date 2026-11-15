import { lazy, Suspense, useState } from 'react'
import Icon from './Icon'
import MapBoundary from './MapBoundary'
import PlanetMap from './PlanetMap'
import { LANDMARKS } from './mars'
import type { Assessment, Coordinates } from './mars'
import type { Candidate } from './science'
import { useSurfaceNavigation } from './surfaceNavigationContext'
import SiteSelection from './SiteSelection'

const MarsGlobe = lazy(() => import('./MarsGlobe'))
function webglAvailable() {
  try { const gl = document.createElement('canvas').getContext('webgl2'); gl?.getExtension('WEBGL_lose_context')?.loseContext(); return Boolean(gl) } catch { return false }
}

export default function MissionHome({ point, onSelect }: {
  candidates: Candidate[]; point: Coordinates; onSelect: (point: Coordinates, openReport?: boolean) => void
  onSave: (point: Coordinates, assessment: Assessment) => void
}) {
  const [supported] = useState(webglAvailable)
  const [view, setView] = useState(supported ? 'globe' : 'map')
  const [focus, setFocus] = useState({ sequence: 1, distance: 4 })
  const [zoom, setZoom] = useState({ sequence: 0, direction: 0 })
  const [tileStatus, setTileStatus] = useState('')
  const navigation = useSurfaceNavigation()
  const select = (next: Coordinates, distance?: number) => {
    onSelect(next, false)
    setFocus((current) => ({ sequence: current.sequence + 1, distance: distance ?? 2.4 }))
  }
  const props = { point, focus, zoom, layer: 'natural' as const, grid: false, showSlopes: false, hazard: null,
    paths: navigation.pathsFor(point), activeRoute: navigation.strategy, onSelect: select, onTileStatus: setTileStatus }
  const map = <PlanetMap {...props} />
  return <section className="orbit-home">
    <div className="orbit-intro" dir="ltr"><div><h1>Mission Control</h1><p>Select a site on the globe to see what is there and whether it can be reached. Local 20 m terrain covers Jezero crater; elsewhere the assessment is regional.</p></div></div>
    <div className="orbit-experience">
      <div className="orbit-viewport mars-stage">
        
        {view === 'globe' ? <MapBoundary fallback={map}><Suspense fallback={<p className="mars-globe-fallback" role="status">Loading Mars…</p>}><MarsGlobe {...props} marked showHazard={false} showRelief /></Suspense></MapBoundary> : map}
        <div className="orbit-view-switch seg"><button disabled={!supported} aria-pressed={view === 'globe'} onClick={() => setView('globe')}>3D Globe</button><button aria-pressed={view === 'map'} onClick={() => setView('map')}>2D Map</button></div>
        <div className="mars-stage-controls"><button aria-label="Zoom in" onClick={() => setZoom((v) => ({ sequence: v.sequence + 1, direction: 1 }))}>+</button><button aria-label="Zoom out" onClick={() => setZoom((v) => ({ sequence: v.sequence + 1, direction: -1 }))}>−</button><button aria-label="Reset planetary view" onClick={() => setFocus((v) => ({ sequence: v.sequence + 1, distance: 4 }))}>↺</button><button aria-label="Zoom to real imagery" title="Zoom to this location" onClick={() => setFocus((v) => ({ sequence: v.sequence + 1, distance: 1.002 }))}><Icon name="location" size={18} /></button></div>
        <div className="orbit-instructions"><span>Drag to rotate · Scroll to zoom · Click to select</span><span>N ↑</span></div>
      </div>
      <SiteSelection point={point} onDetails={() => onSelect(point, true)} />
    </div>
    {tileStatus && <p className="map-service-note" role="status">{tileStatus}</p>}
    <div className="orbit-destinations">{LANDMARKS.map((region) => <button key={region.name} onClick={() => select(region, 2.4)} aria-pressed={region.latitude === point.latitude && region.longitude === point.longitude}><b>{region.name}</b><small>{region.type}</small><Icon name="arrow" size={16} /></button>)}</div>
    <div className="orbit-next" dir="ltr"><div><h2>Route to the selected site</h2><p>Start: Perseverance landing point. Compares the shortest, lowest-risk and balanced routes on the 20 m Jezero terrain.</p></div><a href="#planner" className="button-link primary-link">Plan a route <Icon name="route" size={18} /></a></div>
  </section>
}
