import { useState } from 'react'
import { fmtDist, fmtDur, lerpAt } from './render'
import type { Route, RouteKey } from './types'
import { ROUTE_KEYS, ROUTE_STYLE } from './types'

interface Props {
  routes: Partial<Record<RouteKey, Route>>
  visible: Record<RouteKey, boolean>
  selected: RouteKey
  progress: number | null // fractional path index on the selected route
  usableWh: number
}

const W = 760
const PAD = { l: 52, r: 74, t: 10, b: 22 }
const H_ELEV = 150
const H_RISK = 12
const H_EN = 96

function ticks(min: number, max: number, n: number): number[] {
  const span = max - min || 1
  const step0 = span / n
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => span / s <= n) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v)
  return out
}

export default function ProfileChart({ routes, visible, selected, progress, usableWh }: Props) {
  const [hoverX, setHoverX] = useState<number | null>(null)
  const shown = ROUTE_KEYS.filter((k) => routes[k]?.status === 'ok' && (visible[k] || k === selected))
  const sel = routes[selected]
  if (!sel || sel.status !== 'ok' || shown.length === 0) {
    return <div className="chart-empty">No route profile to show.</div>
  }

  const maxD = Math.max(...shown.map((k) => routes[k]!.metrics.distance_m))
  let lo = Infinity
  let hi = -Infinity
  let maxE = 0
  for (const k of shown) {
    for (const v of routes[k]!.profile.elev) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    maxE = Math.max(maxE, routes[k]!.metrics.energy_wh)
  }
  const padE = (hi - lo) * 0.08 || 1
  lo -= padE
  hi += padE
  const showBudget = usableWh <= maxE * 1.6
  const topE = Math.max(maxE, showBudget ? usableWh : 0) * 1.08

  const iw = W - PAD.l - PAD.r
  const x = (d: number) => PAD.l + (d / maxD) * iw
  const yE = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * H_ELEV
  const riskTop = PAD.t + H_ELEV + 8
  const enTop = riskTop + H_RISK + 26
  const yN = (v: number) => enTop + (1 - v / topE) * H_EN
  const totalH = enTop + H_EN + PAD.b

  const line = (r: Route, arr: number[], y: (v: number) => number) =>
    r.profile.dist.map((d, i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(arr[i]).toFixed(1)}`).join('')

  // Fractional index on the selected route at a given distance
  const idxAt = (r: Route, d: number) => {
    const ds = r.profile.dist
    let a = 0
    let b = ds.length - 1
    while (b - a > 1) {
      const m = (a + b) >> 1
      if (ds[m] <= d) a = m
      else b = m
    }
    return a + (ds[b] > ds[a] ? (d - ds[a]) / (ds[b] - ds[a]) : 0)
  }

  const hoverD = hoverX === null ? null : Math.min(sel.metrics.distance_m, Math.max(0, ((hoverX - PAD.l) / iw) * maxD))
  const hi_ = hoverD === null ? null : idxAt(sel, hoverD)
  const progD = progress === null ? null : lerpAt(sel.profile.dist, progress)

  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${W} ${totalH}`}
        role="img"
        aria-label="Elevation, risk and energy along the route"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setHoverX(((e.clientX - rect.left) / rect.width) * W)
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        {/* Elevation */}
        <text x={PAD.l} y={PAD.t + 2} className="c-title" dominantBaseline="hanging">
          Elevation (m)
        </text>
        {ticks(lo, hi, 4).map((v) => (
          <g key={`e${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yE(v)} y2={yE(v)} className="c-grid" />
            <text x={PAD.l - 6} y={yE(v)} className="c-tick" textAnchor="end" dominantBaseline="middle">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        {shown
          .filter((k) => k !== selected)
          .concat(selected)
          .map((k) => {
            const r = routes[k]!
            const st = ROUTE_STYLE[k]
            const last = r.profile.dist.length - 1
            return (
              <g key={k}>
                <path
                  d={line(r, r.profile.elev, yE)}
                  fill="none"
                  stroke={st.color}
                  strokeWidth={k === selected ? 2.5 : 1.5}
                  strokeDasharray={st.dash.join(' ')}
                  opacity={k === selected ? 1 : 0.75}
                  strokeLinejoin="round"
                />
                <circle cx={x(r.profile.dist[last])} cy={yE(r.profile.elev[last])} r={4} fill={st.color} stroke="#0b1220" strokeWidth={2} />
              </g>
            )
          })}

        {/* Risk strip for the selected route */}
        <text x={W - PAD.r + 8} y={riskTop + H_RISK / 2} className="c-tick" dominantBaseline="middle">
          Risk 0–1
        </text>
        {sel.profile.dist.slice(0, -1).map((d, i) => (
          <rect
            key={i}
            x={x(d)}
            y={riskTop}
            width={Math.max(0.6, x(sel.profile.dist[i + 1]) - x(d) + 0.3)}
            height={H_RISK}
            fill={`rgb(${26 + 229 * sel.profile.risk[i]}, ${34 + 62 * sel.profile.risk[i]}, ${52 + 12 * sel.profile.risk[i]})`}
          />
        ))}

        {/* Energy */}
        <text x={PAD.l} y={enTop - 14} className="c-title" dominantBaseline="hanging">
          Energy used (Wh)
        </text>
        {ticks(0, topE, 3).map((v) => (
          <g key={`n${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yN(v)} y2={yN(v)} className="c-grid" />
            <text x={PAD.l - 6} y={yN(v)} className="c-tick" textAnchor="end" dominantBaseline="middle">
              {v.toFixed(0)}
            </text>
          </g>
        ))}
        {showBudget && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={yN(usableWh)} y2={yN(usableWh)} className="c-budget" />
            <text x={W - PAD.r + 8} y={yN(usableWh)} className="c-tick" dominantBaseline="middle">
              Usable budget
            </text>
          </g>
        )}
        {shown
          .filter((k) => k !== selected)
          .concat(selected)
          .map((k) => {
            const r = routes[k]!
            const st = ROUTE_STYLE[k]
            return (
              <path
                key={k}
                d={line(r, r.profile.energy, yN)}
                fill="none"
                stroke={st.color}
                strokeWidth={k === selected ? 2.5 : 1.5}
                strokeDasharray={st.dash.join(' ')}
                opacity={k === selected ? 1 : 0.75}
              />
            )
          })}

        {/* Shared distance axis */}
        {ticks(0, maxD, 6).map((v) => (
          <text key={`x${v}`} x={x(v)} y={totalH - 6} className="c-tick" textAnchor="middle">
            {v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${v.toFixed(0)} m`}
          </text>
        ))}

        {progD !== null && <line x1={x(progD)} x2={x(progD)} y1={PAD.t} y2={enTop + H_EN} className="c-progress" />}
        {hoverD !== null && hi_ !== null && (
          <g>
            <line x1={x(hoverD)} x2={x(hoverD)} y1={PAD.t} y2={enTop + H_EN} className="c-cross" />
            <circle cx={x(hoverD)} cy={yE(lerpAt(sel.profile.elev, hi_))} r={4.5} fill={ROUTE_STYLE[selected].color} stroke="#0b1220" strokeWidth={2} />
            <circle cx={x(hoverD)} cy={yN(lerpAt(sel.profile.energy, hi_))} r={4.5} fill={ROUTE_STYLE[selected].color} stroke="#0b1220" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hoverD !== null && hi_ !== null && hoverX !== null && (
        <div className="chart-tip" style={{ left: `${Math.min(78, Math.max(2, (hoverX / W) * 100))}%` }}>
          <b>
            {ROUTE_STYLE[selected].label} route · {fmtDist(hoverD)}
          </b>
          <span>Elevation {lerpAt(sel.profile.elev, hi_).toFixed(1)} m</span>
          <span>Slope {lerpAt(sel.profile.slope, hi_).toFixed(1)}°</span>
          <span>Risk {lerpAt(sel.profile.risk, hi_).toFixed(2)}</span>
          <span>Energy used {lerpAt(sel.profile.energy, hi_).toFixed(0)} Wh</span>
          <span>Elapsed {fmtDur(lerpAt(sel.profile.time, hi_))}</span>
        </div>
      )}
    </div>
  )
}
