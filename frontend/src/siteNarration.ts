import type { Assessment, Coordinates } from './mars'
import { identifyRegion, LANDMARKS } from './mars'
import type { Metrics, RouteKey } from './types'

export const JEZERO_WEATHER = {
  pressure: '650–761 Pa',
  wind: 'Up to 25 m/s in recorded gusts',
  temperature: 'About 52°C peak-to-peak in the daily component',
  source: 'https://doi.org/10.1038/s41561-022-01084-0',
}

const ROUTE_NAMES: Record<RouteKey, string> = { shortest: 'shortest', safest: 'lowest risk', optimal: 'balanced' }

export function isJezero(point: Coordinates) {
  return identifyRegion(point)?.name === LANDMARKS[0].name
}

export function terrainStatus(assessment: Assessment, score: number | null) {
  const slope = assessment.factors.find(({ key }) => key === 'slope')?.value
  const zone = assessment.factors.find(({ key }) => key === 'zone')?.value
  if (assessment.level !== 'local' || score === null || slope == null || zone == null) return 'unknown'
  return score < 60 || slope > 8 || zone < 100 ? 'elevated' : 'lower'
}

export function siteNarration(point: Coordinates, assessment: Assessment, score: number | null, route: Metrics | undefined, key: RouteKey, routeBusy: boolean) {
  const factor = (id: string) => assessment.factors.find(({ key: factorKey }) => factorKey === id)?.value
  const feature = identifyRegion(point)
  const number = (value: number, decimals = 1) => Math.abs(Number(value.toFixed(decimals))).toString()
  const elevation = factor('elevation')
  const slope = factor('slope')
  const roughness = factor('roughness')
  const zone = factor('zone')
  const hazard = assessment.hazard
  const status = terrainStatus(assessment, score)
  return [
    `Mars location report. ${feature?.name ?? 'Selected surface location'}.`,
    `Latitude ${number(point.latitude, 3)} degrees ${point.latitude < 0 ? 'south' : 'north'}, longitude ${number(point.longitude, 3)} degrees ${point.longitude < 0 ? 'west' : 'east'}.`,
    elevation != null && `Elevation ${number(elevation, 0)} metres ${elevation < 0 ? 'below' : 'above'} the reference datum.`,
    slope != null && `${assessment.level === 'regional' ? 'Regional' : 'Local'} slope ${number(slope)} degrees.`,
    roughness != null && `Terrain roughness ${number(roughness)} metres.`,
    zone != null && `Approximate flat area diameter ${number(zone, 0)} metres.`,
    hazard && `The nearest large crater rim is ${number(hazard.rimDistanceKm)} kilometres away.`,
    status === 'unknown' ? 'Local traversability is unconfirmed because detailed terrain evidence is missing.' : `Modelled terrain risk is ${status === 'elevated' ? 'elevated' : 'relatively low'}. Educational score ${score} out of one hundred.`,
    'Small rocks, soil strength and current weather are unmeasured.',
    isJezero(point) && 'Early Perseverance observations recorded daily pressure between 650 and 761 pascals, wind gusts up to 25 metres per second, and a daily temperature variation of about 52 degrees Celsius. These are historical observations.',
    route ? `The ${ROUTE_NAMES[key]} route is ${number(route.distance_m, 0)} metres long, with a relative risk index of ${number(route.risk_score, 0)} out of one hundred. ${route.energy_feasible ? 'The estimated energy fits the current budget.' : 'The route exceeds the available energy budget including reserves.'}`
      : routeBusy ? 'Calculating the route.' : 'No local route is available for this selection.',
  ].filter(Boolean).join(' ')
}
