// The site ships to two static hosts, each with its own header file. This keeps
// their security headers identical, so a fix made in one can't miss the other.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const web = fileURLToPath(new URL('../..', import.meta.url))

function cloudflare(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(join(web, 'public', '_headers'), 'utf8').split('\n')) {
    const m = line.match(/^\s+([A-Za-z-]+):\s*(.+?)\s*$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function vercel(): Record<string, string> {
  const cfg = JSON.parse(readFileSync(join(web, 'vercel.json'), 'utf8'))
  const all = cfg.headers.find((h: { source: string }) => h.source === '/(.*)')
  return Object.fromEntries(all.headers.map((h: { key: string; value: string }) => [h.key, h.value]))
}

describe('security headers', () => {
  it('match between Vercel and Cloudflare Pages', () => {
    expect(vercel()).toEqual(cloudflare())
  })

  it('keep scripts to this site and forbid framing', () => {
    const csp = vercel()['Content-Security-Policy']
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';")
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })
})
