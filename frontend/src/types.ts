export type RouteKey = 'shortest' | 'safest' | 'optimal'
export type LayerId = 'surface' | 'elevation' | 'slope' | 'risk' | 'class' | 'confidence'
export type Cell = [number, number] // [row, col]

export interface Site {
  id: string
  name: string
  row: number
  col: number
  value: number
  rationale: string
  simulated?: boolean
}

export interface TerrainMeta {
  name: string
  simulated: boolean
  source: string
  resolution_m: number
  crs: string
  extent_m: [number, number]
  layers: Record<string, string>
  limitations: string[]
}

export interface TerrainData {
  meta: TerrainMeta
  width: number
  height: number
  cell_size: number
  elevation: Float32Array
  slope: Float32Array
  roughness: Float32Array
  confidence: Uint8Array
  science_sites: Site[]
  suggested: { start: Cell; goal: Cell }
  minElev: number
  maxElev: number
}

export interface Profile {
  id: string
  label: string
  kind: string
  mass_kg: number
  speed_mps: number
  max_slope_deg: number
  crr: number
  efficiency: number
  base_power_w: number
  capacity_wh: number
  reserve_frac: number
  resource_name: string
  notes: string
}

export interface RouteProfile {
  dist: number[]
  elev: number[]
  slope: number[]
  risk: number[]
  conf: number[]
  energy: number[]
  time: number[]
}

export interface Metrics {
  distance_m: number
  straight_line_m: number
  duration_s: number
  energy_wh: number
  energy_usable_wh: number
  energy_margin_wh: number
  energy_feasible: boolean
  ascent_m: number
  descent_m: number
  max_slope_deg: number
  mean_risk: number
  max_risk: number
  hazard_exposure: number
  risk_score: number
  min_confidence: number
  mean_confidence: number
  science_score: number
  science_sites: string[]
  class_fractions: Record<string, number>
}

export interface Route {
  status: 'ok' | 'unreachable'
  reason?: string
  path: Cell[]
  profile: RouteProfile
  metrics: Metrics
  verdict?: { status: 'go' | 'caution' | 'no_go' | 'unknown'; label: string; reasons: string[] }
}

export interface Explanation {
  title: string
  kind: 'info' | 'warning'
  text: string
}

export interface Obstacle {
  row: number
  col: number
  radius: number
}

export interface RouteResult {
  profile: Profile
  weights: Record<string, number>
  routes: Record<RouteKey, Route>
  explanations: Explanation[]
  risk: Uint8Array
  cls: Uint8Array
  compute_ms: number
}

export interface Weights {
  distance: number
  time: number
  energy: number
  risk: number
  science: number
}

export const ROUTE_KEYS: RouteKey[] = ['shortest', 'safest', 'optimal']

export const ROUTE_OBJECTIVE: Record<RouteKey, string> = {
  safest: 'Minimize exposure to steep, rough, or poorly mapped terrain.',
  shortest: 'Minimize distance within the vehicle’s slope limit.',
  optimal: 'Balance distance, travel time, energy and terrain risk using the mission weights.',
}

// Warm scientific palette; dash patterns add a second, non-color encoding.
export const ROUTE_STYLE: Record<RouteKey, { label: string; color: string; dash: number[]; goal: string }> = {
  shortest: { label: 'Shortest', color: '#E9E6DC', dash: [7, 5], goal: 'Minimum traversable length' },
  safest: { label: 'Safest', color: '#D6B94D', dash: [2, 4], goal: 'Minimum terrain risk and uncertainty' },
  optimal: { label: 'Optimal', color: '#BD8054', dash: [], goal: 'Balanced by your mission priorities' },
}
