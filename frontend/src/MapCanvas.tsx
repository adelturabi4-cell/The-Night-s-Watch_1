import { useEffect, useRef, useState } from 'react'
import { CLASS_INFO, routeKeyOf } from './render'
import { drawTraveler } from './travelerMarker'
import type { Cell, Obstacle, Route, RouteKey, Site, TerrainData } from './types'
import { ROUTE_KEYS, ROUTE_STYLE } from './types'

const S = 3 // canvas pixels per terrain cell
const REVEAL_MS = 1100

interface Props {
  terrain: TerrainData
  base: HTMLCanvasElement
  risk: Uint8Array | null
  cls: Uint8Array | null
  routes: Partial<Record<RouteKey, Route>>
  visible: Record<RouteKey, boolean>
  selected: RouteKey
  start: Cell
  goal: Cell
  pickMode: 'start' | 'goal' | null
  onPick: (cell: Cell) => void
  onSelectRoute?: (route: RouteKey) => void
  onCancel: () => void
  obstacles: Obstacle[]
  sites: Site[]
  traveler: [number, number] | null // fractional [row, col]
  progress: number | null // fractional index on the selected route
  moving?: boolean
  kind?: string
  revealId?: string
}

interface Hover {
  x: number
  y: number
  row: number
  col: number
  right: boolean
  bottom: boolean
}

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)

export default function MapCanvas(p: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef(p)
  const reveal = useRef({ key: '', t0: 0 })
  const hazardOverlay = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const keyboardCell = useRef<Cell | null>(null)
  const [cursor, setCursor] = useState<Cell | null>(null)
  const { terrain: t } = p

  useEffect(() => {
    live.current = p
  })

  useEffect(() => {
    if (p.pickMode) ref.current?.focus({ preventScroll: true })
  }, [p.pickMode])

  useEffect(() => {
    const routeKey = routeKeyOf(p.routes)
    const key = `${routeKey}:${p.selected}:${p.revealId ?? ''}`
    if (routeKey && key !== reveal.current.key) reveal.current = { key, t0: performance.now() }
  }, [p.routes, p.selected, p.revealId])

  useEffect(() => {
    if (!p.cls) {
      hazardOverlay.current = null
      return
    }
    const overlay = document.createElement('canvas')
    overlay.width = t.width
    overlay.height = t.height
    const ctx = overlay.getContext('2d')!
    const image = ctx.createImageData(t.width, t.height)
    for (let i = 0; i < p.cls.length; i++) {
      if (p.cls[i] === 2) {
        image.data.set([225, 48, 42, 105], i * 4)
      } else if (p.cls[i] === 3) {
        const row = Math.floor(i / t.width)
        const col = i % t.width
        image.data.set((row + col) % 2 ? [95, 14, 18, 220] : [150, 25, 28, 220], i * 4)
      }
    }
    ctx.putImageData(image, 0, 0)
    hazardOverlay.current = overlay
  }, [p.cls, t])

  // One animation loop for the whole map
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduced'
    const px = (v: number) => (v + 0.5) * S
    let raf = 0

    const trace = (path: Cell[], upto: number) => {
      ctx.beginPath()
      const last = Math.min(path.length - 1, Math.floor(upto))
      for (let i = 0; i <= last; i++) {
        if (i) ctx.lineTo(px(path[i][1]), px(path[i][0]))
        else ctx.moveTo(px(path[i][1]), px(path[i][0]))
      }
      if (last < path.length - 1) {
        const k = upto - last
        const a = path[last]
        const b = path[last + 1]
        ctx.lineTo(px(a[1] + (b[1] - a[1]) * k), px(a[0] + (b[0] - a[0]) * k))
      }
    }

    const pulse = (x: number, y: number, r0: number, r1: number, phase: number, color: string) => {
      ctx.beginPath()
      ctx.arc(x, y, r0 + (r1 - r0) * phase, 0, Math.PI * 2)
      ctx.globalAlpha = 0.8 * (1 - phase)
      ctx.lineWidth = 2
      ctx.strokeStyle = color
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    const draw = (now: number) => {
      const q = live.current
      const time = reduced ? 0 : now / 1000
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
      ctx.globalAlpha = 1
      ctx.textAlign = 'left'
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(q.base, 0, 0, cv.width, cv.height)

      if (hazardOverlay.current) ctx.drawImage(hazardOverlay.current, 0, 0, cv.width, cv.height)

      // Reported obstacles
      for (const o of q.obstacles) {
        const x = px(o.col)
        const y = px(o.row)
        const r = (o.radius + 0.5) * S
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(168, 53, 35, 0.55)'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#ffdbcf'
        ctx.setLineDash([4, 3])
        ctx.lineDashOffset = -time * 10
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineDashOffset = 0
        if (!reduced) pulse(x, y, r, r * 2.4, (time * 0.7) % 1, '#ff875f')
      }

      // Science sites
      ctx.font = '600 11px Inter, system-ui, sans-serif'
      ctx.textBaseline = 'middle'
      for (const s of q.sites) {
        const x = px(s.col)
        const y = px(s.row)
        ctx.beginPath()
        ctx.moveTo(x, y - 7)
        ctx.lineTo(x + 7, y)
        ctx.lineTo(x, y + 7)
        ctx.lineTo(x - 7, y)
        ctx.closePath()
        ctx.fillStyle = '#f4f1ea'
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#11120F'
        ctx.stroke()
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(17, 18, 15, 0.85)'
        ctx.strokeText(s.id, x + 10, y)
        ctx.fillStyle = '#f4f1ea'
        ctx.fillText(s.id, x + 10, y)
      }

      // Direct-line reference; the planner routes around terrain hazards.
      ctx.beginPath()
      ctx.moveTo(px(q.start[1]), px(q.start[0]))
      ctx.lineTo(px(q.goal[1]), px(q.goal[0]))
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.setLineDash([])
      ctx.lineWidth = 5
      ctx.strokeStyle = 'rgba(17, 18, 15, 0.85)'
      ctx.stroke()
      ctx.setLineDash([12, 8])
      ctx.lineWidth = 2.5
      ctx.strokeStyle = '#FFE16A'
      ctx.stroke()
      ctx.setLineDash([])

      // Routes: unselected first, selected on top; drawn on progressively
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      const order = [...ROUTE_KEYS.filter((k) => k !== q.selected), q.selected]
      order.forEach((key, n) => {
        const r = q.routes[key]
        if (!r || r.status !== 'ok' || !q.visible[key] || r.path.length < 2) return
        const st = ROUTE_STYLE[key]
        const sel = key === q.selected
        // The three lines start a beat apart so the eye can follow each one.
        const fk = reduced ? 1 : easeOut((now - reveal.current.t0 - n * 180) / REVEAL_MS)
        const upto = fk * (r.path.length - 1)
        trace(r.path, upto)
        ctx.setLineDash([])
        ctx.lineWidth = sel ? 8 : 5
        ctx.strokeStyle = 'rgba(17, 18, 15, 0.8)'
        ctx.stroke()
        trace(r.path, upto)
        ctx.setLineDash(st.dash.map((d) => d * (sel ? 1.4 : 1)))
        ctx.lineWidth = sel ? 4.5 : 2.5
        ctx.strokeStyle = st.color
        ctx.stroke()
        ctx.setLineDash([])
        if (sel && !reduced && q.moving !== false && fk >= 1) {
          // Light pulses travelling towards B show the direction of travel.
          trace(r.path, r.path.length - 1)
          ctx.setLineDash([3, 26])
          ctx.lineDashOffset = -time * 46
          ctx.lineWidth = 2.2
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
          ctx.stroke()
          ctx.setLineDash([])
          ctx.lineDashOffset = 0
        }
      })

      // Ground already covered
      const selRoute = q.routes[q.selected]
      if (q.progress !== null && q.progress > 0 && selRoute && selRoute.status === 'ok') {
        trace(selRoute.path, q.progress)
        ctx.shadowColor = '#ffffff'
        ctx.shadowBlur = 8
        ctx.lineWidth = 3
        ctx.strokeStyle = q.kind ? '#ff8b3d' : 'rgba(255, 255, 255, 0.95)'
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      // Start / goal
      const pin = (cell: Cell, label: string, fill: string) => {
        const x = px(cell[1])
        const y = px(cell[0])
        ctx.beginPath()
        ctx.arc(x, y, 10, 0, Math.PI * 2)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.lineWidth = 2.5
        ctx.strokeStyle = '#11120F'
        ctx.stroke()
        ctx.fillStyle = '#11120F'
        ctx.font = '700 12px Inter, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(label, x, y + 0.5)
        ctx.textAlign = 'left'
      }
      if (!reduced && q.moving !== false) pulse(px(q.goal[1]), px(q.goal[0]), 10, 30, (time * 0.6) % 1, '#F0D66C')
      pin(q.start, 'A', '#f4f1ea')
      pin(q.goal, 'B', '#F0D66C')

      // Traveler: pulsing beacon with a heading arrow
      if (q.traveler) {
        const x = px(q.traveler[1])
        const y = px(q.traveler[0])
        if (!reduced && q.moving !== false) {
          pulse(x, y, 7, 26, (time * 1.1) % 1, '#ffffff')
          pulse(x, y, 7, 26, (time * 1.1 + 0.5) % 1, '#ffffff')
        }
        let ang = 0
        if (selRoute && selRoute.status === 'ok' && selRoute.path.length > 1 && q.progress !== null) {
          const i = Math.min(selRoute.path.length - 2, Math.max(0, Math.floor(q.progress)))
          const a = selRoute.path[i]
          const b = selRoute.path[i + 1]
          ang = Math.atan2(b[0] - a[0], b[1] - a[1])
        }
        drawTraveler(ctx, x, y, { angle: ang, kind: q.kind, moving: q.moving, time, reduced })
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>): Hover => {
    const rect = e.currentTarget.getBoundingClientRect()
    const col = Math.min(t.width - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * t.width)))
    const row = Math.min(t.height - 1, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * t.height)))
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    return { x, y, row, col, right: x > rect.width / 2, bottom: y > rect.height / 2 }
  }

  let tip = null
  if (hover && !p.pickMode) {
    const i = hover.row * t.width + hover.col
    const elev = t.elevation[i]
    const site = p.sites.find((s) => Math.hypot(s.row - hover.row, s.col - hover.col) <= 3)
    tip = (
      <div
        className={`map-tip ${hover.right ? 'tip-right' : ''} ${hover.bottom ? 'tip-bottom' : ''}`}
        style={{ left: hover.x, top: hover.y }}
      >
        {site && (
          <div className="tip-site">
            <b>
              {site.id} · {site.name}
            </b>
            <span>{site.rationale}</span>
            {site.simulated && <em>Simulated placeholder site</em>}
          </div>
        )}
        <div className="tip-grid">
          <span>Grid</span>
          <b>
            row {hover.row}, col {hover.col}
          </b>
          <span>Local x, y</span>
          <b>
            {(hover.col * t.cell_size).toFixed(0)} m, {(hover.row * t.cell_size).toFixed(0)} m
          </b>
          <span>Elevation</span>
          <b>{Number.isNaN(elev) ? 'no data' : `${elev.toFixed(1)} m`}</b>
          <span>Slope</span>
          <b>{Number.isNaN(elev) ? '–' : `${t.slope[i].toFixed(1)}°`}</b>
          <span>Roughness</span>
          <b>{Number.isNaN(elev) ? '–' : `${t.roughness[i].toFixed(2)} m RMS`}</b>
          <span>Risk (model)</span>
          <b>{p.risk && !Number.isNaN(elev) ? (p.risk[i] / 255).toFixed(2) : '–'}</b>
          <span>Class</span>
          <b>{p.cls ? CLASS_INFO[p.cls[i]].label : '–'}</b>
          <span>Confidence</span>
          <b>{(t.confidence[i] / 255).toFixed(2)}</b>
        </div>
      </div>
    )
  }

  return (
    <div className="map-wrap">
      <canvas
        ref={ref}
        width={t.width * S}
        height={t.height * S}
        className={p.pickMode ? 'map picking' : 'map'}
        aria-label="Terrain grid"
        aria-describedby={p.pickMode ? 'map-instructions' : undefined}
        tabIndex={p.pickMode ? 0 : -1}
        onMouseMove={(e) => setHover(cellAt(e))}
        onMouseLeave={() => setHover(null)}
        onBlur={() => {
          keyboardCell.current = null
          setCursor(null)
        }}
        onClick={(e) => {
          const h = cellAt(e)
          if (!p.pickMode && p.onSelectRoute) {
            const nearest = ROUTE_KEYS.filter((key) => p.visible[key] && p.routes[key]?.status === 'ok').map((key) => ({ key,
              distance: Math.min(...p.routes[key]!.path.map(([r, c]) => Math.hypot(r - h.row, c - h.col))) })).sort((a, b) => a.distance - b.distance)[0]
            if (nearest && nearest.distance <= 4) { p.onSelectRoute(nearest.key); return }
          }
          p.onPick([h.row, h.col])
        }}
        onKeyDown={(e) => {
          if (!p.pickMode) return
          const [row, col] = keyboardCell.current ?? (p.pickMode === 'start' ? p.start : p.goal)
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            p.onPick([row, col])
            return
          }
          if (e.key === 'Escape') {
            p.onCancel()
            return
          }
          const step = e.shiftKey ? 10 : 1
          const offsets: Record<string, Cell | undefined> = {
            ArrowUp: [-step, 0], ArrowDown: [step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step],
          }
          const offset = offsets[e.key]
          if (!offset) return
          e.preventDefault()
          const cell: Cell = [
            Math.min(t.height - 1, Math.max(0, row + offset[0])),
            Math.min(t.width - 1, Math.max(0, col + offset[1])),
          ]
          keyboardCell.current = cell
          setCursor(cell)
        }}
      />
      {p.pickMode && cursor && (
        <>
          <span aria-hidden="true" className="map-cursor" style={{ left: `${100 * (cursor[1] + 0.5) / t.width}%`, top: `${100 * (cursor[0] + 0.5) / t.height}%` }} />
          <span className="sr-only" role="status">Row {cursor[0]}, column {cursor[1]}</span>
        </>
      )}
      {tip}
    </div>
  )
}
