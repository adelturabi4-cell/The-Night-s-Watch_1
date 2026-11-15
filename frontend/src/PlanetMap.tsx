import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { GLOBE_COLORS, MARS_RADIUS_KM, wrapLongitude } from './mars'
import type { Coordinates, Crater, SurfaceRoutes } from './mars'
import { CTX_RELIEF_BOUNDS, HIRISE_BOUNDS, JEZERO_IMAGE_BOUNDS, PLANET_LAYERS, tileAt, tileBounds, tileUrl } from './planetLayers'
import type { PlanetLayer } from './planetLayers'
import type { RouteKey } from './types'
import type { RoverTrack } from './siteIntel'
import { drawTraveler } from './travelerMarker'

const CTX_DEM = CTX_RELIEF_BOUNDS
const initialCenter = { latitude: 0, longitude: 0 }
const INITIAL_WIDTH = 360
// About 1.2 km across at Jezero: close enough to read a few-hundred-metre route on 6 m CTX imagery.
const MIN_SPAN = 0.02
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

interface Props {
  point: Coordinates | null
  focus: { sequence: number; distance: number }
  zoom: { sequence: number; direction: number }
  layer: PlanetLayer
  grid: boolean
  showSlopes: boolean
  hazard: Crater | null
  rover?: RoverTrack | null
  origin?: Coordinates
  /** Moving rover/astronaut for route playback, in Mars coordinates. `toward` sets its heading. */
  traveler?: { position: Coordinates; toward: Coordinates; kind?: string; moving?: boolean } | null
  frameEndpoints?: boolean
  minimumFrameSpan?: number
  paths: SurfaceRoutes | null
  activeRoute: RouteKey
  onSelect: (point: Coordinates, distance?: number) => void
  onTileStatus: (message: string) => void
}

export default function PlanetMap({ point, focus, zoom, layer, grid, showSlopes, hazard, rover, origin, traveler = null, frameEndpoints = false, minimumFrameSpan = 0.1, paths, activeRoute, onSelect, onTileStatus }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const images = useRef(new Map<string, HTMLImageElement>())
  const pointer = useRef<{ x: number; y: number; center: Coordinates } | null>(null)
  const previous = useRef({ focus: -1, zoom: 0, frame: '' })
  const frameKey = frameEndpoints && origin && point ? `${origin.latitude},${origin.longitude}:${point.latitude},${point.longitude}:${minimumFrameSpan}` : ''
  const [center, setCenter] = useState(initialCenter)
  const [span, setSpan] = useState(INITIAL_WIDTH)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [revision, setRevision] = useState(0)
  const scale = Math.min(size.height / (span / 2), size.width / span)

  useEffect(() => {
    const node = canvas.current!
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (previous.current.focus !== focus.sequence || previous.current.frame !== frameKey) {
      previous.current.focus = focus.sequence
      previous.current.frame = frameKey
      if (frameKey && origin && point) {
        const longitudeDifference = wrapLongitude(point.longitude - origin.longitude)
        setCenter({ latitude: (origin.latitude + point.latitude) / 2, longitude: wrapLongitude(origin.longitude + longitudeDifference / 2) })
        setSpan(clamp(Math.max(minimumFrameSpan, Math.abs(longitudeDifference) * 1.3, Math.abs(point.latitude - origin.latitude) * 2.6), MIN_SPAN, INITIAL_WIDTH))
      } else {
        setCenter(focus.distance >= 3.45 ? initialCenter : point ?? initialCenter)
        setSpan(focus.distance >= 3.45 ? INITIAL_WIDTH : clamp((focus.distance - 1) * 120, MIN_SPAN, 210))
      }
    }
    if (previous.current.zoom !== zoom.sequence) {
      previous.current.zoom = zoom.sequence
      setSpan((degrees) => clamp(degrees * (zoom.direction > 0 ? 0.62 : 1 / 0.62), MIN_SPAN, INITIAL_WIDTH))
    }
  }, [point, origin, focus, zoom, frameKey, minimumFrameSpan])

  useEffect(() => {
    const node = canvas.current!
    const context = node.getContext('2d')
    if (!context || size.width < 1 || size.height < 1) return
    const ratio = Math.min(2, window.devicePixelRatio)
    node.width = size.width * ratio
    node.height = size.height * ratio
    context.scale(ratio, ratio)
    context.fillStyle = '#100f0e'
    context.fillRect(0, 0, size.width, size.height)
    const x = (longitude: number) => size.width / 2 + (longitude - center.longitude) * scale
    const y = (latitude: number) => size.height / 2 + (center.latitude - latitude) * scale

    const image = (src: string) => {
      let asset = images.current.get(src)
      if (asset) return asset
      if (images.current.size >= 96) {
        const oldest = images.current.keys().next().value
        if (oldest !== undefined) images.current.delete(oldest)
      }
      asset = new Image()
      asset.onload = asset.onerror = () => setRevision((number) => number + 1)
      asset.src = src
      images.current.set(src, asset)
      return asset
    }
    type Bounds = ReturnType<typeof tileBounds>
    const wrapped = (longitude: number) => center.longitude + wrapLongitude(longitude - center.longitude)
    const paint = (asset: HTMLImageElement, { west, east, south, north }: Bounds) => {
      const midpoint = (west + east) / 2
      const left = wrapped(midpoint) - (east - west) / 2
      if (!asset.complete || !asset.naturalWidth) return
      for (const offset of [-360, 0, 360]) {
        context.drawImage(asset, x(left + offset), y(north), (east - west) * scale + 0.4, (north - south) * scale + 0.4)
      }
    }
    paint(image(layer === 'packMola' ? '/mars-data/mola/globe-180.jpg' : layer === 'elevation' ? '/mars/mola-relief.png' : '/mars/viking.jpg'), { west: -180, east: 180, south: -90, north: 90 })
    if (layer === 'packHirise') paint(image('/mars-data/hirise/site-equirect.png'), HIRISE_BOUNDS)
    if (layer === 'natural' && span < 0.9) paint(image('/mars/jezero-relief.png'), CTX_DEM)
    const atCtx = center.latitude >= JEZERO_IMAGE_BOUNDS.south && center.latitude <= JEZERO_IMAGE_BOUNDS.north && center.longitude >= JEZERO_IMAGE_BOUNDS.west && center.longitude <= JEZERO_IMAGE_BOUNDS.east
    if (layer === 'natural' && span < 1) paint(image('/mars-data/hirise/site-equirect.png'), HIRISE_BOUNDS)
    const spec = PLANET_LAYERS[layer === 'natural' && span < 1 && atCtx ? 'ctx' : layer]
    if ('product' in spec) {
      const local = spec.product === 'ctx'
      const base = spec.product === 'geology' ? 1 : 0
      const level = clamp(Math.floor(Math.log2(360 / span)), base, spec.max)
      const rows = 2 ** level
      const columns = rows * 2
      const latExtent = size.height / (2 * scale)
      const lonExtent = Math.min(180, size.width / (2 * scale))
      const first = tileAt({ latitude: center.latitude + latExtent, longitude: center.longitude - lonExtent }, level)
      const last = tileAt({ latitude: center.latitude - latExtent, longitude: center.longitude + lonExtent }, level)
      const count = Math.min(columns, Math.ceil((lonExtent * 2) / (180 / rows)) + 1)
      let loaded = 0, total = 0, finished = 0
      if (!local || level >= 8) {
        for (let row = first.row; row <= last.row; row++) {
          for (let index = 0; index < count; index++) {
            const column = (first.column + index) % columns
            const bounds = tileBounds(level, row, column)
            if (local && (bounds.east < JEZERO_IMAGE_BOUNDS.west || bounds.west > JEZERO_IMAGE_BOUNDS.east ||
              bounds.north < JEZERO_IMAGE_BOUNDS.south || bounds.south > JEZERO_IMAGE_BOUNDS.north)) continue
            const asset = image(tileUrl(spec.product, level, row, column))
            total++
            if (asset.complete) finished++
            if (asset.naturalWidth) loaded++
            paint(asset, bounds)
          }
        }
      }
      onTileStatus(total === 0 ? 'Zoom into Jezero for CTX coverage' : finished < total ? 'Loading map tiles…' :
        loaded ? `${loaded} / ${total} tiles · level ${level}` : 'Imagery unavailable · Viking fallback')
    } else onTileStatus('')

    if (showSlopes) paint(image('/mars/jezero-slopes.png'), CTX_DEM)
    const position = (latitude: number, longitude: number) => [x(wrapped(longitude)), y(latitude)] as const
    const line = (points: [number, number][], color: string, width: number) => {
      if (!points.length) return
      context.beginPath()
      context.moveTo(...position(...points[0]))
      for (const location of points.slice(1)) context.lineTo(...position(...location))
      context.strokeStyle = color
      context.lineWidth = width
      context.stroke()
    }
    if (grid) {
      context.strokeStyle = '#f0d66c66'
      context.lineWidth = 1
      for (let longitude = -180; longitude < 180; longitude += 30) {
        const west = x(wrapped(longitude))
        context.strokeRect(west, y(90), 0, 180 * scale)
      }
      for (let latitude = -60; latitude <= 60; latitude += 30) context.strokeRect(0, y(latitude), size.width, 0)
    }
    if (hazard) {
      const radius = hazard.diameterKm * 90 / (Math.PI * MARS_RADIUS_KM)
      context.beginPath()
      context.ellipse(...position(hazard.latitude, hazard.longitude), radius * scale / Math.max(0.1, Math.cos(hazard.latitude * Math.PI / 180)), radius * scale, 0, 0, 2 * Math.PI)
      context.strokeStyle = '#F08A55'
      context.lineWidth = 2
      context.stroke()
    }
    if (rover) {
      // Recorded rover positions in sequence: an observation log, not a walking route.
      context.setLineDash([5, 4])
      line(rover.points.map(([latitude, longitude]) => [latitude, longitude]), '#1f6f8b', 2)
      context.setLineDash([])
      const [startLat, startLon] = rover.points[0], [endLat, endLon, endSol] = rover.points[rover.points.length - 1]
      context.font = '600 11px sans-serif'
      for (const [latitude, longitude, label] of [[startLat, startLon, 'Landing'], [endLat, endLon, `Sol ${endSol}`]] as const) {
        const [px, py] = position(latitude, longitude)
        context.beginPath(); context.arc(px, py, 4, 0, Math.PI * 2)
        context.fillStyle = '#1f6f8b'; context.fill()
        context.strokeStyle = '#fff'; context.lineWidth = 1.5; context.stroke()
        context.lineWidth = 3; context.strokeText(label, px + 8, py + 4); context.fillText(label, px + 8, py + 4)
      }
    }
    if (paths) {
      // Inactive routes first, the selected route last so it sits on top. A dark casing keeps
      // light route colours readable over bright orbital imagery.
      const entries = Object.entries(paths.routes).sort(([a], [b]) => Number(a === activeRoute) - Number(b === activeRoute))
      context.lineJoin = 'round'; context.lineCap = 'round'
      for (const [key, route] of entries) {
        const active = key === activeRoute
        line(route.points, '#0a0807cc', active ? 6 : 3.5)
        line(route.points, GLOBE_COLORS[key as RouteKey], active ? 3.5 : 1.75)
      }
    }
    if (point) {
      context.beginPath()
      context.arc(...position(point.latitude, point.longitude), 5, 0, Math.PI * 2)
      context.strokeStyle = '#F0D66C'
      context.lineWidth = 2
      context.stroke()
    }
    if (origin) {
      context.font = 'bold 12px sans-serif'
      context.textAlign = 'center'
      for (const [location, label, color] of [[origin, 'A', '#fff1e5'], ...(point ? [[point, 'B', '#ff8b3d']] : [])] as [Coordinates, string, string][]) {
        const [px, py] = position(location.latitude, location.longitude)
        context.beginPath(); context.arc(px, py, 13, 0, Math.PI * 2)
        context.fillStyle = '#0a0807'; context.fill()
        context.strokeStyle = color; context.lineWidth = 2; context.stroke()
        context.fillStyle = color; context.fillText(label, px, py + 4)
      }
    }
    if (traveler) {
      const [px, py] = position(traveler.position.latitude, traveler.position.longitude)
      const [nx, ny] = position(traveler.toward.latitude, traveler.toward.longitude)
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced'
      drawTraveler(context, px, py, { angle: Math.atan2(ny - py, nx - px), kind: traveler.kind, moving: traveler.moving,
        time: reduced ? 0 : performance.now() / 1000, reduced })
    }
  }, [size, center, scale, span, layer, grid, showSlopes, hazard, rover, paths, activeRoute, point, origin, traveler, revision, onTileStatus])

  const dragDistance = (event: PointerEvent) => Math.hypot(event.clientX - pointer.current!.x, event.clientY - pointer.current!.y)
  return <canvas className="mars-flat-map" ref={canvas} role="img" aria-label="Interactive two-dimensional Mars map"
    onWheel={(event) => { setSpan((degrees) => clamp(degrees * (event.deltaY < 0 ? 0.8 : 1.25), MIN_SPAN, INITIAL_WIDTH)) }}
    onPointerDown={(event) => { if (event.button !== 0) return; pointer.current = { x: event.clientX, y: event.clientY, center }; event.currentTarget.setPointerCapture(event.pointerId) }}
    onPointerMove={(event) => {
      const start = pointer.current
      if (!start || dragDistance(event) < 4) return
      setCenter({ latitude: clamp(start.center.latitude + (event.clientY - start.y) / scale, -90, 90),
        longitude: wrapLongitude(start.center.longitude - (event.clientX - start.x) / scale) })
    }}
    onPointerCancel={() => { pointer.current = null }}
    onPointerUp={(event) => {
      if (!pointer.current) return
      const distance = dragDistance(event)
      pointer.current = null
      if (distance >= 4) return
      const bounds = event.currentTarget.getBoundingClientRect()
      const latitude = center.latitude - (event.clientY - bounds.top - size.height / 2) / scale
      if (latitude >= -90 && latitude <= 90) onSelect({ latitude, longitude: wrapLongitude(center.longitude + (event.clientX - bounds.left - size.width / 2) / scale) }, 1 + span / 120)
    }} />
}
