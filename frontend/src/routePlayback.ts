import type { Route } from './types'

/** Sample by cumulative distance so diagonal/unequal path segments move consistently. */
export function sampleRouteAtFraction(route: Route | undefined, fraction: number) {
  if (!route || route.status !== 'ok' || route.path.length < 2) return null
  const distances = route.profile.dist
  if (distances.length !== route.path.length || distances[distances.length - 1] <= 0) return null
  const normalized = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
  const distance = normalized * distances[distances.length - 1]
  let low = 0, high = distances.length - 1
  while (high - low > 1) {
    const middle = (low + high) >>> 1
    if (distances[middle] <= distance) low = middle
    else high = middle
  }
  const part = Math.max(0, Math.min(1, (distance - distances[low]) / (distances[high] - distances[low] || 1)))
  const mix = (values: number[]) => values[low] + (values[high] - values[low]) * part
  const a = route.path[low], b = route.path[high]
  return { index: low + part, fraction: normalized, distance,
    traveler: [a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part] as [number, number],
    time: mix(route.profile.time), energy: mix(route.profile.energy), slope: mix(route.profile.slope), risk: mix(route.profile.risk),
  }
}
