// A tiny client-side router: the site has four pages, so a dependency isn't worth it.
// Works as static files because the hosts rewrite unknown paths to index.html
// (web/vercel.json, web/public/_redirects).
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react'

const EVENT = 'mythicbench:navigate'

export function navigate(to: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  window.dispatchEvent(new Event(EVENT))
  if (!to.includes('#')) window.scrollTo(0, 0)
}

/** The current pathname (without a trailing slash, except for "/"). */
export function usePath(): string {
  const [path, setPath] = useState(() => clean(location.pathname))
  useEffect(() => {
    const on = () => setPath(clean(location.pathname))
    window.addEventListener('popstate', on)
    window.addEventListener(EVENT, on)
    return () => {
      window.removeEventListener('popstate', on)
      window.removeEventListener(EVENT, on)
    }
  }, [])
  return path
}

function clean(p: string) {
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}

/** An <a> that navigates without a page load (plain clicks only; new-tab clicks work as usual). */
export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handle} {...rest} />
}
