import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css' // floating combat text only
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { About } from './pages/About'
import { Changelog } from './pages/Changelog'
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
const DevPortraits = lazy(() => import('./pages/DevPortraits'))

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
  else if (path === '/party') page = <Party />
  else if (path === '/about') page = <About />
  else if (path === '/changelog') page = <Changelog />
  else if (path === '/compare') page = <Compare />
  else if (import.meta.env.DEV && path === '/dev/portraits') page = <DevPortraits />
  else page = <NotFound />
  return <Suspense fallback={<div className="grid h-full place-items-center text-[13px] text-fg-faint">Loading…</div>}>{page}</Suspense>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
)
