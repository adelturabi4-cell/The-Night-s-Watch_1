import { useId } from 'react'

/** Martian Map mark: the planet as a contour map, crossed by a route from A to B.
 * The same geometry is used for the favicon (public/favicon.svg) and the lockup
 * (public/logo.svg). Colours are fixed so the mark reads the same on any surface. */
export default function BrandMark({ size = 28, title }: { size?: number; title?: string }) {
  const clip = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={clip}><circle cx="32" cy="32" r="28" /></clipPath>
      </defs>
      <circle cx="32" cy="32" r="28" fill="#ff7b29" />
      <g clipPath={`url(#${clip})`} fill="none" stroke="#c4501a" strokeWidth="2.4" strokeLinecap="round">
        <path d="M2 24c10-6 18 3 28-2s16-12 34-6" />
        <path d="M2 41c12-5 20 5 31 0s18-9 31-4" />
        <path d="M18 56c6-6 14-4 20-8s10-4 16-2" />
      </g>
      <path d="M19 45 28 35l8 4 9-20" fill="none" stroke="#140a03" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="19" cy="45" r="5" fill="#140a03" />
      <circle cx="19" cy="45" r="1.9" fill="#ff7b29" />
      <circle cx="45" cy="19" r="5.5" fill="#fff4ea" stroke="#140a03" strokeWidth="3" />
    </svg>
  )
}
