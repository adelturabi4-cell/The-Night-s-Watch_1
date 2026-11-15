import { useEffect, useRef, useState } from 'react'
import { coordinatesLabel, DEFAULT_LANDING_WEIGHTS, scoreAssessment } from './mars'
import type { Coordinates } from './mars'
import { SCIENCE_DATA, siteTitle, survivalEvidence } from './science'
import type { Candidate } from './science'
import Icon from './Icon'

export function SurvivalCenter({ point }: { point: Coordinates | null }) {
  return <section className="mission-content">
    <div className="page-heading"><div><h1>Survival Center</h1>
    <p className="page-description">{point ? `${siteTitle(point)} · ${coordinatesLabel(point)}` : 'Planetary reference. Select a site to see applicable regional evidence.'}</p></div><span className="tag">SCIENTIFIC CONTEXT</span></div>
    <SurvivalEvidence point={point} />
  </section>
}

export function SurvivalEvidence({ point, topics }: { point: Coordinates | null; topics?: string[] }) {
  return <div className="mission-cards evidence-cards">{survivalEvidence(point).filter(({ topic }) => !topics || topics.includes(topic)).map(({ topic, status, detail, url }) =>
    <article key={topic}><span className="evidence-icon"><Icon name={topic === 'Temperature' || topic === 'Energy' ? 'sun' : topic === 'Communication' ? 'activity' : 'shield'} size={22} /></span><h3>{topic}</h3><p className="evidence-label">{status}</p><p>{detail}</p><a href={url} target="_blank" rel="noreferrer">Scientific source <Icon name="external" size={14} /></a></article>
  )}</div>
}

export function DataCenter() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const datasets = SCIENCE_DATA.map((dataset, index) => ({ ...dataset, status: index >= 9 ? 'Bundled' : index === 8 ? 'Not integrated' : index === 1 || index === 4 ? 'Remote layer' : index >= 6 ? 'Reference only' : 'Bundled', category: index >= 9 ? 'bundled' : index === 8 ? 'external' : index === 1 || index === 4 ? 'remote' : index >= 6 ? 'reference' : 'bundled' }))
  const filtered = datasets.filter((dataset) => (filter === 'all' || dataset.category === filter) && `${dataset.name} ${dataset.type} ${dataset.scope}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="mission-content">
    <div className="page-heading"><div><h1>Scientific Data Center</h1><p className="page-description">Every dataset the app uses, with its coverage, resolution and limits.</p></div><a className="button-link" href="#explore"><Icon name="globe" size={16} />Open map layers<Icon name="arrow" size={15} /></a></div>
    <div className="data-summary"><div><Icon name="data" /><strong>{SCIENCE_DATA.length}</strong><span>Documented sources</span></div><div><Icon name="globe" /><strong>Global + local</strong><span>Orbital & rover observations</span></div><div><Icon name="shield" /><strong>Traceable evidence</strong><span>Measurements and models labeled</span></div></div>
    <div className="registry-toolbar"><div className="mission-tabs">{[['all', 'All sources'], ['bundled', 'Bundled'], ['remote', 'Remote layers'], ['reference', 'Reference'], ['external', 'Not integrated']].map(([id, label]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div><label className="registry-search"><Icon name="search" size={16} /><input aria-label="Search scientific datasets" placeholder="Search datasets…" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
    <div className="comparison-scroll dataset-registry"><table className="mission-table"><thead><tr><th>Dataset / Source</th><th>Category</th><th>Coverage / Resolution</th><th>Status</th><th>Product revision</th><th>Source</th></tr></thead><tbody>{filtered.map(({ name, type, scope, revision, method, url, status }) => <tr key={name}><th><b>{name}</b><details><summary>Method & limitations</summary><p>{method}</p></details></th><td>{type}</td><td>{scope}</td><td><span className={'dataset-status ' + (status === 'Not integrated' ? 'unavailable' : '')}><i />{status}</span></td><td>{revision}</td><td><a aria-label={'Open source for ' + name} href={url} target="_blank" rel="noreferrer"><Icon name="external" size={17} /></a></td></tr>)}</tbody></table>{!filtered.length && <p className="workspace-empty">No datasets match this search and filter.</p>}</div>
    <p className="note registry-note">Revisions describe the source products. Last synchronization dates are not tracked. Remote-layer availability depends on the source service.</p>
    <div className="section-heading"><h2>How the data becomes intelligence</h2><span>DATA PROVENANCE</span></div><div className="provenance-grid">{[
      { icon: 'data', title: 'Instrument observations', label: 'MEASURED / ARCHIVED', detail: 'MOLA laser altimetry and historical MEDA observations. Each has its own spatial and temporal coverage.' },
      { icon: 'terrain', title: 'Derived terrain & routes', label: 'COMPUTED ESTIMATES', detail: 'Stereo elevation, slope, roughness, crater geometry, weighted suitability and A* route metrics are derived products.' },
      { icon: 'simulator', title: 'Surface simulations', label: 'REAL TERRAIN / SIMULATED TRAVERSE', detail: 'The local planner defaults to real Jezero CTX elevation. Mobility events and traverse progress remain simulations.' },
      { icon: 'advisor', title: 'AI mission reasoning', label: 'AI-GENERATED', detail: 'Optional model explanations use selected-site evidence. They are not new observations or validated predictions.' },
    ].map((item) => <article key={item.title}><Icon name={item.icon} size={23} /><p className="page-kicker">{item.label}</p><h3>{item.title}</h3><p>{item.detail}</p></article>)}</div>
  </section>
}

export function MissionComparison({ candidates, onRemove, onSelect }: {
  candidates: Candidate[]
  onRemove: (candidate: Candidate) => void
  onSelect: (point: Coordinates) => void
}) {
  const [ordering, setOrdering] = useState('landing')
  const [advice, setAdvice] = useState<{ answer: string; sources: { id: string; url: string }[]; mode?: string } | null>(null)
  const [adviceError, setAdviceError] = useState('')
  const [adviceBusy, setAdviceBusy] = useState(false)
  const adviceRequest = useRef<AbortController | null>(null)
  useEffect(() => {
    return () => adviceRequest.current?.abort()
  }, [])
  const ranked = candidates.map((candidate) => ({
    ...candidate, score: scoreAssessment(candidate.assessment.factors, DEFAULT_LANDING_WEIGHTS),
  }))
  if (ordering === 'landing') ranked.sort((a, b) => (b.assessment.level === 'local' ? b.score ?? -1 : -1) - (a.assessment.level === 'local' ? a.score ?? -1 : -1))
  else ranked.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  const top = ranked.find((c) => c.assessment.level === 'local' && c.score !== null)
  const value = (candidate: Candidate, key: string) => {
    const factor = candidate.assessment.factors.find((f) => f.key === key)
    return factor?.value == null ? 'Unavailable' : `${factor.value} ${factor.unit}`
  }
  const exportReport = () => {
    const report = {
      basis: 'Educational comparison. Only local-resolution assessments receive a landing rank. Scores use standard weights.',
      weights: DEFAULT_LANDING_WEIGHTS,
      candidates: ranked.map((c) => ({ ...c, site: siteTitle(c.point), survival: survivalEvidence(c.point) })),
      sources: SCIENCE_DATA,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'martian-map-mission-report.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const askMissionAdvisor = async () => {
    adviceRequest.current?.abort()
    const controller = new AbortController()
    adviceRequest.current = controller
    setAdviceBusy(true)
    setAdvice(null)
    setAdviceError('')
    try {
      const response = await fetch('/api/guide/mission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates: candidates.map(({ point }) => point) }),
        signal: controller.signal,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Mission advisor unavailable.')
      if (!controller.signal.aborted) setAdvice(data)
    } catch (error) {
      if (!controller.signal.aborted) setAdviceError(error instanceof Error ? error.message : 'Mission advisor unavailable.')
    } finally {
      if (!controller.signal.aborted) setAdviceBusy(false)
    }
  }
  const removeCandidate = (candidate: Candidate) => {
    adviceRequest.current?.abort()
    setAdvice(null)
    setAdviceError('')
    setAdviceBusy(false)
    onRemove(candidate)
  }
  return <section className="mission-content">
    <div className="page-heading"><div><h1>Site Comparison</h1><p className="page-description">Saved candidate sites side by side, ranked by local terrain score or date.</p></div><span className="tag">{candidates.length} SAVED SITES</span></div>
    {ranked.length === 0 ? <div className="workspace-empty"><span className="empty-symbol"><Icon name="comparison" size={30} /></span><h2>Start a landing site shortlist</h2><p>Select a location in Mars Explorer and save its analysis as a candidate.</p><a className="button-link primary-link" href="#explore">Explore Mars<Icon name="arrow" size={16} /></a></div> : <>
      <div className="mission-toolbar">
        <label>Rank by <select value={ordering} onChange={(e) => setOrdering(e.target.value)}><option value="landing">Local landing score</option><option value="recent">Recently saved</option></select></label>
        <button className="primary" onClick={exportReport}>Export report</button>
        <button onClick={askMissionAdvisor} disabled={adviceBusy || candidates.length < 2 || candidates.length > 8}>
          {adviceBusy ? 'Ranking candidates…' : 'Rank saved sites'}
        </button>
      </div>
      <p className="page-description">The AI compares up to 8 saved sites using available terrain safety and science-evidence coverage. Scientific evidence coverage is a proxy, not a measure of discovery potential.</p>
      {candidates.length === 1 && <p className="mission-notice" role="status">Save at least one more site to compare candidates with the AI advisor.</p>}
      {candidates.length > 8 && <p className="mission-notice" role="status">The AI advisor supports up to 8 sites per comparison. Remove candidates to continue.</p>}
      {adviceError && <p className="mission-notice" role="alert">{adviceError}</p>}
      {advice && <section className="mission-advice" aria-live="polite">
        <h2>{advice.mode === 'model' ? 'AI mission recommendation' : 'Ranking from site evidence'}</h2>
        <p className="page-description">Candidate numbers in the answer follow this list:</p>
        <ol>{candidates.map((candidate, index) => <li key={`${index}-${coordinatesLabel(candidate.point)}`}>{index + 1}. {siteTitle(candidate.point)} · {coordinatesLabel(candidate.point)}</li>)}</ol>
        <p dir={/[؀-ۿ]/.test(advice.answer) ? 'rtl' : 'ltr'}>{advice.answer}</p>
        {advice.sources.map(({ id, url }) => <a key={id} href={url} target="_blank" rel="noreferrer">{id} ↗</a>)}
      </section>}
      <p className="page-description">{top ? `${siteTitle(top.point)} has the highest available local terrain score (${top.score}/100). Verify environmental and site data before prioritizing it.` : 'Local coverage is required for a landing ranking.'}</p>
      <div className="candidate-grid">{ranked.map((candidate) => <article key={coordinatesLabel(candidate.point)}><div className="archive-card-top"><Icon name="location" size={20} /><span className="tag">{candidate.assessment.level === 'local' ? 'LOCAL CTX' : 'REGIONAL MOLA'}</span></div><h2>{siteTitle(candidate.point)}</h2><p className="site-coordinate">{coordinatesLabel(candidate.point)}</p><div className="candidate-score"><strong>{candidate.assessment.level === 'local' ? candidate.score ?? '—' : '—'}</strong><span>{candidate.assessment.level === 'local' ? 'Terrain score / 100' : 'Local ranking unavailable'}</span></div><div className="candidate-factors">{candidate.assessment.factors.filter((factor) => factor.score !== null).map((factor) => <div key={factor.key}><span>{factor.key}<b>{factor.score}/100</b></span><progress aria-label={`${factor.key} factor score`} max={100} value={factor.score ?? 0} /></div>)}</div><button onClick={() => onSelect(candidate.point)}>Inspect site<Icon name="arrow" size={15} /></button></article>)}</div>
      <div className="comparison-scroll"><table className="mission-table">
        <thead><tr>{['Site', 'Landing score', 'Slope', 'Roughness', 'Access', 'Water evidence', 'Energy', 'Communications', 'Scientific context', ''].map((label) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{ranked.map((c) => <tr key={coordinatesLabel(c.point)}>
          <th><button onClick={() => onSelect(c.point)}>{siteTitle(c.point)}</button><br />{coordinatesLabel(c.point)}</th>
          <td>{c.assessment.level === 'local' && c.score !== null ? `${c.score}/100` : 'Regional only'}</td>
          <td>{value(c, 'slope')}</td><td>{value(c, 'roughness')}</td><td>{value(c, 'access')}</td>
          <td>{siteTitle(c.point) === 'Jezero crater' ? 'Ancient water evidence' : 'Unverified'}</td><td>Yield unavailable</td><td>Geometry unavailable</td>
          <td>{siteTitle(c.point)}</td><td><button onClick={() => removeCandidate(c)}>Remove</button></td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>
}
