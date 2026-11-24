// Renders the share card (public/og.jpg) and short highlight clips (MP4) from the
// real replays, so link previews and social posts always show the current game.
//
//   npm run dev                          # in one terminal (the script drives the dev server)
//   node scripts/media.mjs og            # writes public/og.jpg
//   node scripts/media.mjs clips [id..]  # writes clips/<id>.mp4 (all clips if no ids)
//
// Needs Playwright (`npm i -D playwright && npx playwright install chromium`, or a
// global install) and ffmpeg for the clips. Frames are rendered one at a time on
// the replay's own clock, so clips are smooth however slow the machine is.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.MB_URL ?? 'http://localhost:5173'
const FPS = 24

let chromium
try { ({ chromium } = require('playwright')) } catch {
  console.error('Playwright is not installed: npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

/** The site's own type, inlined so the card renders the same everywhere. */
function font(weight) {
  const f = join(WEB, `node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff2`)
  return `@font-face { font-family: Plex; font-weight: ${weight}; src: url(data:font/woff2;base64,${readFileSync(f).toString('base64')}) format('woff2'); }`
}
const FONTS = font(400) + font(500) + font(600)

async function launch() {
  return chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
}

/** Open a replay paused, wait for the scene, and hide the viewer's panels (name tags stay unless plates=false). */
async function openReplay(page, path, { plates = true } = {}) {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.waitForFunction(() => window.__playback?.getState().engine, null, { timeout: 120_000 })
  await page.waitForTimeout(4000) // models and textures
  await page.evaluate((plates) => {
    const root = document.querySelector('.viewer > div')
    ;[...root.children].forEach((el, i) => { if (i > (plates ? 1 : 0)) el.style.display = 'none' })
  }, plates)
}

/** Wait for the scene to draw the time just set (the screenshot itself waits for the next composited frame). */
const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())))

// ---------------------------------------------------------------- share card

const OG = {
  // Claude Opus 5.5, group 3, pull 3: three agents dive into Bone Pyre's circle with a second to spare.
  path: '/watch/claude-opus-5-5/plus10/2/3?t=99.5&paused=1&follow=0&cam=1.5,13.5,13.5&look=-8.6,0.5,-3.6',
  quote: { who: 'Rook', color: '#6fa8ff', text: 'Brask, Kit, step in NOW, it pops in 1.5s!' },
}

async function og() {
  const b = await launch()
  const page = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 })
  await openReplay(page, OG.path, { plates: false })
  await frame(page)
  const scene = (await page.screenshot({ type: 'png' })).toString('base64')
  await page.close()

  const card = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await card.setContent(`<!doctype html><html><head><style>${FONTS}
    * { margin: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; overflow: hidden; background: #0a0a0c; font-family: Plex, sans-serif; color: #ededef; }
    .scene { position: absolute; inset: 0; background: url(data:image/png;base64,${scene}) center / cover; }
    .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10,10,12,.96) 0%, rgba(10,10,12,.88) 34%, rgba(10,10,12,0) 62%); }
    .text { position: absolute; left: 64px; top: 64px; width: 520px; }
    .brand { font-size: 22px; font-weight: 500; display: flex; align-items: center; gap: 10px; }
    .brand i { width: 12px; height: 12px; background: #e8cf8f; transform: rotate(45deg); }
    h1 { margin-top: 40px; font-size: 54px; line-height: 1.06; font-weight: 400; letter-spacing: -0.02em; }
    p { margin-top: 26px; font-size: 24px; line-height: 1.4; color: #b4b4bb; }
    p b { color: #ededef; font-weight: 500; }
    .chat { position: absolute; right: 40px; bottom: 40px; max-width: 470px; padding: 14px 18px; border-radius: 12px;
      background: rgba(15,15,16,.9); border: 1px solid rgba(255,255,255,.1); font-size: 20px; line-height: 1.35; color: #aab4ff; }
    .chat small { display: block; font-size: 14px; color: #8a8a93; margin-bottom: 4px; }
  </style></head><body>
    <div class="scene"></div><div class="shade"></div>
    <div class="text">
      <div class="brand"><i></i>MythicBench</div>
      <h1>Can five AI agents learn from a wipe?</h1>
      <p>Seven models, 480 attempts, no clears. <b>Two learned to stand in the circle.</b> The other five almost never did.</p>
    </div>
    <div class="chat"><small>Claude Opus 5.5, party chat</small>[<span style="color:${OG.quote.color}">${OG.quote.who}</span>]: ${OG.quote.text}</div>
  </body></html>`)
  await card.waitForTimeout(300)
  await card.screenshot({ path: join(WEB, 'public/og.jpg'), type: 'jpeg', quality: 88 })
  await b.close()
  console.log('wrote public/og.jpg')
}

// ---------------------------------------------------------------- clips

/** from/to in seconds of the pull; cam is the camera's offset from the party it follows. */
const CLIPS = [
  { id: 'step-in-now', path: '/watch/claude-opus-5-5/plus10/2/3', from: 92, to: 102.5, model: 'Claude Opus 5.5', where: 'group 3, pull 3',
    title: 'Only the tank is in the circle. 1.5 seconds left.' },
  { id: 'nobody-inside', path: '/watch/claude-opus-5-5/plus10/0/1', from: 104, to: 116, model: 'Claude Opus 5.5', where: 'group 1, pull 1 (blind)',
    title: 'First pull: the party avoids the glowing circle.' },
  { id: 'saw-it-fail', path: '/watch/gpt-6-luna/plus10/6/4', from: 115, to: 140, model: 'GPT-6 Luna', where: 'group 7, pull 4',
    title: 'Two soak the first Pyre. Then only one does.' },
  { id: 'pyre-kills-five', path: '/watch/gpt-6-luna/plus10/7/3', from: 128, to: 142, model: 'GPT-6 Luna', where: 'group 8, pull 3',
    title: 'Nobody stands in the circle.' },
]
const CAM = '&follow=1&cam=9,13,16&look=0,0.5,0'

/** Captions for the clip: chat lines, deaths, and each Pyre's outcome, in replay ms. */
async function captions(page) {
  return page.evaluate(() => {
    const r = window.__playback.getState().engine.replay
    const name = Object.fromEntries(r.units.map((u) => [u.id, u.name]))
    const cls = Object.fromEntries(r.units.map((u) => [u.id, u.class]))
    const out = []
    for (const e of r.events) {
      if (e.type === 'chat') out.push({ t: e.t, who: name[e.unit], cls: cls[e.unit], text: e.text, kind: 'chat' })
      else if (e.type === 'death' && r.units.find((u) => u.id === e.unit)?.kind === 'player') out.push({ t: e.t, text: `${name[e.unit]} died`, kind: 'bad' })
      else if (e.type === 'pyre_detonate') out.push({ t: e.t, kind: e.soaked ? 'good' : 'bad',
        text: e.soaked ? `Bone Pyre split ${e.inside.length} ways: ${e.inside.map((u) => name[u]).join(', ')} inside` : e.inside.length ? `Bone Pyre: only ${name[e.inside[0]]} inside, it hits everyone` : 'Bone Pyre: nobody inside, it hits everyone' })
    }
    return out
  })
}

// The viewer's class colours (src/content/display.ts).
const COLORS = { guardian: '#6fa8ff', lightweaver: '#ffe38a', berserker: '#ff7a59', shadowblade: '#c68bff', ranger: '#7ee08a' }

async function clip(b, c) {
  const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  await openReplay(page, `${c.path}?t=${c.from}&paused=1${CAM}`)
  const caps = await captions(page)
  await page.addStyleTag({ content: `${FONTS}
    .chat-bubble { display: none !important; } /* the captions below carry the chat, readable on a phone */
    #mb-cap { position: fixed; inset: 0; pointer-events: none; font-family: Plex, sans-serif; z-index: 99; }
    #mb-cap .top { position: absolute; left: 24px; top: 20px; padding: 10px 14px; border-radius: 10px; background: rgba(15,15,16,.88); border: 1px solid rgba(255,255,255,.1); }
    #mb-cap .top b { display: block; font-size: 20px; font-weight: 500; color: #ededef; }
    #mb-cap .top span { font-size: 15px; color: #8a8a93; }
    #mb-cap .lines { position: absolute; left: 50%; bottom: 52px; transform: translateX(-50%); width: 900px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
    #mb-cap .line { padding: 7px 14px; border-radius: 8px; background: rgba(10,10,12,.86); font-size: 21px; line-height: 1.3; text-align: center; }
    #mb-cap .chat { color: #aab4ff; } #mb-cap .bad { color: #f2777a; } #mb-cap .good { color: #7bd389; }
    #mb-cap .mark { position: absolute; right: 22px; bottom: 16px; font-size: 15px; color: rgba(237,237,239,.7); }
    #mb-cap .clock { position: absolute; right: 24px; top: 24px; font-size: 18px; color: #ededef; padding: 6px 10px; border-radius: 8px; background: rgba(15,15,16,.8); font-variant-numeric: tabular-nums; }` })
  await page.evaluate(({ c }) => {
    const d = document.createElement('div')
    d.id = 'mb-cap'
    d.innerHTML = '<div class="top"><b></b><span></span></div><div class="clock"></div><div class="lines"></div><div class="mark">mythicbench.com</div>'
    d.querySelector('.top b').textContent = c.title
    d.querySelector('.top span').textContent = `${c.model}, ${c.where}`
    document.body.appendChild(d)
  }, { c })

  const dir = join(WEB, 'clips', `.frames-${c.id}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const n = Math.round((c.to - c.from) * FPS)
  const t0 = Date.now()
  for (let i = 0; i < n; i++) {
    const t = (c.from + i / FPS) * 1000
    const shown = caps.filter((x) => x.t <= t && t - x.t < (x.kind === 'chat' ? 4500 : 3000)).slice(-3)
    await page.evaluate(({ t, shown, colors }) => {
      window.__playback.getState().seek(t)
      const s = Math.floor(t / 1000)
      document.querySelector('#mb-cap .clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      const box = document.querySelector('#mb-cap .lines')
      box.replaceChildren(...shown.map((x) => {
        const el = document.createElement('div')
        el.className = `line ${x.kind}`
        if (x.kind === 'chat') {
          const who = document.createElement('span')
          who.style.color = colors[x.cls] ?? '#ededef'
          who.textContent = x.who
          el.append('[', who, `]: ${x.text}`)
        } else el.textContent = x.text
        return el
      }))
    }, { t, shown, colors: COLORS })
    await frame(page)
    writeFileSync(join(dir, `${String(i).padStart(5, '0')}.jpg`), await page.screenshot({ type: 'jpeg', quality: 92 }))
    if (i % 30 === 0) process.stdout.write(`\r${c.id}: ${i}/${n} frames, ${((Date.now() - t0) / 1000 / (i + 1)).toFixed(1)} s each`)
  }
  await page.close()
  const out = join(WEB, 'clips', `${c.id}.mp4`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%05d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', out])
  rmSync(dir, { recursive: true, force: true })
  console.log(`\rwrote clips/${c.id}.mp4            `)
}

async function clips(ids) {
  const pick = ids.length ? CLIPS.filter((c) => ids.includes(c.id)) : CLIPS
  if (!pick.length) { console.error(`no such clip; choose from ${CLIPS.map((c) => c.id).join(', ')}`); process.exit(1) }
  const b = await launch()
  for (const c of pick) await clip(b, c)
  await b.close()
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'og') await og()
else if (cmd === 'clips') await clips(rest)
else { console.error('usage: node scripts/media.mjs og | clips [id..]'); process.exit(1) }
