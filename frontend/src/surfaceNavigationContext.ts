import { createContext, useContext } from 'react'
import type { Coordinates, SurfaceRoutes } from './mars'
import type { RouteKey } from './types'

export const key = (point: Coordinates) => `${point.latitude},${point.longitude}`
export interface NavigationState {
  origin: Coordinates
  setOrigin: (point: Coordinates) => void
  plan: (point: Coordinates) => void
  pathsFor: (point: Coordinates | null) => SurfaceRoutes | null
  strategy: RouteKey
  setStrategy: (strategy: RouteKey) => void
  busy: string
  error: { key: string; message: string } | null
}
export const NavigationContext = createContext<NavigationState | null>(null)
export function useSurfaceNavigation() {
  const state = useContext(NavigationContext)
  if (!state) throw new Error('Navigation provider is missing')
  return state
}
