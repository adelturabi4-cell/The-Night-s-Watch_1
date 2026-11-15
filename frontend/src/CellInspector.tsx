import { useEffect, useState } from 'react'
import type { Cell } from './types'
import { coordinatesLabel } from './mars'

interface CellReport {
  latitude: number; longitude: number
  region: { displayName: string; type: string; source: string; match: string; distanceKm: number }
  class: string; traversable: boolean; slope: number | null; roughness: number | null
  reasons: string[]; source: string; resolution: number; limits: string
}
export default function CellInspector({ cell, profile, slopeLimit, blocked }: { cell: Cell | null; profile: string; slopeLimit: number; blocked: boolean }) {
  const [response, setResponse] = useState<{ key:string; data?:CellReport; error?:string } | null>(null)
  const key = cell ? `${cell[0]},${cell[1]},${profile},${slopeLimit}` : ''
  const current = response?.key === key ? response : null
  useEffect(() => {
    if (!cell) return
    const controller = new AbortController()
    fetch(`/api/terrain/cell?row=${cell[0]}&col=${cell[1]}&profile=${encodeURIComponent(profile)}&max_slope_deg=${slopeLimit}`,{signal:controller.signal})
      .then(async (result) => { const data=await result.json(); if (!result.ok) throw new Error(data.detail ?? 'Inspection unavailable.'); if (!controller.signal.aborted) setResponse({key,data}) })
      .catch((error) => { if (!controller.signal.aborted) setResponse({key,error:error.message}) })
    return () => controller.abort()
  },[cell,profile,key,slopeLimit])
  return <section className="cell-inspector" aria-label="Selected terrain cell">
    <h3>Inspect this location</h3>
    {!cell && <p>Select a point to inspect terrain and slope. Use A and B to plan a route from your starting location.</p>}
    {cell && !current && <p role="status">Checking this location…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {blocked && <p className="inline-error">A reported obstacle occupies this cell. The current route avoids it.</p>}
    {current?.data && <><h4>{current.data.region.displayName}</h4><p>{coordinatesLabel(current.data)} · {current.data.region.type}</p><strong>{current.data.traversable ? 'This cell meets the model limits. Calculate a route to check connectivity.' : 'This cell exceeds the current mobility limits.'}</strong><ul>{current.data.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p>Slope: {current.data.slope?.toFixed(1) ?? '—'}° · Roughness: {current.data.roughness?.toFixed(2) ?? '—'} m · {current.data.class === 'safe' ? 'Lower modeled risk' : current.data.class}</p><small>{current.data.source} · {current.data.resolution} m/cell</small><p className="note">{current.data.limits}</p></>}
  </section>
}
