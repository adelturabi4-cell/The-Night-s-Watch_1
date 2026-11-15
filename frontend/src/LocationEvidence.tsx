import type { Assessment } from './mars'

export default function LocationEvidence({ assessment }: { assessment: Assessment | null | undefined }) {
  if (!assessment?.accessibility) return null
  const access = assessment.accessibility
  return <section className="location-evidence" aria-label="Location access and hazards">
    <h3>{access.label}</h3>
    {assessment.region && <p>{assessment.region.displayName} · {assessment.region.type}<br />{assessment.region.match === 'nearest_named_feature' ? `Nearest named feature, ${assessment.region.distanceKm} km away.` : 'Approximate feature extent; not a surveyed boundary.'} <a href={assessment.region.source} target="_blank" rel="noreferrer">USGS ↗</a></p>}
    <ul>{access.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    <p className="note">{access.limits}</p>
  </section>
}
