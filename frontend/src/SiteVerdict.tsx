import { useState } from 'react'
import { coordinatesLabel } from './mars'
import type { Coordinates } from './mars'
import { MOBILITY_OPTIONS } from './siteIntel'
import type { Severity, VerdictStatus } from './siteIntel'
import './siteVerdict.css'
import useSiteReport from './useSiteReport'

const STATUS_MARK: Record<VerdictStatus, string> = { go: '✓', caution: '!', no_go: '✕', unknown: '?' }
const SEVERITY_MARK: Record<Severity, string> = { block: '✕', warn: '!', ok: '✓', info: 'i' }
const SEVERITY_LABEL: Record<Severity, string> = { block: 'Blocked', warn: 'Warning', ok: 'Within limits', info: 'Information' }
const number = (value: number | null, digits: number, unit: string) => value === null ? 'Unavailable' : `${value.toFixed(digits)} ${unit}`

interface Props {
  point: Coordinates
  defaultProfile: string
  onPlanRoute?: () => void
}

/** Answers "what is here, can I go there, and why" for the selected map point. */
export default function SiteVerdict({ point, defaultProfile, onPlanRoute }: Props) {
  const [profile, setProfile] = useState(defaultProfile)
  const { data, error, retry } = useSiteReport(point, profile)

  return (
    <section className="site-verdict" dir="ltr" lang="en" aria-label="Location details" data-status={data?.verdict.status ?? 'loading'}>
      <header className="site-verdict-head">
        <div>
          
          <h3>{data ? data.region.displayName : '…'}</h3>
          <p dir="ltr">{coordinatesLabel(point)}{data && ` · ${data.region.type}`}</p>
        </div>
        <label className="site-verdict-profile">Mobility profile
          <select value={profile} onChange={(event) => setProfile(event.target.value)}>
            {MOBILITY_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
      </header>

      {!data && !error && <p className="site-verdict-wait" role="status">Checking this location…</p>}
      {error && <p className="site-verdict-wait" role="alert">{error} <button onClick={retry}>Retry</button></p>}

      {data && <>
        <div className="site-verdict-banner" role="status">
          <span className="site-verdict-mark" aria-hidden="true">{STATUS_MARK[data.verdict.status]}</span>
          <div>
            <strong>{data.verdict.label}</strong>
            <span>{data.verdict.confidence === 'local' ? `Local assessment · ${data.terrain.resolutionM} m resolution` : 'Regional screening · local terrain unavailable'} · slope limit {data.profile.maxSlopeDeg}°</span>
          </div>
        </div>

        <h4>Why?</h4>
        <ul className="site-verdict-reasons">
          {data.verdict.reasons.map((reason) => (
            <li key={reason.code} data-severity={reason.severity}>
              <span className="site-verdict-chip" title={SEVERITY_LABEL[reason.severity]}><span aria-hidden="true">{SEVERITY_MARK[reason.severity]}</span><span className="sr-only">{SEVERITY_LABEL[reason.severity]}: </span></span>
              <span>{reason.text}{reason.source && <small dir="ltr"> {reason.source}</small>}</span>
            </li>
          ))}
        </ul>
        <p className="site-verdict-next">{data.verdict.nextStep}
          {data.routeAvailable && onPlanRoute && data.verdict.status !== 'no_go' && <button onClick={onPlanRoute}>Plan a route here</button>}
        </p>

        <dl className="site-verdict-facts">
          <div><dt>Elevation</dt><dd dir="ltr">{number(data.terrain.elevationM, 0, 'm')}</dd></div>
          <div><dt>Slope</dt><dd dir="ltr">{number(data.terrain.slopeDeg, 1, '°')}</dd></div>
          <div><dt>Roughness</dt><dd dir="ltr">{number(data.terrain.roughnessM, 2, 'm RMS')}</dd></div>
          <div><dt>Resolution</dt><dd dir="ltr">{data.terrain.resolutionM.toLocaleString('en')} m</dd></div>
        </dl>
        <p className="site-terrain-source">{data.terrain.sourceUrl
          ? <a href={data.terrain.sourceUrl} target="_blank" rel="noreferrer">{data.terrain.source} ↗</a>
          : data.terrain.source}</p>

        <div className="site-verdict-grid">
          <article>
            <h4>Geology</h4>
            {data.geology ? <>
              <p className="site-verdict-unit"><i style={{ background: data.geology.color ?? 'transparent' }} aria-hidden="true" /><b dir="ltr">{data.geology.symbol}</b> <span dir="ltr">{data.geology.name}</span></p>
              <details><summary>Description and interpretation</summary>
                <p dir="ltr" lang="en">{data.geology.description}</p>
                {data.geology.interpretation && <p dir="ltr" lang="en"><b>Interpretation:</b> {data.geology.interpretation}</p>}
              </details>
              <small>USGS SIM 3464 · scale {data.geology.scale} · interpretive geology; not an obstacle inventory. <a href="https://doi.org/10.3133/sim3464" target="_blank" rel="noreferrer">Source ↗</a></small>
              {data.landingEllipse && <p className="site-verdict-tag">Within the Perseverance landing ellipse</p>}
              {data.surfaceFeature && <p className="site-verdict-tag" dir="ltr">{data.surfaceFeature}</p>}
            </> : <p className="site-verdict-empty">Outside the detailed Jezero / Nili Planum geologic map. No 1:75,000 unit is available for this point.</p>}
          </article>

          <article>
            <h4>Nearest Perseverance waypoint</h4>
            {data.rover ? <>
              <p><b dir="ltr">Sol {data.rover.sol}</b> · distance <span dir="ltr">{data.rover.distanceM >= 1000 ? `${(data.rover.distanceM / 1000).toFixed(1)} km` : `${data.rover.distanceM.toFixed(0)} m`}</span></p>
              {data.rover.images[0]
                ? <p><a href={data.rover.images[0].url} target="_blank" rel="noreferrer">Open NASA panorama ↗</a><br /><small>{data.rover.imageAtSelection ? 'Taken at this recorded waypoint.' : 'Image from the rover waypoint, not the selected coordinates.'}</small></p>
                : <p className="site-verdict-empty">No surface image is available at this location.</p>}
              <small dir="ltr">{data.rover.credit}</small>
            </> : <p className="site-verdict-empty">No recorded rover waypoint or surface image is available near this point.</p>}
          </article>
        </div>

        <details className="site-verdict-missing">
          <summary>Missing measurements ({data.unavailable.length})</summary>
          <ul>{data.unavailable.map((item) => <li key={item.key}><b>{item.label}:</b> {item.why}</li>)}</ul>
        </details>
        <p className="site-verdict-limits">{data.verdict.limits} <span dir="ltr">{data.terrain.source}</span></p>
      </>}
    </section>
  )
}
