import Icon from './Icon'
import { coordinatesLabel, identifyRegion } from './mars'
import type { Coordinates } from './mars'
import { FLOW } from './flow'
import type { FlowKey } from './flow'


/** Persistent orientation for the workflow pages: where am I, what is selected, what is next. */
export default function FlowBar({ current, point }: { current: FlowKey; point: Coordinates }) {
  const index = FLOW.findIndex(({ key }) => key === current)
  const previous = FLOW[index - 1]
  const next = FLOW[index + 1]
  const region = identifyRegion(point)
  return (
    <nav className="flow-bar" aria-label="Mission workflow">
      <ol>
        {FLOW.map(({ key, title, hint }, position) => (
          <li key={key} data-state={position < index ? 'done' : position === index ? 'current' : 'next'}>
            <a href={'#' + key} aria-label={`${title}: ${hint}`} aria-current={position === index ? 'step' : undefined}>
              <span className="flow-number" aria-hidden="true">{position < index ? '✓' : position + 1}</span>
              <span className="flow-text"><b>{title}</b><small>{hint}</small></span>
            </a>
          </li>
        ))}
      </ol>
      <div className="flow-site" title="Selected site, shared by every step">
        <Icon name="location" size={16} />
        <span><b>{region?.feature ?? 'Selected site'}</b><small>{coordinatesLabel(point)}</small></span>
      </div>
      <div className="flow-actions">
        {previous && <a className="button-link" href={'#' + previous.key} aria-label={`Back to ${previous.title}`}>← Back</a>}
        {next && <a className="button-link primary-link" href={'#' + next.key}>Next: {next.title} <Icon name="arrow" size={14} /></a>}
      </div>
    </nav>
  )
}
