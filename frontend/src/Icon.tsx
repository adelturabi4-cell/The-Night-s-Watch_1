import type { CSSProperties } from 'react'

const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10H3V10Zm6 10v-7h6v7',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z',
  location: 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  route: 'M5 6a2 2 0 1 0 0 .1M19 18a2 2 0 1 0 0 .1M7 6h9a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8h9',
  advisor: 'M12 3v3M8 3h8M4 9h16v11H4V9Zm4 4h1m6 0h1M8 17h8M1 12v5m22-5v5',
  simulator: 'm9 6 10 6-10 6V6ZM3 5v14',
  landing: 'M12 2v12m-4-4 4 4 4-4M3 16l4-3m14 3-4-3M4 21h16M7 17l-2 4m12-4 2 4',
  comparison: 'M4 5h6v15H4V5Zm10-2h6v17h-6V3ZM2 22h20',
  data: 'M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3ZM4 6v12c0 2 4 3 8 3s8-1 8-3V6M4 12c0 2 4 3 8 3s8-1 8-3',
  reports: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8m-8 4h6',
  settings: 'm9 3 6 0 1 3 3 1 2 5-2 2v4l-5 3-3-1-3 1-5-3v-4l-2-2 2-5 3-1 1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6',
  bell: 'M5 16V9a7 7 0 0 1 14 0v7l2 2H3l2-2Zm4 5h6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  external: 'M13 4h7v7m0-7L9 15M10 4H4v16h16v-6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  collapse: 'M3 4h18v16H3V4Zm5 0v16m9-12-4 4 4 4',
  close: 'm5 5 14 14M5 19 19 5',
  check: 'm5 12 4 4L19 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 6v6l4 2',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  terrain: 'm2 19 7-13 5 8 3-5 5 10H2Zm4-7 3 2 3-3',
  activity: 'M2 12h5l3-8 4 16 3-8h5',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2',
}

export default function Icon({ name, size = 19, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name] ?? paths.globe} /></svg>
}
