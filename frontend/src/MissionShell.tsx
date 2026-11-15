import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import App from './App'
import { DataCenter, MissionComparison, SurvivalCenter } from './MissionPages'
import MissionHome from './MissionHome'
import { Reports, Settings } from './OperationsPages'
import Icon from './Icon'
import BrandMark from './BrandMark'
import FlowBar from './FlowBar'
import { FLOW } from './flow'
import { LANDMARKS } from './mars'
import type { Assessment, Coordinates } from './mars'
import type { Candidate } from './science'
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, REPORTS_KEY } from './missionState'
import type { Preferences, RouteReport } from './missionState'
import './mission.css'
import './theme.css'
import './orbit.css'

const NavigationLab = lazy(() => import('./NavigationLab'))
const TraversePlanner = lazy(() => import('./TraversePlanner'))
// `group` drives the sidebar. `parent` marks a page that is a tab of another page:
// it keeps its URL but is reached from the parent, so the sidebar stays short.
const PAGES = [
  { key: 'home', label: 'Mission Control', icon: 'home', group: 'start' },
  { key: 'explore', label: 'Mars Explorer', icon: 'globe', group: 'flow' },
  { key: 'location', label: 'Location Analysis', icon: 'location', group: 'flow' },
  { key: 'planner', label: 'Rover Route Planner', icon: 'route', group: 'flow' },
  { key: 'advisor', label: 'AI Mission Advisor', icon: 'advisor', group: 'tab', parent: 'location' },
  { key: 'landing', label: 'Landing Site Analysis', icon: 'landing', group: 'tab', parent: 'location' },
  { key: 'comparison', label: 'Site Comparison', icon: 'comparison', group: 'library' },
  { key: 'reports', label: 'Reports', icon: 'reports', group: 'library' },
  { key: 'data', label: 'Scientific Data Center', icon: 'data', group: 'library' },
  { key: 'survival', label: 'Survival Center', icon: 'shield', group: 'reference' },
  { key: 'navigation', label: 'Navigation Technology', icon: 'activity', group: 'reference' },
  { key: 'settings', label: 'Settings', icon: 'settings', group: 'settings' },
] as const
const NAV_GROUPS = [
  { id: 'start', caption: null },
  { id: 'flow', caption: 'Mission workflow' },
  { id: 'library', caption: 'Saved work & data' },
  { id: 'reference', caption: 'Reference' },
] as const
type Page = typeof PAGES[number]['key']
const SAVED_KEY = 'martian-map-candidates-v1'

function pageFromHash(): Page {
  if (location.hash === '#simulator') {
    history.replaceState(history.state, '', '#planner')
    return 'planner'
  }
  return PAGES.find(({ key }) => key === location.hash.slice(1))?.key ?? 'home'
}
function readStored(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
}
function initialCandidates(): Candidate[] {
  const data = readStored(SAVED_KEY)
  if (!Array.isArray(data)) return []
  return data.filter((site) => Number.isFinite(site?.point?.latitude) && Number.isFinite(site?.point?.longitude) &&
    Array.isArray(site?.assessment?.factors) && typeof site?.savedAt === 'string')
}
function initialReports(): RouteReport[] {
  const data = readStored(REPORTS_KEY)
  if (!Array.isArray(data)) return []
  return data.filter((report) => typeof report?.id === 'string' && typeof report?.savedAt === 'string' && report?.terrain && report?.profile && report?.routes && Array.isArray(report?.events))
}
function initialPreferences(): Preferences {
  const data = readStored(PREFERENCES_KEY)
  if (!data || typeof data !== 'object') return DEFAULT_PREFERENCES
  const value = data as Partial<Preferences>
  return { name: typeof value.name === 'string' ? value.name.slice(0, 40) : DEFAULT_PREFERENCES.name, compact: value.compact === true, reducedMotion: value.reducedMotion === true }
}

export default function MissionShell() {
  const [requestedPage, setPage] = useState(pageFromHash)
  // Normalize a removed page held by an already-open tab during hot reload.
  const page = PAGES.find(({ key }) => key === requestedPage)?.key ?? 'planner'
  const [point, setPoint] = useState<Coordinates>(LANDMARKS[0])
  const [candidates, setCandidates] = useState(initialCandidates)
  const [reports, setReports] = useState(initialReports)
  const [preferences, setPreferences] = useState(initialPreferences)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 980px)').matches)
  const [storageError, setStorageError] = useState(false)
  const [notice, setNotice] = useState('')
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking')
  const [healthAttempt, setHealthAttempt] = useState(0)
  // Datasets the server reports as not installed; features that need them degrade.
  const [missingData, setMissingData] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchArea = useRef<HTMLFormElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const current = PAGES.find(({ key }) => key === page)!
  const title = current.label
  const navPage = 'parent' in current ? current.parent : page
  const flowStep = FLOW.find(({ key }) => key === navPage)?.key

  useEffect(() => {
    const navigate = () => { setPage(pageFromHash()); setMobileOpen(false); setSearchOpen(false); window.scrollTo(0, 0) }
    const outside = (event: PointerEvent) => { if (!searchArea.current?.contains(event.target as Node)) setSearchOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setSearchOpen(false); setMobileOpen(false); menuButton.current?.focus() } }
    const media = window.matchMedia('(max-width: 980px)')
    const resize = () => { setIsMobile(media.matches); setMobileOpen(false) }
    window.addEventListener('hashchange', navigate)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    media.addEventListener('change', resize)
    navigate()
    return () => { window.removeEventListener('hashchange', navigate); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); media.removeEventListener('change', resize) }
  }, [])
  useEffect(() => {
    if (mobileOpen && isMobile) {
      sidebar.current?.querySelector('a')?.focus()
      const before = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = before }
    }
  }, [mobileOpen, isMobile])
  useEffect(() => {
    const controller = new AbortController()
    const check = async () => {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        const data = await response.json()
        if (controller.signal.aborted) return
        setHealth(response.ok && (data.status === 'ok' || data.status === 'degraded') ? 'online' : 'offline')
        setMissingData(Array.isArray(data.missingRequired) ? [...data.missingRequired, ...(data.missingOptional ?? [])] : [])
      } catch { if (!controller.signal.aborted) setHealth('offline') }
    }
    void check()
    const timer = window.setInterval(check, 30000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [healthAttempt])
  useEffect(() => { document.title = title + ' · MARTIAN MAP' }, [title])
  useEffect(() => {
    document.documentElement.dataset.motion = preferences.reducedMotion ? 'reduced' : 'system'
    return () => { delete document.documentElement.dataset.motion }
  }, [preferences.reducedMotion])

  const persist = (key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)); setStorageError(false) } catch { setStorageError(true) }
  }
  const selectSite = (site: Coordinates, openReport = true) => {
    setNotice(''); setPoint(site)
    if (openReport) window.location.assign('#location')
  }
  const store = (next: Candidate[]) => { setCandidates(next); persist(SAVED_KEY, next) }
  const saveSite = (site: Coordinates, assessment: Assessment) => {
    const saved = candidates.filter(({ point }) => Math.abs(point.latitude - site.latitude) >= 0.00001 || Math.abs(point.longitude - site.longitude) >= 0.00001)
    store([{ point: site, assessment, savedAt: new Date().toISOString() }, ...saved])
    setNotice('Site analysis saved. View it in Reports or Site Comparison.')
  }
  const saveRoute = (report: RouteReport) => {
    const next = [report, ...reports].slice(0, 50)
    setReports(next); persist(REPORTS_KEY, next)
    setNotice('Route and simulation report saved to Reports.')
  }
  const appPage = ['explore', 'location', 'advisor', 'simulator', 'landing'].includes(page)
    ? page as 'explore' | 'location' | 'planner' | 'advisor' | 'simulator' | 'landing' : null
  const query = search.trim().toLowerCase()
  const pageResults = PAGES.filter(({ label }) => !query || label.toLowerCase().includes(query)).slice(0, 5)
  const regionResults = query ? LANDMARKS.filter(({ name, feature }) => (name + ' ' + feature).toLowerCase().includes(query)) : []
  const healthLabel = health === 'online' ? 'Connected' : health === 'offline' ? 'Connection unavailable' : 'Connecting'

  return <div className={'mission-shell' + (collapsed ? ' sidebar-collapsed' : '') + (mobileOpen ? ' mobile-nav-open' : '') + (preferences.compact ? ' density-compact' : '')}>
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to workspace</a>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className="mission-sidebar" aria-label="Main navigation" ref={sidebar} inert={isMobile && !mobileOpen}>
      <a className="mission-brand" href="#home" aria-label="Martian Map, Mission Control"><span className="brand-orbit"><BrandMark size={30} /></span><span className="brand-words">MARTIAN <b>MAP</b></span></a>
      <button className="sidebar-toggle icon-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed}><Icon name="collapse" size={16} /></button>
      
      <nav>
        {NAV_GROUPS.map(({ id, caption }) => <div className={'nav-group nav-' + id} key={id}>
          {caption && <p className="nav-caption">{caption}</p>}
          {PAGES.filter((item) => item.group === id).map(({ key, label, icon }, position) => <a href={'#' + key} key={key} title={collapsed ? label : undefined} aria-label={id === 'flow' ? `Step ${position + 1}: ${label}` : label} aria-current={navPage === key ? 'page' : undefined}>
            {id === 'flow' ? <span className="nav-step" aria-hidden="true">{position + 1}</span> : <Icon name={icon} size={18} />}<span>{label}</span></a>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom"><a href="#settings" aria-label="Settings" aria-current={page === 'settings' ? 'page' : undefined}><Icon name="settings" size={18} /><span>Settings</span></a></div>
    </aside>

    <div className="mission-frame">
      <header className="mission-topbar">
        <button ref={menuButton} className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Icon name="menu" /></button>
        <div className="topbar-context"><b>{title}</b></div>
        <form className="global-search" ref={searchArea} role="search" onSubmit={(event) => {
          event.preventDefault()
          if (regionResults[0]) selectSite(regionResults[0])
          else if (pageResults[0]) window.location.assign('#' + pageResults[0].key)
          setSearch(''); setSearchOpen(false)
        }}>
          <Icon name="search" size={17} /><input aria-label="Search workspaces and Mars regions" placeholder="Search Mars, tools, regions…" value={search} onFocus={() => setSearchOpen(true)} onChange={(event) => { setSearch(event.target.value); setSearchOpen(true) }} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} />
          <kbd>↵</kbd>
          {searchOpen && <div className="search-results"><p>Workspaces & regions</p>
            {regionResults.map((region) => <button type="button" key={region.name} onClick={() => { selectSite(region); setSearch(''); setSearchOpen(false) }}><Icon name="location" size={16} />{region.feature}<small>Region</small></button>)}
            {pageResults.map(({ key, label, icon }) => <a key={key} href={'#' + key} onClick={() => { setSearch(''); setSearchOpen(false) }}><Icon name={icon} size={16} />{label}<Icon name="arrow" size={14} /></a>)}
            {!pageResults.length && !regionResults.length && <p>No matching workspaces or named regions.</p>}
          </div>}
        </form>
        <span className={'connection-status ' + health} title="FastAPI connection, checked every 30 seconds"><i className="signal-dot" />{healthLabel}</span>
        <details className="topbar-popover"><summary aria-label="System notifications" className="icon-button"><Icon name="bell" />{(health === 'offline' || missingData.length > 0) && <i className="notification-dot" />}</summary><div className="popover-content"><h3>System notifications</h3><p><span className={'connection-status ' + health}><i className="signal-dot" />{healthLabel}</span></p><p>{health === 'online' ? 'Terrain and planning services are reachable.' : 'Start or reconnect the local backend to load assessments and routes.'}</p>{health === 'offline' && <button onClick={() => setHealthAttempt((value) => value + 1)}>Retry connection</button>}{health === 'online' && missingData.length > 0 && <p role="status">Datasets not installed: {missingData.join(', ').replaceAll('_', ' ')}. Features that use them show limited results.</p>}<p>Current Mars weather and live rover telemetry are not connected.</p>{storageError && <p role="alert">Browser storage could not be updated.</p>}</div></details>
        <details className="topbar-popover profile-popover"><summary aria-label="Workspace profile"><span className="profile-avatar">{preferences.name.trim().slice(0, 2).toUpperCase() || 'MS'}</span><span className="profile-label">{preferences.name}<small>Local workspace</small></span><span className="profile-chevron">⌄</span></summary><div className="popover-content"><h3>{preferences.name}</h3><p>Profile and saved reports are stored in this browser. Account authentication is not configured.</p><a href="#settings">Workspace settings <Icon name="arrow" size={14} /></a></div></details>
      </header>
      <main id="main-content" className="mission-main" tabIndex={-1}>
        {storageError && <p className="mission-notice" role="alert">Browser storage is unavailable. Changes apply to this session.</p>}
        {notice && <div className="mission-notice" role="status"><Icon name="check" size={16} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><Icon name="close" size={15} /></button></div>}
        {flowStep && <FlowBar current={flowStep} point={point} />}
        <App page={appPage} point={point} selectSite={selectSite} saveSite={saveSite} saveRoute={saveRoute} />
        {page === 'planner' && <Suspense fallback={<p className="workspace-loading" role="status">Loading route planner…</p>}><TraversePlanner point={point} onSelect={(next) => selectSite(next, false)} onSave={saveRoute} /></Suspense>}
        {page === 'home' && <MissionHome candidates={candidates} point={point} onSelect={selectSite} onSave={saveSite} />}
        {page === 'survival' && <SurvivalCenter point={point} />}
        {page === 'data' && <DataCenter />}
        {page === 'comparison' && <MissionComparison candidates={candidates} onSelect={selectSite} onRemove={(candidate) => store(candidates.filter((other) => other !== candidate))} />}
        {page === 'reports' && <Reports candidates={candidates} reports={reports} onSelect={selectSite} onRemove={(id) => { const next = reports.filter((report) => report.id !== id); setReports(next); persist(REPORTS_KEY, next) }} />}
        {page === 'settings' && <Settings preferences={preferences} onChange={(next) => { setPreferences(next); persist(PREFERENCES_KEY, next) }} candidateCount={candidates.length} reportCount={reports.length} health={health} />}
        {page === 'navigation' && <Suspense fallback={<p className="workspace-loading" role="status">Loading navigation workspace…</p>}><NavigationLab /></Suspense>}
      </main>
      <footer className="mission-footer"><span>Martian Map · educational planning model, not an operational safety approval</span><span>Data: NASA/JPL-Caltech, USGS, IAU</span></footer>
    </div>
  </div>
}
