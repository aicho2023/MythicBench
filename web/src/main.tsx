import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css' // floating combat text, viewer headings
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/inter/400.css' // the report's body text
import '@fontsource/inter/400-italic.css'
import '@fontsource/inter/600.css' // bold lead-ins in the report
import { Component, lazy, StrictMode, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { About } from './pages/About'
import { Changelog } from './pages/Changelog'
import { Highlights } from './pages/Highlights'
import { Home } from './pages/Home'
import { NotFound } from './pages/NotFound'
import { Party } from './pages/Party'
import { usePageMeta } from './site/Layout'
import { usePath } from './site/router'
import './index.css'

// The viewer (three.js) loads on demand.
const Watch = lazy(() => import('./App'))
const Report = lazy(() => import('./pages/Report').then((m) => ({ default: m.Report })))
const Compare = lazy(() => import('./pages/Compare').then((m) => ({ default: m.Compare })))
// Dev only: the condition keeps the page (and its three.js imports) out of the production build.
const DevPortraits = import.meta.env.DEV ? lazy(() => import('./pages/DevPortraits')) : null

// A deploy renames the code files that pages load on demand, so a tab opened
// before it asks for files that are gone. Load the new version instead of
// leaving a blank page; at most once a minute, so a real outage can't loop.
function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem('mb:reloaded') ?? 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem('mb:reloaded', String(Date.now()))
  } catch { /* storage blocked: reload anyway */ }
  location.reload()
  return true
}
window.addEventListener('vite:preloadError', (e) => { if (reloadForNewVersion()) e.preventDefault() })

/** Catches a page that fails to load or render: reloads once for a stale deploy, else says so. */
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: unknown) {
    if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String(err))) reloadForNewVersion()
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="grid h-full min-h-[60vh] place-items-center px-4 text-center text-[14px] text-fg-muted">
        <p>This page didn't load. <button className="underline decoration-accent/50 underline-offset-4 hover:text-fg" onClick={() => location.reload()}>Reload</button></p>
      </div>
    )
  }
}

// Links from before the site existed opened the viewer at the root: /?replay=<id>, /?run=<id>.
{
  const q = new URLSearchParams(location.search)
  if (location.pathname === '/' && (q.has('replay') || q.has('run'))) history.replaceState(null, '', `/watch${location.search}`)
}

function Site() {
  const path = usePath()
  usePageMeta(path)
  let page
  if (path === '/') page = <Home />
  else if (path === '/watch' || path.startsWith('/watch/')) page = <div className="viewer h-full"><Watch path={path} /></div>
  else if (path === '/report') page = <Report />
  else if (path === '/commentary' || path === '/paper') { history.replaceState(null, '', `/report${location.hash}`); page = <Report /> }  // its old names
  else if (path === '/highlights') page = <Highlights />
  else if (path === '/party') page = <Party />
  else if (path === '/about') page = <About />
  else if (path === '/changelog') page = <Changelog />
  else if (path === '/compare') page = <Compare />
  else if (DevPortraits && path === '/dev/portraits') page = <DevPortraits />
  else page = <NotFound />
  return (
    <PageBoundary key={path}>
      <Suspense fallback={<div className="grid h-full place-items-center text-[13px] text-fg-faint">Loading…</div>}>{page}</Suspense>
    </PageBoundary>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
)
