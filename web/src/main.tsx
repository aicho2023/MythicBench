import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css' // floating combat text only
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { About } from './pages/About'
import { Home } from './pages/Home'
import { NotFound } from './pages/NotFound'
import { usePageMeta } from './site/Layout'
import { usePath } from './site/router'
import './index.css'

// The viewer (three.js) and the paper (MDX) load on demand.
const Watch = lazy(() => import('./App'))
const Paper = lazy(() => import('./pages/Paper').then((m) => ({ default: m.Paper })))
const Compare = lazy(() => import('./pages/Compare').then((m) => ({ default: m.Compare })))

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
  else if (path === '/paper') page = <Paper />
  else if (path === '/about') page = <About />
  else if (path === '/compare') page = <Compare />
  else page = <NotFound />
  return <Suspense fallback={<div className="grid h-full place-items-center text-[13px] text-fg-faint">Loading…</div>}>{page}</Suspense>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
)
