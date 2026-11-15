import { useEffect, useRef, useState } from 'react'

type Point = [number, number]
interface Match {
  reference: number[][]
  observation: number[][]
  coarse: Point
  fine: Point
  truth: Point
  templateSize: number
  cellSize: number
  confidence: number
  peakGap: number
  errorM: number
  landmarks: Point[]
  landingCandidate: Point | null
  hazards: number[][]
}

function Raster({ values, match, hazards, stage }: { values: number[][]; match?: Match; hazards?: boolean; stage?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const pixels = ctx.createImageData(values[0].length, values.length)
    values.forEach((row, r) => row.forEach((value, c) => {
      const index = 4 * (r * row.length + c)
      const warn = hazards && match?.hazards[r]?.[c]
      pixels.data.set(warn ? [Math.min(255, value + 60), value * 0.55, value * 0.43, 255] : [value, value * 0.86, value * 0.67, 255], index)
    }))
    ctx.putImageData(pixels, 0, 0)
    if (!match) return
    const half = match.templateSize / 4
    const marker = stage === 'coarse' ? match.coarse : match.fine
    const x = marker[0] / 2
    const y = marker[1] / 2
    ctx.strokeStyle = '#F0D66C'
    ctx.strokeRect(x - half, y - half, 2 * half, 2 * half)
    ctx.fillStyle = '#E9E6DC'
    ctx.fillRect(match.truth[0] / 2 - 1, match.truth[1] / 2 - 1, 2, 2)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(match.truth[0] / 2, match.truth[1] / 2)
    ctx.stroke()
    if (hazards) {
      ctx.fillStyle = '#F0D66C'
      match.landmarks.forEach(([a, b]) => ctx.fillRect(a / 2 - 1, b / 2 - 1, 2, 2))
      if (match.landingCandidate) {
        ctx.beginPath()
        ctx.arc(match.landingCandidate[0] / 2, match.landingCandidate[1] / 2, 3, 0, 2 * Math.PI)
        ctx.stroke()
      }
    }
  }, [values, match, hazards, stage])
  return <canvas ref={canvas} width={values[0].length} height={values.length} role="img" aria-label={match ? 'Jezero reference raster with matching and hazard marks' : 'Simulated camera crop'} />
}

export default function NavigationLab() {
  const [mode, setMode] = useState('trn')
  const [stage, setStage] = useState('fine')
  const [noise, setNoise] = useState(20)
  const [scene, setScene] = useState(0)
  const [result, setResult] = useState<Match | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const scenarios = [[146, 130], [97, 177], [192, 77]]
  useEffect(() => {
    const controller = new AbortController()
    const [x, y] = [[146, 130], [97, 177], [192, 77]][scene]
    const timer = window.setTimeout(() => {
      fetch(`/api/navigation/demo?mode=${mode}&noise=${noise}&x=${x}&y=${y}`, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error('unavailable')
          return response.json() as Promise<Match>
        })
        .then((data) => { if (!controller.signal.aborted) setResult(data) })
        .catch(() => { if (!controller.signal.aborted) setError(true) })
        .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [mode, noise, scene, retry])
  const change = (action: () => void) => { setBusy(true); setError(false); action() }

  return <section className="mission-content">
    <div className="page-heading"><div><h1>Navigation Technology</h1>
    <p className="page-description">Match a simulated camera crop to Jezero CTX terrain. This exercise models translation on a fixed-elevation reference grid.</p></div><span className="tag">SIMULATION</span></div>
    <div className="mission-toolbar">
      <div role="group" aria-label="Navigation mode">
        <button className={mode === 'trn' ? 'on' : ''} aria-pressed={mode === 'trn'} onClick={() => { if (mode !== 'trn') change(() => setMode('trn')) }}>Terrain-relative navigation</button>
        <button className={mode === 'lvs' ? 'on' : ''} aria-pressed={mode === 'lvs'} onClick={() => { if (mode !== 'lvs') change(() => setMode('lvs')) }}>Lander vision system</button>
      </div>
      <label>Observation <select value={scene} onChange={(e) => change(() => setScene(+e.target.value))}>{scenarios.map((_, index) => <option key={index} value={index}>Jezero sample {index + 1}</option>)}</select></label>
      <label>Noise <input type="range" min="0" max="90" value={noise} onChange={(e) => change(() => setNoise(+e.target.value))} /> {noise}%</label>
    </div>
    {busy && <p role="status">Matching terrain…</p>}
    {error && <p role="alert">The matching service is unavailable. <button onClick={() => change(() => setRetry((n) => n + 1))}>Retry</button></p>}
    {!busy && !error && result && <>
      <div className="mission-toolbar">
        <button aria-pressed={stage === 'coarse'} className={stage === 'coarse' ? 'on' : ''} onClick={() => setStage('coarse')}>Coarse match · 8-cell stride</button>
        <button aria-pressed={stage === 'fine'} className={stage === 'fine' ? 'on' : ''} onClick={() => setStage('fine')}>Fine match · 1-cell stride</button>
      </div>
      <div className="nav-frames">
        <figure><Raster values={result.reference} match={result} stage={stage} hazards={mode === 'lvs'} /><figcaption>Jezero CTX hillshade · yellow outline = estimate · white point = simulated truth</figcaption></figure>
        <figure><Raster values={result.observation} /><figcaption>Simulated descent image · clipped and perturbed reference</figcaption></figure>
      </div>
      <dl className="nav-results">
        <div><dt>Estimated pixel position</dt><dd>{(stage === 'coarse' ? result.coarse : result.fine).join(', ')}</dd></div>
        <div><dt>Fine-match correlation</dt><dd>{result.confidence.toFixed(3)}</dd></div>
        <div><dt>Gap to competing match</dt><dd>{result.peakGap.toFixed(3)}</dd></div>
        <div><dt>Position error</dt><dd>{stage === 'fine' ? result.errorM : Math.round(Math.hypot(result.coarse[0] - result.truth[0], result.coarse[1] - result.truth[1]) * result.cellSize)} m</dd></div>
      </dl>
      {mode === 'lvs' && <p>{result.landmarks.length} slope-gradient landmarks in the matched patch. Orange cells exceed 8°. {result.landingCandidate ? `Yellow circle: nearby area meeting the 8° slope screen at grid pixel ${result.landingCandidate.join(', ')}.` : 'No candidate meets the local slope screen.'}</p>}
    </>}
    <p className="note">Correlation measures image similarity. Flight confidence also requires altitude, attitude, camera calibration and independent observations. <a href="https://robotics.jpl.nasa.gov/what-we-do/applications/landing/" target="_blank" rel="noreferrer">JPL navigation background ↗</a></p>
  </section>
}
