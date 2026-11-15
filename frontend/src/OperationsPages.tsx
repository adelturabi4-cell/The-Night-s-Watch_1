import { useState } from 'react'
import Icon from './Icon'
import { coordinatesLabel, DEFAULT_LANDING_WEIGHTS, scoreAssessment } from './mars'
import type { Coordinates } from './mars'
import type { Candidate } from './science'
import { SCIENCE_DATA, siteTitle } from './science'
import { DEFAULT_PREFERENCES, downloadReport } from './missionState'
import type { Preferences, RouteReport } from './missionState'
import { fmtDist, fmtDur } from './render'
import { ROUTE_KEYS, ROUTE_STYLE } from './types'

export function Reports({ candidates, reports, onSelect, onRemove }: {
  candidates: Candidate[]
  reports: RouteReport[]
  onSelect: (point: Coordinates) => void
  onRemove: (id: string) => void
}) {
  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const filteredSites = candidates.filter((candidate) => (siteTitle(candidate.point) + ' ' + coordinatesLabel(candidate.point)).toLowerCase().includes(query.toLowerCase()))
  const filteredRoutes = reports.filter((report) => (report.terrain.name + ' ' + report.profile.label + ' ' + ROUTE_STYLE[report.selected].label).toLowerCase().includes(query.toLowerCase()))
  const exportAll = () => downloadReport('martian-map-mission-archive.json', { exportedAt: new Date().toISOString(), basis: 'Educational mission planning. Terrain scores and route metrics are model estimates, not certified safety or live telemetry.', candidates, routeReports: reports, sources: SCIENCE_DATA })
  const visibleSites = tab !== 'routes' ? filteredSites : []
  const visibleRoutes = tab !== 'sites' ? filteredRoutes : []

  return <section className="mission-content">
    <div className="page-heading"><div><h1>Reports</h1><p className="page-description">Your saved site intelligence, route comparisons and simulation records.</p></div><button className="primary button-with-icon" disabled={!candidates.length && !reports.length} onClick={exportAll}><Icon name="download" size={16} />Export archive</button></div>
    <div className="archive-summary"><div><Icon name="location" /><strong>{candidates.length}</strong><span>Site analyses</span></div><div><Icon name="route" /><strong>{reports.length}</strong><span>Route & simulation reports</span></div><div><Icon name="shield" /><span>Stored in this browser<small>Export JSON to keep a portable copy.</small></span></div></div>
    <div className="registry-toolbar"><div className="mission-tabs">{[['all', 'All reports'], ['sites', 'Site analyses'], ['routes', 'Routes & simulations']].map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div><label className="registry-search"><Icon name="search" size={16} /><input aria-label="Search saved reports" placeholder="Search reports…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    {!visibleSites.length && !visibleRoutes.length && <div className="workspace-empty"><span className="empty-symbol"><Icon name="reports" size={30} /></span><h2>{query ? 'No matching reports' : 'Build your mission archive'}</h2><p>{query ? 'Try a site name, terrain name or mobility profile.' : 'Save a candidate from Location Analysis, or save a route and simulation report from the planner.'}</p><a className="button-link primary-link" href="#location">Open location analysis<Icon name="arrow" size={16} /></a></div>}
    <div className="report-grid">{visibleSites.map((candidate) => {
      const score = scoreAssessment(candidate.assessment.factors, DEFAULT_LANDING_WEIGHTS)
      return <article className="archive-card" key={coordinatesLabel(candidate.point)}><div className="archive-card-top"><span className="tag">SITE ANALYSIS</span><Icon name="location" /></div><h2>{siteTitle(candidate.point)}</h2><p className="site-coordinate">{coordinatesLabel(candidate.point)}</p><div className="archive-card-metrics"><span>Terrain score<strong>{score ?? '—'}<small> / 100</small></strong></span><span>Coverage<strong>{candidate.assessment.level === 'local' ? 'Local CTX' : 'Regional MOLA'}</strong></span></div><p className="archive-date">Saved {new Date(candidate.savedAt).toLocaleString('en-GB')}</p><div className="archive-actions"><button onClick={() => onSelect(candidate.point)}>Open analysis<Icon name="arrow" size={15} /></button><button aria-label={'Export ' + siteTitle(candidate.point) + ' analysis'} onClick={() => downloadReport('martian-map-site-analysis.json', { ...candidate, basis: 'Preliminary terrain screening; no safety guarantee.', sources: SCIENCE_DATA })}><Icon name="download" size={16} />JSON</button></div></article>
    })}{visibleRoutes.map((report) => <article className="archive-card" key={report.id}><div className="archive-card-top"><span className="tag">{report.events.some((event) => event.clock !== '--:--') ? 'TRAVERSE SIMULATION' : 'ROUTE COMPARISON'}</span><Icon name="route" /></div><h2>{report.terrain.name}</h2><p className="page-description">{report.profile.label} · {ROUTE_STYLE[report.selected].label} strategy</p><p className="evidence-label">{report.terrain.simulated ? 'SIMULATED TERRAIN' : 'DERIVED FROM ELEVATION'}</p>{report.simulation && <SimulationSnapshot summary={report.simulation} />}<details className="report-details"><summary>Route metrics & mission events</summary><p>Start [{report.start.join(', ')}] → Destination [{report.goal.join(', ')}]</p><div className="comparison-scroll"><table className="mission-table"><thead><tr><th>Route</th><th>Distance</th><th>Time</th><th>Risk index</th><th>Energy</th></tr></thead><tbody>{ROUTE_KEYS.map((key) => { const metrics = report.routes[key]; return metrics ? <tr key={key}><th>{ROUTE_STYLE[key].label}</th><td>{fmtDist(metrics.distance_m)}</td><td>{fmtDur(metrics.duration_s)}</td><td>{metrics.risk_score.toFixed(1)}</td><td>{metrics.energy_wh.toFixed(0)} Wh</td></tr> : null })}</tbody></table></div><ol className="report-events">{report.events.map((event, index) => <li key={index}><time>{event.clock}</time> {event.text}</li>)}</ol></details><p className="archive-date">Saved {new Date(report.savedAt).toLocaleString('en-GB')}</p><div className="archive-actions"><button onClick={() => downloadReport('martian-map-route-report.json', { ...report, basis: 'Model estimates and simulated events, not mission telemetry.' })}><Icon name="download" size={16} />Export JSON</button><button className="text-button" onClick={() => onRemove(report.id)}>Remove report</button></div></article>)}</div>
  </section>
}

function SimulationSnapshot({ summary }: { summary: NonNullable<RouteReport['simulation']> }) {
  return <div className="simulation-snapshot"><p className="page-kicker">SIMULATION SNAPSHOT · {summary.status}</p><dl>
    <div><dt>Covered</dt><dd>{fmtDist(summary.covered_m)}</dd></div>
    <div><dt>Mission time</dt><dd>{fmtDur(summary.mission_time_s)}</dd></div>
    <div><dt>Energy used</dt><dd>{summary.energy_used_wh.toFixed(0)} Wh</dd></div>
    <div><dt>Reported obstacles</dt><dd>{summary.reported_obstacles}</dd></div>
  </dl><p>Route metrics below describe the current plan from its saved start. Mission totals include the earlier traverse.</p></div>
}

export function Settings({ preferences, onChange, candidateCount, reportCount, health }: {
  preferences: Preferences
  onChange: (next: Preferences) => void
  candidateCount: number
  reportCount: number
  health: 'checking' | 'online' | 'offline'
}) {
  return <section className="mission-content settings-page"><div className="page-heading"><div><h1>Settings</h1><p className="page-description">Personalize this browser’s exploration workspace.</p></div><span className="tag">BROWSER LOCAL</span></div>
    <div className="settings-layout"><div>
      <section className="settings-card"><div><Icon name="settings" /><h2>Workspace profile</h2><p>A display identity for this browser. Account authentication is not configured.</p></div><label className="settings-field">Display name<input value={preferences.name} maxLength={40} placeholder="Mission specialist" onChange={(event) => onChange({ ...preferences, name: event.target.value })} /><small>Changes are saved automatically when browser storage is available.</small></label></section>
      <section className="settings-card"><div><Icon name="sun" /><h2>Display & accessibility</h2><p>Adjust the interface to suit your working environment.</p></div><label className="toggle-setting"><span><b>Compact information density</b><small>Reduce spacing in panels and navigation.</small></span><input type="checkbox" role="switch" checked={preferences.compact} onChange={(event) => onChange({ ...preferences, compact: event.target.checked })} /></label><label className="toggle-setting"><span><b>Reduce interface motion</b><small>Disable transitions and shorten globe camera movements. Your operating system preference also applies.</small></span><input type="checkbox" role="switch" checked={preferences.reducedMotion} onChange={(event) => onChange({ ...preferences, reducedMotion: event.target.checked })} /></label><button onClick={() => onChange({ ...preferences, compact: DEFAULT_PREFERENCES.compact, reducedMotion: DEFAULT_PREFERENCES.reducedMotion })}>Restore display defaults</button></section>
    </div><aside><section className="settings-card"><div><Icon name="activity" /><h2>System & integrations</h2></div><dl className="site-brief"><div><dt>Planning API</dt><dd>{health === 'online' ? 'Connected' : health === 'offline' ? 'Unavailable' : 'Checking…'}</dd></div><div><dt>Saved site analyses</dt><dd>{candidateCount}</dd></div><div><dt>Route reports</dt><dd>{reportCount} / 50</dd></div><div><dt>Storage</dt><dd>This browser</dd></div><div><dt>Live Mars weather</dt><dd>Not connected</dd></div><div><dt>AI model</dt><dd>Server configuration</dd></div></dl><p className="note">The AI advisor uses the existing server-side provider configuration. It reports an unavailable model when no provider is configured.</p><a className="button-link" href="#reports">Manage saved reports<Icon name="arrow" size={15} /></a></section><section className="settings-note"><Icon name="shield" /><h3>Scientific integrity</h3><p>Orbital data, historical observations and derived models have different coverage. Scores are educational screening tools; operational validation is required.</p><a href="#data">Explore the data registry ↗</a></section></aside></div>
  </section>
}
