import { useEffect, useRef, useState } from 'react'
import type { Assessment, Coordinates, SurfaceRoutes } from './mars'
import { coordinatesLabel, FACTOR_LABELS } from './mars'
import { fmtDist } from './render'
import { SCIENCE_DATA, siteTitle, survivalEvidence } from './science'
import Icon from './Icon'

const QUESTIONS = ['Landing suitability', 'Geological risks', 'Water and settlement', 'Preferred surface route'] as const
type Topic = typeof QUESTIONS[number]
interface Citation { id: string; url: string }

export default function SiteGuide({ point, assessment, score, paths }: { point: Coordinates; assessment: Assessment; score: number | null; paths: SurfaceRoutes | null }) {
  const [topic, setTopic] = useState<Topic>('Landing suitability')
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<{ question: string; answer: string; sources: Citation[]; mode?: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  const hazard = assessment.hazard
  const safest = paths?.routes.safest?.metrics
  const factors = assessment.factors.filter((factor) => factor.score !== null).sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
  const weakest = factors[0]
  const water = survivalEvidence(point)[0]
  const responses: Record<Topic, { text: string; source: { name: string; url: string } }> = {
    'Landing suitability': {
      text: assessment.level === 'local'
        ? `The preliminary terrain score is ${score ?? 'unavailable'}${score === null ? '' : '/100'}. ${weakest ? `The lowest measured factor is ${FACTOR_LABELS[weakest.key].toLowerCase()} (${weakest.score}/100). ` : ''}Rock abundance and soil stability remain unverified.`
        : 'Regional MOLA cells are too coarse for a landing decision. A local terrain model and obstacle survey are required.',
      source: SCIENCE_DATA[assessment.level === 'local' ? 3 : 9],
    },
    'Geological risks': {
      text: hazard ? `The nearest catalogued large crater rim is about ${hazard.rimDistanceKm} km away. This is a circular rim estimate based on a mapped diameter. Boulder, rock-field and dune coverage remains unverified.`
        : 'The crater catalog did not return a distance. Boulder, rock-field and dune coverage remains unverified.',
      source: SCIENCE_DATA[5],
    },
    'Water and settlement': { text: water.detail + ' A settlement study also needs local power, shielding and communication models.', source: { name: 'Water evidence', url: water.url } },
    'Preferred surface route': {
      text: safest ? `The lower-exposure strategy covers ${fmtDist(safest.distance_m)} with a modeled risk index of ${safest.risk_score}/100. ${safest.energy_feasible ? 'It meets the selected energy reserve.' : 'It would breach the selected energy reserve.'}`
        : 'A route comparison requires a matching local elevation grid and reachable waypoint.',
      source: SCIENCE_DATA[3],
    },
  }

  function ask() {
    if (question.trim().length < 3 || busy) return
    const prompt = question.trim()
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setError('')
    fetch('/api/guide', {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...point, question: prompt }),
    }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Scientific guide unavailable.')
      if (!controller.signal.aborted) { setMessages((previous) => [...previous, { question: prompt, answer: data.answer, sources: data.sources, mode: data.mode }]); setQuestion('') }
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setBusy(false) })
  }
  return <div className="site-guide advisor-layout">
    <section className="advisor-conversation"><div className="advisor-header"><span className="advisor-symbol"><Icon name="advisor" size={25} /></span><div><h3>Mission advisor</h3><p>Selected-site reasoning · Scientific sources</p></div><span className="tag">AI SUPPORT</span></div>
      <div className="conversation-transcript" aria-live="polite" aria-label="Mission advisor conversation">
        {!messages.length && <div className="advisor-welcome"><Icon name="globe" size={36} /><h3>What will you explore next?</h3><p>Ask about {siteTitle(point)}, evaluate a terrain concern, or examine a surface route. Answers come from this site's evidence (terrain, geology, rover data, routes) and say what is not measured. English or Arabic.</p><div className="suggested-questions">{['What limits landing suitability here?', 'Explain the main terrain risks.', 'Which surface route should I investigate?'].map((suggestion) => <button key={suggestion} onClick={() => setQuestion(suggestion)}>{suggestion}<Icon name="arrow" size={14} /></button>)}</div></div>}
        {messages.map((message, index) => <div className="conversation-exchange" key={index}><div className="chat-question"><span>YOU</span><p>{message.question}</p></div><div className="chat-answer"><span><Icon name="advisor" size={16} />{message.mode === 'model' ? 'AI-generated analysis' : 'Answer from site evidence · no AI model'}</span><p dir={/[؀-ۿ]/.test(message.answer) ? 'rtl' : 'ltr'}>{message.answer}</p><div className="chat-sources">{message.sources.map(({ id, url }) => <a key={id} href={url} target="_blank" rel="noreferrer">{id}<Icon name="external" size={12} /></a>)}</div></div></div>)}
        {busy && <p className="advisor-thinking" role="status"><Icon name="activity" size={17} />Reviewing selected-site evidence…</p>}
        {error && <div role="alert" className="inline-error"><b>AI response unavailable</b><p>{error}</p><p>The evidence brief remains available alongside this conversation.</p></div>}
      </div>
      <form className="guide-question" onSubmit={(e) => { e.preventDefault(); ask() }}>
        <label><span>Ask about this site</span><textarea aria-label="Question for the AI mission advisor" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={480} required minLength={3} placeholder="Ask a mission question about the selected site…" /></label>
        <div><small>{question.length}/480 · Answers use selected-site evidence.</small><button className="primary button-with-icon" disabled={busy || question.trim().length < 3}>{busy ? 'Analyzing…' : 'Send question'}<Icon name="arrow" size={16} /></button></div>
      </form><p className="advisor-disclaimer">AI explanations may contain errors. Verify sources before making mission decisions.</p>
    </section>
    <aside className="advisor-evidence"><p className="page-kicker">MISSION CONTEXT</p><h3>{siteTitle(point)}</h3><p className="site-coordinate">{coordinatesLabel(point)}</p><dl className="site-brief"><div><dt>Terrain coverage</dt><dd>{assessment.level === 'local' ? 'CTX · 20 m' : 'MOLA · regional'}</dd></div><div><dt>Route evidence</dt><dd>{paths ? 'Available' : 'Not available'}</dd></div><div><dt>Weather</dt><dd>Historical / unavailable</dd></div></dl>
      <div className="evidence-brief"><p className="page-kicker">LOCAL EVIDENCE BRIEF</p><p className="note">Computed from the selected report. No AI model required.</p><div className="mission-tabs" aria-label="Evidence topics">{QUESTIONS.map((label) => <button key={label} aria-pressed={topic === label} onClick={() => setTopic(label)}>{label}</button>)}</div><p>{responses[topic].text}</p><a href={responses[topic].source.url} target="_blank" rel="noreferrer">{responses[topic].source.name} <Icon name="external" size={13} /></a></div>
      <div className="advisor-next"><p className="page-kicker">SUGGESTED NEXT ACTIONS</p><a href="#landing">Inspect landing factors<Icon name="arrow" size={14} /></a><a href="#planner">Compare route strategies<Icon name="arrow" size={14} /></a><a href="#comparison">Evaluate saved candidates<Icon name="arrow" size={14} /></a></div>
    </aside>
  </div>
}
