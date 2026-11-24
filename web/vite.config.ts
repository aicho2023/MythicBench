/// <reference types="vitest" />
import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { OG_IMAGE, PAGES } from './src/site/meta'

const SITE_URL = 'https://mythicbench.com'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** Fills the share tags in index.html for one page. */
function withMeta(html: string, p: (typeof PAGES)[number]): string {
  return html
    .replace(/<title>.*?<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/__TITLE__/g, esc(p.title))
    .replace(/__DESCRIPTION__/g, esc(p.description))
    .replace(/__URL__/g, SITE_URL + (p.path === '/' ? '/' : p.path))
    .replace(/__IMAGE__/g, SITE_URL + OG_IMAGE)
}

/**
 * Static hosts serve /paper/index.html for /paper before falling back to the SPA
 * index, so writing one copy of index.html per page gives every page its own
 * title and link preview, with no server rendering.
 */
function pageCopies(): Plugin {
  let outDir = 'dist'
  let build = false
  return {
    name: 'mythicbench-page-copies',
    configResolved(c) { outDir = c.build.outDir; build = c.command === 'build' && !c.build.ssr },
    transformIndexHtml: { order: 'post', handler: (html) => withMeta(html, PAGES[0]) },
    closeBundle() {
      if (!build) return
      // dist/index.html carries the home page's tags; swap them for each other page's.
      const home = PAGES[0]
      const html = readFileSync(join(outDir, 'index.html'), 'utf8')
      for (const p of PAGES.slice(1)) {
        const dir = join(outDir, p.path)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'index.html'), html
          .split(esc(home.title)).join(esc(p.title))
          .split(esc(home.description)).join(esc(p.description))
          .split(`content="${SITE_URL}/"`).join(`content="${SITE_URL}${p.path}"`)
          .split(`href="${SITE_URL}/"`).join(`href="${SITE_URL}${p.path}"`))
      }
    },
  }
}

// Absolute base: the site uses real paths (/watch/<model>/...), so assets must
// resolve from the root on every page.
export default defineConfig({
  plugins: [{ enforce: 'pre', ...mdx() }, react({ include: /\.(mdx|tsx?)$/ }), pageCopies()],
  base: '/',
  // /play's game worker loads Pyodide with a dynamic import: an ES module worker.
  worker: { format: 'es' },
  server: { host: true, port: Number(process.env.PORT) || 5173 },
  test: { environment: 'node' },
})
