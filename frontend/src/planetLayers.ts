import { wrapLongitude } from './mars'
import type { Coordinates } from './mars'

export const PLANET_LAYERS = {
  packMola: { label: 'MOLA · supplied data', source: 'MarsPath · MEGT90N000EB', resolution: '3,705 m/pixel · regional' },
  packHirise: { label: 'HiRISE · supplied imagery', source: 'ESP_052869_1660_RED · partial quicklook', resolution: 'Display only · no elevation model' },
  natural: { label: 'Natural color', source: 'Viking MDIM 2.1 · NASA / JPL / USGS', resolution: '232 m native · detailed tiles on zoom', product: 'viking', max: 7 },
  elevation: { label: 'Elevation', source: 'MGS MOLA MEGDR', resolution: '0.25°/px' },
  relief: { label: 'Terrain shading', source: 'NASA Mars Trek · MOLA color relief', resolution: '463 m native', product: 'relief', max: 7 },
  roughness: { label: 'Surface roughness', source: 'NASA Mars Trek · MOLA roughness', resolution: 'regional proxy', product: 'roughness', max: 1 },
  thermal: { label: 'Thermal infrared', source: 'NASA Mars Trek · Odyssey THEMIS daytime IR', resolution: '100 m native', product: 'thermal', max: 8 },
  geology: { label: 'Geological map', source: 'USGS SIM 3292', resolution: '1:20,000,000', product: 'geology', max: 4 },
  ctx: { label: 'Jezero high resolution', source: 'NASA Mars Trek · MRO CTX', resolution: '6 m native', product: 'ctx', max: 13 },
} as const

export type PlanetLayer = keyof typeof PLANET_LAYERS
export const HIRISE_BOUNDS = { west:-63.383174, south:-14.087599, east:-63.268963, north:-13.955852 }
export const HIRISE_CENTER = { latitude:-14.0217255, longitude:-63.3260685 }
/** Footprint of the bundled Jezero relief image (/mars/jezero-relief.png), equirectangular. */
export const CTX_RELIEF_BOUNDS = { west: 77.33609060769474, east: 77.56375685726432, south: 18.34205901384007, north: 18.55800275602395 }
export const JEZERO_IMAGE_BOUNDS = { west: 77.1604655, south: 18.2110274, east: 77.6991776, north: 18.7211945 }

export function tileAt(point: Coordinates, zoom: number) {
  const rows = 2 ** zoom
  const columns = rows * 2
  return {
    column: Math.floor((wrapLongitude(point.longitude) + 180) / 360 * columns),
    row: Math.min(rows - 1, Math.max(0, Math.floor((90 - point.latitude) / 180 * rows))),
  }
}

export function tileBounds(level: number, row: number, column: number) {
  const span = 180 / 2 ** level
  return { west: -180 + column * span, east: -180 + (column + 1) * span, north: 90 - row * span, south: 90 - (row + 1) * span }
}

export function tileUrl(product: string, level: number, row: number, column: number) {
  return `/api/layers/${product}/${level}/${row}/${column}`
}
