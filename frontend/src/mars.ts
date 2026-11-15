import type { Metrics, RouteKey, Weights as RouteWeights } from './types'
import { lookupRegion } from './regionLookup'

export type Coordinates = { latitude: number; longitude: number }
export type FactorKey = 'elevation' | 'slope' | 'rocks' | 'craters' | 'roughness' | 'zone' | 'hazard' | 'access'
export type WeightKey = 'slope' | 'craters' | 'roughness' | 'zone' | 'access'
export type Weights = Record<WeightKey, number>

export const GLOBE_COLORS: Record<RouteKey, string> = {
  shortest: '#E9E6DC', safest: '#D6B94D', optimal: '#BD8054',
}

export const FACTOR_LABELS: Record<FactorKey, string> = {
  elevation: 'Elevation', slope: 'Surface slope', rocks: 'Rock abundance', craters: 'Crater density',
  roughness: 'Roughness', zone: 'Landing zone', hazard: 'Nearest major crater rim', access: 'Surface accessibility',
}

export const DEFAULT_LANDING_WEIGHTS: Weights = { slope: 30, craters: 15, roughness: 20, zone: 25, access: 10 }

export function scoreAssessment(factors: Factor[], weights: Weights) {
  let numerator = 0
  let denominator = 0
  for (const factor of factors) {
    const weight = weights[factor.key as WeightKey]
    if (!weight || factor.score === null) continue
    numerator += factor.score * weight
    denominator += weight
  }
  return denominator ? Math.round(numerator / denominator) : null
}

export interface Factor {
  key: FactorKey
  value: number | null
  unit: string
  score: number | null
  detail: string
  source: string | null
}

export interface Crater extends Coordinates {
  diameterKm: number
  rimDistanceKm: number
  inside: boolean
}

export interface Assessment {
  elevationLookup?: { status: string }
  resolutionM?: number
  region?: { displayName: string; type: string; match: string; distanceKm: number; source: string }
  accessibility?: { status: string; label: string; reasons: string[]; limits: string }
  level: 'local' | 'regional'
  routeAvailable: boolean
  craterCount: number | null
  hazard: Crater | null
  factors: Factor[]
}

export interface SurfaceRoutes {
  waypoint: [number, number] | null
  reason: string | null
  routes: Partial<Record<RouteKey, { points: [number, number][]; metrics: Metrics }>>
}

export const LANDMARKS = [
  { name: 'Jezero', feature: 'Jezero crater', latitude: 18.45, longitude: 77.45, radiusKm: 23, type: 'Impact crater' },
  { name: 'Olympus Mons', feature: 'Olympus Mons', latitude: 18.65, longitude: -133.8, radiusKm: 305, type: 'Shield volcano' },
  { name: 'Valles Marineris', feature: 'Valles Marineris', latitude: -14.01, longitude: -58.59, radiusKm: 500, type: 'Canyon system' },
  { name: 'Gale', feature: 'Gale crater', latitude: -5.44, longitude: 137.7, radiusKm: 77, type: 'Impact crater' },
  { name: 'Hellas Planitia', feature: 'Hellas Planitia', latitude: -42.43, longitude: 70.5, radiusKm: 1000, type: 'Impact basin' },
]

export const MARS_RADIUS_KM = 3396.19
/** Perseverance landing point (Octavia E. Butler Landing), used as the default route origin. */
export const LANDING_SITE: Coordinates = { latitude: 18.4446, longitude: 77.4509 }

export function wrapLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180
}

export function coordinatesLabel({ latitude, longitude }: Coordinates) {
  return `${Math.abs(latitude).toFixed(3)}° ${latitude < 0 ? 'S' : 'N'}, ${Math.abs(longitude).toFixed(3)}° ${longitude < 0 ? 'W' : 'E'}`
}

export function identifyRegion(point: Coordinates) {
  return lookupRegion(point.latitude, point.longitude)
}

export async function fetchMars<T>(path: string, point: Coordinates, signal: AbortSignal): Promise<T> {
  const query = new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude) })
  const response = await fetch(`/api/landing${path}?${query}`, { signal })
  if (!response.ok) throw new Error('Unable to retrieve the terrain data. Check that the local server is running.')
  return response.json() as Promise<T>
}

export interface SiteRouteSettings {
  profile: string
  overrides: Record<string, number>
  weights: RouteWeights
}

export async function fetchSiteRoutes(point: Coordinates, settings: SiteRouteSettings, signal: AbortSignal): Promise<SurfaceRoutes> {
  const response = await fetch('/api/landing/routes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...point, ...settings }),
    signal,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'Unable to calculate routes for this site.')
  }
  return response.json()
}
