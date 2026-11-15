import type { LayerId, Route, RouteKey, TerrainData } from './types'
import { ROUTE_KEYS } from './types'

/** Redraw the route animation when the endpoints change. */
export function routeKeyOf(routes: Partial<Record<RouteKey, Route>>): string {
  for (const key of ROUTE_KEYS) {
    const route = routes[key]
    if (route?.status === 'ok' && route.path.length) return `${route.path[0]}|${route.path[route.path.length - 1]}`
  }
  return ''
}

type RGB = [number, number, number]

export const CLASS_INFO: { key: string; label: string; color: RGB }[] = [
  { key: 'safe', label: 'Lower modeled risk', color: [240, 214, 108] },
  { key: 'moderate', label: 'Moderate', color: [214, 178, 62] },
  { key: 'high_risk', label: 'High risk', color: [226, 108, 52] },
  { key: 'impassable', label: 'Impassable', color: [166, 58, 44] },
  { key: 'unknown', label: 'Unknown / poorly mapped', color: [117, 117, 109] },
]

export interface LayerInfo {
  id: LayerId
  label: string
  provenanceKey: string
  ramp?: { from: RGB; to: RGB; min: string; max: string }
}

export const LAYERS: LayerInfo[] = [
  { id: 'surface', label: 'Shaded relief', provenanceKey: 'elevation' },
  { id: 'elevation', label: 'Elevation', provenanceKey: 'elevation', ramp: { from: [51, 38, 27], to: [255, 214, 160], min: 'low', max: 'high' } },
  { id: 'slope', label: 'Slope', provenanceKey: 'slope', ramp: { from: [30, 28, 21], to: [245, 183, 89], min: '0°', max: '35°+' } },
  { id: 'risk', label: 'Mobility risk', provenanceKey: 'risk', ramp: { from: [30, 28, 21], to: [255, 96, 64], min: '0', max: '1' } },
  { id: 'class', label: 'Traversability class', provenanceKey: 'risk' },
  { id: 'confidence', label: 'Data confidence', provenanceKey: 'confidence', ramp: { from: [169, 78, 51], to: [30, 28, 21], min: 'low', max: 'high' } },
]

const shadeCache = new WeakMap<TerrainData, Float32Array>()

function hillshade(t: TerrainData): Float32Array {
  const hit = shadeCache.get(t)
  if (hit) return hit
  const { width: w, height: h, elevation: z, cell_size: cs } = t
  const out = new Float32Array(w * h)
  const exag = 2.5
  const L = [-0.5, -0.5, 0.7071]
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c
      const zc = z[i]
      if (Number.isNaN(zc)) {
        out[i] = NaN
        continue
      }
      const get = (rr: number, cc: number) => {
        const v = z[Math.min(h - 1, Math.max(0, rr)) * w + Math.min(w - 1, Math.max(0, cc))]
        return Number.isNaN(v) ? zc : v
      }
      const dx = ((get(r, c + 1) - get(r, c - 1)) / (2 * cs)) * exag
      const dy = ((get(r + 1, c) - get(r - 1, c)) / (2 * cs)) * exag
      const n = Math.hypot(dx, dy, 1)
      out[i] = Math.max(0, (-dx * L[0] - dy * L[1] + L[2]) / n)
    }
  }
  shadeCache.set(t, out)
  return out
}

const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/** Paint one map layer at native grid resolution (one pixel per cell). */
export function renderLayer(t: TerrainData, layer: LayerId, risk: Uint8Array | null, cls: Uint8Array | null): HTMLCanvasElement {
  const { width: w, height: h } = t
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const shade = hillshade(t)
  const span = Math.max(1e-6, t.maxElev - t.minElev)
  const info = LAYERS.find((l) => l.id === layer)!

  for (let i = 0; i < w * h; i++) {
    const s = shade[i]
    let rgb: RGB
    if (Number.isNaN(s)) {
      rgb = (i % w + Math.floor(i / w)) % 6 < 3 ? [21, 21, 17] : [39, 38, 30] // hatch = no data
    } else {
      const light = 0.35 + 0.85 * s
      const k = (t.elevation[i] - t.minElev) / span
      if (layer === 'surface') {
        const base = mix([122, 64, 40], [226, 164, 112], k)
        rgb = [base[0] * light, base[1] * light, base[2] * light]
      } else if (layer === 'class') {
        const c = CLASS_INFO[cls ? cls[i] : 0].color
        rgb = [c[0] * (0.55 + 0.5 * s), c[1] * (0.55 + 0.5 * s), c[2] * (0.55 + 0.5 * s)]
      } else {
        let v = k
        if (layer === 'slope') v = Math.min(1, t.slope[i] / 35)
        else if (layer === 'risk') v = risk ? risk[i] / 255 : 0
        else if (layer === 'confidence') v = t.confidence[i] / 255
        const c = mix(info.ramp!.from, info.ramp!.to, v)
        const l2 = 0.6 + 0.5 * s
        rgb = [c[0] * l2, c[1] * l2, c[2] * l2]
      }
    }
    img.data[i * 4] = Math.min(255, rgb[0])
    img.data[i * 4 + 1] = Math.min(255, rgb[1])
    img.data[i * 4 + 2] = Math.min(255, rgb[2])
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export const rgbCss = (c: RGB) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`

export function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`
}

export function fmtDur(s: number): string {
  const min = Math.round(s / 60)
  if (min >= 60 * 24) return `${(s / 86400).toFixed(1)} d`
  if (min >= 60) return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
  return `${min} min`
}

/** Linear interpolation into a per-point route array at fractional index. */
export function lerpAt(arr: number[], idx: number): number {
  if (arr.length === 0) return 0
  const i = Math.max(0, Math.min(arr.length - 1, idx))
  const lo = Math.floor(i)
  const hi = Math.min(arr.length - 1, lo + 1)
  return arr[lo] + (arr[hi] - arr[lo]) * (i - lo)
}
