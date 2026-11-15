import { useState } from 'react'
import ReportVoice from './ReportVoice'
import { coordinatesLabel, DEFAULT_LANDING_WEIGHTS, FACTOR_LABELS, GLOBE_COLORS, identifyRegion, scoreAssessment } from './mars'
import type { Assessment, Coordinates, SurfaceRoutes, WeightKey } from './mars'
import { fmtDist, fmtDur } from './render'
import { isJezero, JEZERO_WEATHER, siteNarration, terrainStatus } from './siteNarration'
import { ROUTE_KEYS, ROUTE_OBJECTIVE, ROUTE_STYLE } from './types'
import type { RouteKey } from './types'
import { SurvivalEvidence } from './MissionPages'
import SiteGuide from './SiteGuide'
import SiteImagery from './SiteImagery'

const SAFETY_LABELS = { unknown: 'Safety undetermined', elevated: 'Elevated terrain risk', lower: 'Lower modeled terrain risk' }

interface Props {
  point: Coordinates
  assessment: Assessment | null
  error: string | null
  onRetry: () => void
  paths: SurfaceRoutes | null
  routeBusy: boolean
  routeError: string | null
  activeRoute: RouteKey
  onShowRoutes: () => void
  onSelectRoute: (route: RouteKey) => void
  full: boolean
  onOpenReport: () => void
  onSave: () => void
  showHazard: boolean
  onShowHazard: () => void
  onShowSlopes: () => void
  initialTab?: AnalysisTab
}

const TABS = [['overview', 'Overview'], ['terrain', 'Terrain'], ['landing', 'Landing Suitability'], ['hazards', 'Hazards'], ['environment', 'Environment'], ['resources', 'Water & Resources'], ['routes', 'Routes'], ['guide', 'AI Analysis']] as const
export type AnalysisTab = typeof TABS[number][0]


export default function LandingReport({ point, assessment, error, onRetry, paths, routeBusy, routeError, activeRoute, onShowRoutes, onSelectRoute,
  full, onOpenReport, onSave, showHazard, onShowHazard, onShowSlopes, initialTab = 'overview' }: Props) {
  const [weights, setWeights] = useState(DEFAULT_LANDING_WEIGHTS)
  const [tab, setTab] = useState<AnalysisTab>(initialTab)
  const feature = identifyRegion(point)
  const score = assessment ? scoreAssessment(assessment.factors, weights) : null
  const available = assessment?.factors.filter((factor) => factor.score !== null) ?? []
  const lowest = [...available].sort((first, second) => first.score! - second.score!)[0]
  const highest = [...available].sort((first, second) => second.score! - first.score!)[0]
  const selectedRoute = paths?.routes[activeRoute]
  const shortest = paths?.routes.shortest
  const distanceChange = selectedRoute && shortest ? selectedRoute.metrics.distance_m - shortest.metrics.distance_m : 0
  const riskChange = selectedRoute && shortest ? selectedRoute.metrics.risk_score - shortest.metrics.risk_score : 0
  const safety = assessment ? terrainStatus(assessment, score) : 'unknown'
  const voiceText = assessment && siteNarration(point, assessment, score, selectedRoute?.metrics, activeRoute, routeBusy)

  return (
    <aside className={full ? 'mars-report full-report' : 'mars-report'} aria-label="Landing site report">
      <section className="mars-report-section mars-site">
        
        <h2 tabIndex={-1}>{feature?.feature ?? 'Surface coordinates'}</h2>
        <p className="mars-coordinates">{coordinatesLabel(point)}</p>
        <p className="mars-muted">{feature?.type ?? 'Terrain type unavailable'} · Mars planetocentric</p>
        {voiceText && <ReportVoice key={voiceText} text={voiceText} />}
        <div className="mission-toolbar">
          {full ? <a href="#explore">Return to globe</a> : <button onClick={onOpenReport}>Open full analysis</button>}
          <button type="button" onClick={onSave} disabled={!assessment}>Save candidate</button>
          <a className="button-link primary-link" href="#planner">Plan a route here</a>
        </div>
      </section>
      {error && <section className="mars-report-section"><p role="alert">{error}</p><button onClick={onRetry}>Retry analysis</button></section>}
      {!error && !assessment && <p className="mars-report-section" role="status">Analyzing orbital terrain data…</p>}
      {assessment && (
        <>
          {full && <nav className="mission-tabs" aria-label="Location analysis sections">
            {TABS.map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
          </nav>}
          {full && tab === 'overview' && <section className="mars-report-section">
            <div className="site-overview">
              <SiteImagery key={coordinatesLabel(point)} point={point} />
              <div>
                <h3>Terrain overview</h3>
                <dl className="mars-weather">
                  <div><dt>Elevation</dt><dd>{assessment.factors.find((factor) => factor.key === 'elevation')?.value ?? 'Unavailable'} m</dd></div>
                  <div><dt>Coverage</dt><dd>{assessment.level === 'local' ? `Local CTX elevation · ${assessment.resolutionM ?? 20} m cells` : `Regional altimetry grid · MOLA · ${assessment.resolutionM ?? 3705} m cells`}</dd></div>
                  <div><dt>Terrain classification</dt><dd>{feature?.type ?? 'Unclassified'}</dd></div>
                </dl>
                <p>{feature?.name === 'Jezero' ? 'Jezero lies on the western edge of Isidis Planitia. Orbital and rover observations document deposits associated with an ancient lake and delta.' : 'The site is screened against public orbital elevation and crater products. Open Landing to inspect factor sources and coverage.'}</p>
                <a href={feature?.name === 'Jezero' ? 'https://www.jpl.nasa.gov/news/press_kits/mars_2020/launch/mission/landing_site/' : 'https://planetarynames.wr.usgs.gov/Page/MARS/target'} target="_blank" rel="noreferrer">Scientific context ↗</a>
              </div>
            </div>
          </section>}
          {full && tab === 'terrain' && <section className="mars-report-section terrain-analysis"><h3>Terrain evidence & factor scores</h3><p className="mars-muted">Each bar is a derived factor score, not a measurement or probability of success. Expand Landing Suitability to adjust the weighting.</p><div className="terrain-factor-grid">{assessment.factors.map((factor) => <article key={factor.key}><div><h4>{FACTOR_LABELS[factor.key]}</h4><span className="tag">{factor.score === null ? 'NO SCORE' : 'DERIVED'}</span></div><strong>{factor.value === null ? 'Unavailable' : `${factor.value} ${factor.unit}`}</strong>{factor.score !== null && <progress max={100} value={factor.score} aria-label={`${FACTOR_LABELS[factor.key]} factor score`} />}<p>{factor.detail}</p><small>{factor.source ?? 'No local measurement available'}</small></article>)}</div></section>}
          {full && tab === 'environment' && <section className="mars-report-section"><SurvivalEvidence point={point} topics={['Temperature', 'Radiation', 'Atmosphere']} /></section>}
          {full && tab === 'resources' && <section className="mars-report-section"><SurvivalEvidence point={point} topics={['Water resources', 'Energy', 'Food and agriculture', 'Communication']} /></section>}
          {full && tab === 'hazards' && <section className="mars-report-section">
            <h3>Hazard coverage</h3>
            <dl className="mars-weather">
              <div><dt>Large craters</dt><dd>{assessment.hazard ? `${assessment.hazard.rimDistanceKm} km to the nearest mapped circular rim` : 'Unavailable'}</dd></div>
              <div><dt>Steep slopes</dt><dd>{assessment.level === 'local' ? '20 m CTX screening available' : 'Regional slope only'}</dd></div>
              <div><dt>Boulders, rock fields, dunes and unstable ground</dt><dd>Site measurements unavailable</dd></div>
            </dl>
            <div className="mission-toolbar">
              {assessment.hazard && <button aria-pressed={showHazard} onClick={onShowHazard}>Locate crater rim on globe</button>}
              {assessment.level === 'local' && <button onClick={onShowSlopes}>Show steep terrain on globe</button>}
            </div>
            <p className="mars-muted">Red cells exceed 15° on the 20 m CTX grid. This threshold is a visual screening aid.</p>
            <p className="mars-muted">Orange marks a catalogued crater rim. Geometry is approximated from a center and diameter. Unmapped obstacles remain possible.</p>
          </section>}
          {full && tab === 'guide' && <section className="mars-report-section"><SiteGuide point={point} assessment={assessment} score={score} paths={paths} /></section>}
          {(!full || tab === 'landing') && <section className="mars-report-section">
            <div className="mars-section-heading">
              <h3>Landing terrain suitability</h3>
              <span className="mars-metadata">{assessment.level === 'local' ? 'CTX · 20 m/px' : `MOLA · ${assessment.resolutionM ?? 3705} m/px`}</span>
            </div>
            <div className="mars-score">
              <div><strong>{score ?? '—'}</strong><span> / 100</span></div>
              <div>
                <b className={`terrain-safety ${safety}`}>{SAFETY_LABELS[safety]}</b>
                <small>{assessment.level === 'local' ? 'Educational terrain score' : 'Regional terrain screening'}</small>
              </div>
            </div>
            {score !== null && <progress aria-label="Terrain screening score" max={100} value={score} />}
            <div className="mars-factors">
              {assessment.factors.map((factor) => (
                <details key={factor.key} className="mars-factor">
                  <summary>
                    <span>{FACTOR_LABELS[factor.key]}</span>
                    <strong>{factor.value === null ? 'Unavailable' : `${new Intl.NumberFormat('en', { maximumFractionDigits: factor.key === 'elevation' ? 0 : 1 }).format(factor.value)}${factor.unit === '°' || factor.unit === '%' ? '' : ' '}${factor.unit.trim()}`}</strong>
                  </summary>
                  <div className="mars-factor-detail">
                    <p>{factor.detail}</p>
                    {factor.score !== null && <p>Factor score <b>{factor.score}/100</b> · Weight <b>{weights[factor.key as WeightKey]}</b></p>}
                    {factor.source && <small>{factor.source}</small>}
                  </div>
                </details>
              ))}
            </div>
            <details className="mars-weights">
              <summary>Adjust factor weights</summary>
              <p className="mars-muted">The score is an average weighted across available factors. A weight of zero excludes a factor.</p>
              {(Object.keys(weights) as WeightKey[]).map((key) => (
                <label key={key}>
                  <span>{FACTOR_LABELS[key]}</span>
                  <input type="range" min={0} max={100} value={weights[key]} onChange={(e) => setWeights({ ...weights, [key]: +e.target.value })} />
                  <output>{weights[key]}</output>
                </label>
              ))}
              <button onClick={() => setWeights(DEFAULT_LANDING_WEIGHTS)}>Reset weights</button>
            </details>
          </section>}
          {(!full || tab === 'landing' || tab === 'hazards') && <section className="mars-report-section">
            <h3>Safety limits</h3>
            <p>{assessment.level === 'regional'
              ? 'Local terrain coverage is required to assess safe travel or landing at this point.'
              : 'This terrain assessment uses slope, roughness and mapped craters. Rocks, soil strength and current weather remain unverified.'}</p>
            {lowest && <p className="mars-muted">Main modeled concern: {FACTOR_LABELS[lowest.key].toLowerCase()} ({lowest.score}/100).</p>}
            {highest && highest.key !== lowest?.key && <p className="mars-muted">Strongest measured factor: {FACTOR_LABELS[highest.key].toLowerCase()} ({highest.score}/100).</p>}
          </section>}
          {(!full || tab === 'environment') && <section className="mars-report-section">
            <h3>Weather</h3>
            <p className="mars-muted">Current temperature, wind, pressure and dust conditions are unavailable at this point.</p>
            {isJezero(point) && (
              <details className="mars-weights">
                <summary>Historical observations from Jezero</summary>
                <p className="mars-muted">Perseverance MEDA · first 250 Martian days</p>
                <dl className="mars-weather">
                  <div><dt>Daily mean pressure</dt><dd>{JEZERO_WEATHER.pressure}</dd></div>
                  <div><dt>Wind</dt><dd>{JEZERO_WEATHER.wind}</dd></div>
                  <div><dt>Air temperature variation</dt><dd>{JEZERO_WEATHER.temperature}</dd></div>
                </dl>
                <a href={JEZERO_WEATHER.source} target="_blank" rel="noreferrer">MEDA observations study</a>
              </details>
            )}
          </section>}
          {(!full || tab === 'routes') && <section className="mars-report-section">
            <h3>Routes from this point</h3>
            <p className="mars-muted">A* compares routes to the same nearby waypoint using the selected mobility profile and mission settings.</p>
            {assessment.routeAvailable
              ? <button className="mars-action" disabled={routeBusy} onClick={onShowRoutes}>{routeBusy ? 'Calculating routes…' : paths?.waypoint ? 'Show routes on globe' : 'Calculate routes'}</button>
              : <p className="mars-unavailable">Traverse mapping is available within the Jezero CTX study area.</p>}
            {routeError && <p role="alert">{routeError}</p>}
            {paths?.reason && <p role="status">{paths.reason}</p>}
            {full && paths && Object.keys(paths.routes).length > 0 && <div className="comparison-scroll">
              <table className="mission-table">
                <thead><tr>{['Strategy', 'Distance', 'Travel time', 'Max slope', 'Hazard exposure', 'Min confidence', 'Trade-off'].map((label) => <th key={label}>{label}</th>)}</tr></thead>
                <tbody>{ROUTE_KEYS.map((key) => {
                  const metrics = paths.routes[key]?.metrics
                  if (!metrics) return null
                  return <tr key={key}><th>{ROUTE_STYLE[key].label}</th><td>{fmtDist(metrics.distance_m)}</td><td>{fmtDur(metrics.duration_s)}</td>
                    <td>{metrics.max_slope_deg}°</td><td>{metrics.hazard_exposure}</td><td>{metrics.min_confidence}</td>
                    <td>{ROUTE_OBJECTIVE[key]} {metrics.energy_feasible ? 'Reserve met.' : 'Reserve would be breached.'}</td></tr>
                })}</tbody>
              </table>
            </div>}
            {paths && Object.keys(paths.routes).length > 0 && (
              <div className="mars-route-tabs" role="group" aria-label="Route strategy">
                {ROUTE_KEYS.map((key) => (
                  <button key={key} disabled={!paths.routes[key]} aria-pressed={activeRoute === key} onClick={() => onSelectRoute(key)}>
                    <i style={{ background: GLOBE_COLORS[key] }} />{ROUTE_STYLE[key].label}
                  </button>
                ))}
              </div>
            )}
            {selectedRoute && (
              <>
                <p>{ROUTE_OBJECTIVE[activeRoute]}</p>
                {activeRoute === 'optimal' && <p className="mars-muted">Science sites are uncharted in this planning area.</p>}
                <dl className="mars-route-metrics">
                  <div><dt>Distance</dt><dd>{fmtDist(selectedRoute.metrics.distance_m)}</dd></div>
                  <div><dt>Model risk</dt><dd>{selectedRoute.metrics.risk_score.toFixed(0)} / 100</dd></div>
                  <div><dt>Max slope</dt><dd>{selectedRoute.metrics.max_slope_deg.toFixed(1)}°</dd></div>
                  <div><dt>Travel time</dt><dd>{fmtDur(selectedRoute.metrics.duration_s)}</dd></div>
                  <div><dt>Energy</dt><dd>{selectedRoute.metrics.energy_wh.toFixed(0)} Wh</dd></div>
                  <div><dt>Energy reserve</dt><dd>{selectedRoute.metrics.energy_margin_wh.toFixed(0)} Wh</dd></div>
                </dl>
                {activeRoute !== 'shortest' && shortest && <p className="mars-muted">Compared with Shortest: {distanceChange >= 0 ? '+' : '−'}{fmtDist(Math.abs(distanceChange))} distance · {riskChange >= 0 ? '+' : '−'}{Math.abs(riskChange).toFixed(1)} risk points.</p>}
                <p className={selectedRoute.metrics.energy_feasible ? 'mars-muted' : 'mars-unavailable'}>
                  {selectedRoute.metrics.energy_feasible ? 'Fits the modeled energy budget and reserve.' : 'Outside the modeled energy budget. The mission reserve would be breached.'}
                </p>
              </>
            )}
          </section>}
        </>
      )}
    </aside>
  )
}
