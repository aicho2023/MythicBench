// Sharing a result: a line of text, a link that opens the same vault with the
// result on it (so a friend plays the same seeds), and a card image drawn in
// the browser. No server: everything is in the link.
import { CLASS_COLORS } from '../content/display'
import { SITE_URL } from '../site/config'
import { MAX_PULLS, groupScore, type Tier } from './store'

export interface Shared { vault: number; tier: Tier; seat: string; pulls: { score: number; cleared: boolean }[] }

export const SEAT_NAMES: Record<string, { name: string; cls: string; klass: string }> = {
  rook: { name: 'Rook', cls: 'guardian', klass: 'the tank' },
  ivy: { name: 'Ivy', cls: 'lightweaver', klass: 'the healer' },
  brask: { name: 'Brask', cls: 'berserker', klass: 'the berserker' },
  kit: { name: 'Kit', cls: 'shadowblade', klass: 'the shadowblade' },
  wren: { name: 'Wren', cls: 'ranger', klass: 'the ranger' },
}
export const TIER_NAME: Record<Tier, string> = { normal: 'Normal', plus10: '+10' }

/** One square per pull: cleared, reached Oruth (the packs are 30% of the run), or stopped in the trash. */
const square = (p: { score: number; cleared: boolean }) => (p.cleared ? '🟩' : p.score >= 21 ? '🟨' : '🟥')

export function headline(r: Shared): string {
  const k = r.pulls.findIndex((p) => p.cleared)
  if (k >= 0) return `Cleared on pull ${k + 1}`
  if (r.tier === 'plus10' && r.pulls.length >= MAX_PULLS) return `Group score ${groupOf(r)!.toFixed(1)}`
  const best = Math.max(...r.pulls.map((p) => p.score))
  return r.pulls.length >= MAX_PULLS ? `No clear, best pull ${best.toFixed(1)}` : `Best pull ${best.toFixed(1)}`
}

const groupOf = (r: Shared) => groupScore(r.pulls)

export function encode(r: Shared): string {
  const q = new URLSearchParams({ v: String(r.vault), t: r.tier, s: r.seat, r: r.pulls.map((p) => `${p.score.toFixed(1)}${p.cleared ? 'c' : ''}`).join('_') })
  return `${SITE_URL}/play?${q}`
}

export function decode(search: string): Shared | null {
  const q = new URLSearchParams(search)
  const vault = Number(q.get('v'))
  const tier = q.get('t') as Tier
  const seat = q.get('s') ?? ''
  const raw = q.get('r')
  if (!Number.isInteger(vault) || vault < 1 || !(tier in TIER_NAME) || !(seat in SEAT_NAMES) || !raw) return null
  const pulls = raw.split('_').slice(0, MAX_PULLS).map((x) => ({ score: Number.parseFloat(x), cleared: x.endsWith('c') }))
  if (!pulls.length || pulls.some((p) => !Number.isFinite(p.score) || p.score < 0 || p.score > 100)) return null
  return { vault, tier, seat, pulls }
}

export function shareText(r: Shared): string {
  const who = SEAT_NAMES[r.seat]
  return [
    `MythicBench Vault #${r.vault} (${TIER_NAME[r.tier]})`,
    `I played ${who.name}, ${who.klass}, by the AI's rules, with four expert bots.`,
    `${r.pulls.map(square).join('')} ${headline(r)}`,
  ].join('\n')
}

export function xIntent(r: Shared): string {
  return `https://x.com/intent/post?${new URLSearchParams({ text: shareText(r), url: encode(r) })}`
}

/** The card, 1200×630 (the size link previews use). */
export async function drawCard(r: Shared): Promise<Blob | null> {
  const W = 1200, H = 630
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  if (!g) return null
  await document.fonts?.ready
  const who = SEAT_NAMES[r.seat]
  const col = CLASS_COLORS[who.cls] ?? '#ededef'

  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#141018'); bg.addColorStop(1, '#0a0a0c')
  g.fillStyle = bg; g.fillRect(0, 0, W, H)
  const glow = g.createRadialGradient(300, 420, 20, 300, 420, 420)
  glow.addColorStop(0, `${col}44`); glow.addColorStop(1, 'transparent')
  g.fillStyle = glow; g.fillRect(0, 0, W, H)

  const img = await new Promise<HTMLImageElement | null>((ok) => {
    const i = new Image()
    i.onload = () => ok(i); i.onerror = () => ok(null)
    i.src = `/portraits/${r.seat}.png`
  })
  if (img) g.drawImage(img, 70, 150, 420, 420)

  const sans = "'IBM Plex Sans', system-ui, sans-serif"
  const mono = "'IBM Plex Mono', ui-monospace, monospace"
  g.fillStyle = '#a1a1aa'; g.font = `500 26px ${sans}`
  g.fillText('MythicBench', 72, 92)
  g.fillStyle = '#8b8b93'; g.font = `400 24px ${mono}`
  g.fillText(`Vault #${r.vault}, ${TIER_NAME[r.tier]}`, 260, 92)

  const x = 540
  g.fillStyle = col; g.font = `500 28px ${sans}`
  g.fillText(`${who.name}, ${who.klass}`, x, 210)
  g.fillStyle = '#ededef'; g.font = `400 60px ${sans}`
  wrap(g, headline(r), x, 284, W - x - 60, 68)

  // The pulls
  const size = 92, gap = 16
  r.pulls.forEach((p, k) => {
    const px = x + k * (size + gap), py = 380
    g.fillStyle = p.cleared ? '#4ade80' : p.score >= 21 ? '#fbbf24' : '#f87171'
    g.globalAlpha = 0.16; round(g, px, py, size, size, 12); g.fill()
    g.globalAlpha = 1; g.lineWidth = 2; g.strokeStyle = g.fillStyle as string; round(g, px, py, size, size, 12); g.stroke()
    g.fillStyle = '#ededef'; g.font = `500 30px ${mono}`; g.textAlign = 'center'
    g.fillText(p.score.toFixed(0), px + size / 2, py + 56)
    g.fillStyle = '#8b8b93'; g.font = `400 18px ${sans}`
    g.fillText(`Pull ${k + 1}`, px + size / 2, py + size + 28)
    g.textAlign = 'left'
  })

  g.fillStyle = '#a1a1aa'; g.font = `400 24px ${sans}`
  g.fillText('Played by the AI agents’ rules, with four expert bots.', x, 560)
  g.fillStyle = '#ededef'; g.font = `500 24px ${sans}`
  g.fillText('Can you clear it? mythicbench.com/play', x, 596)
  return new Promise((ok) => c.toBlob((b) => ok(b), 'image/png'))
}

function round(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath()
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  let line = ''
  for (const w of text.split(' ')) {
    if (g.measureText(line + w).width > max && line) { g.fillText(line.trim(), x, y); line = ''; y += lh }
    line += `${w} `
  }
  g.fillText(line.trim(), x, y)
}
