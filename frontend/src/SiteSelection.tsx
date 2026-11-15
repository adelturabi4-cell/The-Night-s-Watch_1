import type { Coordinates } from './mars'
import { coordinatesLabel } from './mars'
import { siteTitle } from './science'
import useSiteReport from './useSiteReport'
import SiteImagery from './SiteImagery'
import Icon from './Icon'

export default function SiteSelection({ point, onDetails, compact = false }: { point: Coordinates; onDetails: () => void; compact?: boolean }) {
  const { data, error, at, retry } = useSiteReport(point)
  return <section className={'selection-card' + (compact ? ' selection-compact' : '')} aria-label="Selected location and terrain risk" dir="ltr">
    
    <h2>{data?.region.displayName ?? siteTitle(point)}</h2>
    <p className="selection-coordinates" dir="ltr">{coordinatesLabel(point)}</p>
    <SiteImagery key={coordinatesLabel(point)} point={point} />
    {error ? <p role="alert">Could not assess terrain risk. <button onClick={retry}>Retry</button></p> : <div className="selection-verdict" data-status={data?.verdict.status ?? 'loading'} role="status">
      <span className="verdict-indicator" /><div><b>{data?.verdict.label ?? 'Checking terrain…'}</b><small>{data ? data.terrain.level === 'local' ? `Modelled terrain risk · ${data.terrain.resolutionM} m resolution` : 'Local hazards unknown · regional data only' : 'Terrain assessment'}</small></div>
      <strong>{data?.terrain.risk == null ? '—' : `${Math.round(data.terrain.risk * 100)}`}<small>/ 100</small></strong>
    </div>}
    {!compact && data && <p className="selection-reason">{data.verdict.reasons[0]?.text}</p>}
    <div className="selection-actions"><button className="primary" onClick={onDetails}>View details <Icon name="arrow" size={15} /></button><a className="button-link" href="#planner">Plan a route <Icon name="route" size={15} /></a></div>
    <small className="selection-time">{at ? `Assessed ${new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · ` : ''}Based on orbital data; no live hazard monitoring.</small>
  </section>
}
