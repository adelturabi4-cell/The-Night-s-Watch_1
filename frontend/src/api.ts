import type { Cell, Obstacle, Profile, RouteResult, TerrainData, Weights } from './types'

export function bytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const f32 = (b64: string) => new Float32Array(bytes(b64).buffer)

async function json(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed (${res.status})`)
  }
  return res.json()
}

export async function fetchTerrain(): Promise<TerrainData> {
  const j = await json(await fetch('/api/terrain'))
  return decodeTerrain(j)
}

export function decodeTerrain(j: Omit<TerrainData, 'elevation' | 'slope' | 'roughness' | 'confidence' | 'minElev' | 'maxElev'> & { elevation: string; slope: string; roughness: string; confidence: string }): TerrainData {
  const elevation = f32(j.elevation)
  let minElev = Infinity
  let maxElev = -Infinity
  for (const v of elevation) {
    if (Number.isNaN(v)) continue
    if (v < minElev) minElev = v
    if (v > maxElev) maxElev = v
  }
  return {
    ...j,
    elevation,
    slope: f32(j.slope),
    roughness: f32(j.roughness),
    confidence: bytes(j.confidence),
    minElev,
    maxElev,
  }
}

export async function fetchProfiles(): Promise<{ profiles: Profile[]; default_weights: Weights }> {
  return json(await fetch('/api/profiles'))
}

export interface RouteQuery {
  start: Cell
  goal: Cell
  profile: string
  overrides: Record<string, number>
  weights: Weights
  obstacles: Obstacle[]
}

export async function fetchRoutes(q: RouteQuery, signal?: AbortSignal): Promise<RouteResult> {
  const j = await json(
    await fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(q),
      signal,
    }),
  )
  return { ...j, risk: bytes(j.layers.risk), cls: bytes(j.layers.cls) }
}
