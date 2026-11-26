import { Github, Menu, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { GITHUB_URL, SITE_URL } from './config'
import { metaFor } from './meta'
import { Link, usePath } from './router'

const NAV = [
  { to: '/', label: 'Leaderboard' },
  { to: '/watch', label: 'Watch' },
  { to: '/highlights', label: 'Highlights' },
  { to: '/party', label: 'Party' },
  { to: '/report', label: 'Report' },
  { to: '/about', label: 'About' },
]

const isActive = (path: string, to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`))

/** Sets the tab title and share tags for the current page. */
export function usePageMeta(path: string) {
  useEffect(() => {
    const m = metaFor(path)
    document.title = m.title
    const set = (sel: string, v: string) => document.querySelector(sel)?.setAttribute('content', v)
    set('meta[name="description"]', m.description)
    set('meta[property="og:title"]', m.title)
    set('meta[property="og:description"]', m.description)
    set('meta[property="og:url"]', SITE_URL + path)
    set('meta[name="twitter:title"]', m.title)
    set('meta[name="twitter:description"]', m.description)
  }, [path])
}

/**
 * The bar on every page. On /watch it also carries the viewer's run picker
 * (`center`) and the dungeon info (`after`), so the replay gets one bar, not two.
 */
export function SiteHeader({ after, center, right, overlay = false }: { after?: ReactNode; center?: ReactNode; right?: ReactNode; overlay?: boolean }) {
  const path = usePath()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [path])
  return (
    <header className={`pointer-events-auto relative z-20 border-b border-line ${overlay ? 'bg-[rgba(15,15,16,0.92)]' : 'bg-bg'}`}>
      <div className={`flex h-14 items-center gap-4 whitespace-nowrap ${overlay ? 'px-4' : 'mx-auto max-w-[1248px] px-4 sm:px-6'}`}>
        <div className="flex shrink-0 items-baseline gap-3">
          <Link to="/" className="flex items-center gap-2 rounded text-[16px] font-medium text-fg">
            <span aria-hidden className="h-2 w-2 rotate-45 rounded-[1px] bg-accent" />MythicBench
          </Link>
          {after}
        </div>
        <div className="mx-auto flex min-w-0 items-center gap-2">{center}</div>
        <nav aria-label="Site" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={isActive(path, n.to) ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-[14px] transition-colors ${isActive(path, n.to) ? 'text-fg' : 'text-fg-muted hover:text-fg'}`}>
              {n.label}
            </Link>
          ))}
          <a href={GITHUB_URL} className="icon-btn ml-1" title="Source on GitHub" aria-label="Source on GitHub"><Github size={16} /></a>
        </nav>
        {right}
        <button className="icon-btn -mr-2 md:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
      {open && (
        // Dims the page under the menu; a tap on it closes the menu.
        <div className="fixed inset-x-0 bottom-0 top-14 bg-black/60 md:hidden" aria-hidden onClick={() => setOpen(false)} />
      )}
      {open && (
        <nav aria-label="Site" className="absolute inset-x-0 top-full border-b border-line bg-surface px-4 pb-4 pt-2 md:hidden">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} aria-current={isActive(path, n.to) ? 'page' : undefined}
              className={`block rounded-lg px-3 py-3 text-[15px] ${isActive(path, n.to) ? 'bg-surface-raised text-fg' : 'text-fg-muted'}`}>
              {n.label}
            </Link>
          ))}
          <a href={GITHUB_URL} className="block rounded-lg px-3 py-3 text-[15px] text-fg-muted">Source on GitHub</a>
        </nav>
      )}
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto max-w-[1248px] px-4 sm:px-6">
        <div className="py-8 text-[13px] leading-5 text-fg-faint">
          <div className="flex flex-wrap justify-end gap-x-6 gap-y-2">
            <Link to="/changelog" className="transition-colors hover:text-fg">Changelog</Link>
            <Link to="/about#credits" className="transition-colors hover:text-fg">Credits</Link>
            <a href={GITHUB_URL} className="transition-colors hover:text-fg">GitHub</a>
            <a href={`${GITHUB_URL}#credits-and-license`} className="transition-colors hover:text-fg">License</a>
          </div>
        </div>
      </div>
    </footer>
  )
}

/** A normal scrolling page: header, content column, footer. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1248px] flex-1 px-4 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  )
}
