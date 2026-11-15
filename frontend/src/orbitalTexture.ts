import { CTX_RELIEF_BOUNDS, JEZERO_IMAGE_BOUNDS, PLANET_LAYERS, tileBounds, tileUrl } from './planetLayers'

/** Builds a texture for a terrain grid from the same orbital imagery the route map shows
 * (CTX 6 m tiles over the Jezero relief image), so the 3D view is the route map in relief.
 *
 * Every terrain cell knows its latitude and longitude. The imagery is mosaicked in
 * lon/lat space, then resampled cell by cell into the terrain's row/column layout,
 * which is the layout the 3D mesh expects for its texture. */
const TILE = 256
const MAX_TILES = 48
const SUPERSAMPLE = 4 // texture pixels per terrain cell along each axis
const MAX_TEXTURE = 1536

function loadImage(src: string, signal: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(null)
    const image = new Image()
    const done = (ok: boolean) => { signal.removeEventListener('abort', abort); resolve(ok && image.naturalWidth ? image : null) }
    const abort = () => { image.src = ''; done(false) }
    signal.addEventListener('abort', abort)
    image.onload = () => done(true)
    image.onerror = () => done(false)
    image.src = src
  })
}

function boundsOf(latitude: Float32Array, longitude: Float32Array) {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity
  for (let i = 0; i < latitude.length; i++) {
    const lat = latitude[i], lon = longitude[i]
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (lat < south) south = lat; if (lat > north) north = lat
    if (lon < west) west = lon; if (lon > east) east = lon
  }
  return { south, north, west, east }
}

export interface OrbitalTexture { canvas: HTMLCanvasElement; tiles: number; loaded: number }

export async function buildOrbitalTexture(latitude: Float32Array, longitude: Float32Array, width: number, height: number,
  signal: AbortSignal): Promise<OrbitalTexture | null> {
  const area = boundsOf(latitude, longitude)
  if (!Number.isFinite(area.south)) return null
  const covered = area.east >= JEZERO_IMAGE_BOUNDS.west && area.west <= JEZERO_IMAGE_BOUNDS.east
    && area.north >= JEZERO_IMAGE_BOUNDS.south && area.south <= JEZERO_IMAGE_BOUNDS.north

  // Highest CTX level whose tile count over the area stays within budget.
  let level = PLANET_LAYERS.ctx.max
  const range = (l: number) => {
    const degrees = 180 / 2 ** l
    return { degrees, c0: Math.floor((area.west + 180) / degrees), c1: Math.floor((area.east + 180) / degrees),
      r0: Math.floor((90 - area.north) / degrees), r1: Math.floor((90 - area.south) / degrees) }
  }
  let tiles = range(level)
  while (level > 8 && (tiles.c1 - tiles.c0 + 1) * (tiles.r1 - tiles.r0 + 1) > MAX_TILES) tiles = range(--level)
  const { degrees, c0, c1, r0, r1 } = tiles
  const mosaic = document.createElement('canvas')
  mosaic.width = (c1 - c0 + 1) * TILE
  mosaic.height = (r1 - r0 + 1) * TILE
  const m = mosaic.getContext('2d', { willReadFrequently: true })!
  const west = -180 + c0 * degrees, north = 90 - r0 * degrees, perPixel = degrees / TILE
  const place = (image: HTMLImageElement, b: { west: number; east: number; south: number; north: number }) =>
    m.drawImage(image, (b.west - west) / perPixel, (north - b.north) / perPixel, (b.east - b.west) / perPixel, (b.north - b.south) / perPixel)

  // Same layering as the route map: relief image underneath, CTX tiles on top.
  const relief = await loadImage('/mars/jezero-relief.png', signal)
  if (relief) place(relief, CTX_RELIEF_BOUNDS)
  let loaded = 0, requested = 0
  if (covered) {
    const jobs: Promise<void>[] = []
    for (let row = r0; row <= r1; row++) for (let column = c0; column <= c1; column++) {
      requested++
      jobs.push(loadImage(tileUrl('ctx', level, row, column), signal).then((image) => {
        if (image) { place(image, tileBounds(level, row, column)); loaded++ }
      }))
    }
    await Promise.all(jobs)
  }
  if (signal.aborted || (!relief && !loaded)) return null

  // Resample: each texture pixel takes the lat/lon of its fractional terrain cell.
  const scale = Math.max(1, Math.min(SUPERSAMPLE, Math.floor(MAX_TEXTURE / Math.max(width, height))))
  const out = document.createElement('canvas')
  out.width = width * scale
  out.height = height * scale
  const source = m.getImageData(0, 0, mosaic.width, mosaic.height).data
  const target = out.getContext('2d')!.createImageData(out.width, out.height)
  const at = (array: Float32Array, row: number, col: number) => {
    const r0i = Math.min(height - 1, Math.floor(row)), c0i = Math.min(width - 1, Math.floor(col))
    const r1i = Math.min(height - 1, r0i + 1), c1i = Math.min(width - 1, c0i + 1)
    const fr = row - r0i, fc = col - c0i
    const top = array[r0i * width + c0i] * (1 - fc) + array[r0i * width + c1i] * fc
    const bottom = array[r1i * width + c0i] * (1 - fc) + array[r1i * width + c1i] * fc
    return top * (1 - fr) + bottom * fr
  }
  for (let y = 0; y < out.height; y++) {
    const row = Math.max(0, (y + 0.5) / scale - 0.5)
    for (let x = 0; x < out.width; x++) {
      const col = Math.max(0, (x + 0.5) / scale - 0.5)
      const px = Math.round((at(longitude, row, col) - west) / perPixel)
      const py = Math.round((north - at(latitude, row, col)) / perPixel)
      const t = (y * out.width + x) * 4
      if (px < 0 || py < 0 || px >= mosaic.width || py >= mosaic.height) { target.data[t + 3] = 255; continue }
      const s = (py * mosaic.width + px) * 4
      target.data[t] = source[s]; target.data[t + 1] = source[s + 1]; target.data[t + 2] = source[s + 2]; target.data[t + 3] = 255
    }
  }
  out.getContext('2d')!.putImageData(target, 0, 0)
  return { canvas: out, tiles: requested, loaded }
}
