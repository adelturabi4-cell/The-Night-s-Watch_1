import type { Coordinates } from './mars'

export type VerdictStatus = 'go' | 'caution' | 'no_go' | 'unknown'
export type Severity = 'block' | 'warn' | 'ok' | 'info'

export interface Reason {
  code: string
  severity: Severity
  text: string
  value: number | null
  limit: number | null
  unit: string | null
  source: string | null
}

export interface RoverWaypoint extends Coordinates {
  sol: number
  site: number | null
  drive: number | null
  elev_geoid: number | null
  tilt: number | null
  dist_total_m: number | null
  note: string | null
  images: { name: string; url: string; panoramic: boolean }[]
  index: number
  distanceM: number
  imageAtSelection: boolean
  credit: string
}

export interface SiteReport {
  elevationLookup?: { status: 'idle' | 'pending' | 'ready' | 'not_available' | 'unavailable' }
  coordinates: Coordinates
  profile: { id: string; label: string; maxSlopeDeg: number }
  region: { name: string; displayName: string; type: string; match: string; distanceKm: number; source: string }
  verdict: {
    status: VerdictStatus
    label: string
    labelEn: string
    confidence: 'local' | 'regional'
    reasons: Reason[]
    nextStep: string
    limits: string
  }
  terrain: {
    level: 'local' | 'regional'
    resolutionM: number
    source: string
    sourceUrl?: string | null
    productId?: string | null
    elevationM: number | null
    slopeDeg: number | null
    roughnessM: number | null
    class: string | null
    risk: number | null
  }
  routeAvailable: boolean
  geology: {
    symbol: string; name: string; color: string | null; description: string
    characteristics: string | null; interpretation: string | null; scale: string; citation: string; note: string
  } | null
  surfaceFeature: string | null
  smallCraters: { count: number; radiusM: number; nearestM: number } | null
  landingEllipse: boolean | null
  inJezeroMap: boolean
  rover: RoverWaypoint | null
  unavailable: { key: string; label: string; why: string }[]
}

export interface RoverTrack {
  credit: string
  source: string
  note: string
  points: [number, number, number][] // latitude, longitude, sol
}

export const MOBILITY_OPTIONS = [
  { id: 'astronaut_eva', label: 'Astronaut on foot (EVA)' },
  { id: 'rover_scout', label: 'Scout rover' },
  { id: 'rover_large', label: 'Large science rover' },
] as const

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'Could not load site data. Check the local server connection.')
  }
  return response.json()
}

export function fetchSiteReport(point: Coordinates, profile: string, signal: AbortSignal) {
  const query = new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude), profile })
  return getJson<SiteReport>(`/api/site?${query}`, signal)
}

let track: Promise<RoverTrack> | null = null
/** The rover track never changes during a session, so it is requested once. */
export function fetchRoverTrack() {
  track ??= getJson<RoverTrack>('/api/jezero/rover').catch((error) => { track = null; throw error })
  return track
}
