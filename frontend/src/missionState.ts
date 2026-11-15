import type { Cell, Metrics, Profile, RouteKey, TerrainMeta, Weights } from './types'

export interface RouteReport {
  id: string
  savedAt: string
  selected: RouteKey
  start: Cell
  goal: Cell
  terrain: TerrainMeta
  profile: Profile
  weights: Weights
  routes: Partial<Record<RouteKey, Metrics>>
  events: { clock: string; text: string }[]
  simulation?: {
    status: 'ready' | 'running' | 'paused' | 'complete'
    covered_m: number
    mission_time_s: number
    energy_used_wh: number
    remaining_usable_wh: number
    reported_obstacles: number
  }
}

export interface Preferences {
  name: string
  compact: boolean
  reducedMotion: boolean
}

export const DEFAULT_PREFERENCES: Preferences = { name: 'Mission specialist', compact: false, reducedMotion: false }
export const REPORTS_KEY = 'martian-map-route-reports-v1'
export const PREFERENCES_KEY = 'martian-map-preferences-v1'

export function downloadReport(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
