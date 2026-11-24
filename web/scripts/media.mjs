// Renders the share card (public/og.jpg), short highlight clips and the launch
// video from the real replays, so link previews and posts always show the current game.
//
//   npm run dev                          # in one terminal (the script drives the dev server)
//   npm run media og                     # writes public/og.jpg (and a copy in media/)
//   npm run media clips [id..]           # writes media/clips/<id>.mp4 (all clips if no ids)
//   npm run media launch                 # writes media/launch/mythicbench-launch.mp4
//   MB_PREVIEW=1 npm run media launch    # a few stills per shot, to check framing first
//
// Needs Playwright (`npm i -D playwright && npx playwright install chromium`, or a
// global install) and ffmpeg for the clips. Frames are rendered one at a time on
// the replay's own clock, so clips are smooth however slow the machine is.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Downloadable media, committed: the repository's media/ folder. */
const MEDIA = join(WEB, '..', 'media')
const BASE = process.env.MB_URL ?? 'http://localhost:5173'
const FPS = 24

let chromium
try { ({ chromium } = require('playwright')) } catch {
  console.error('Playwright is not installed: npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

/** The site's own type, inlined so the card renders the same everywhere. */
function font(family, pkg, weight, style = 'normal') {
  const f = join(WEB, `node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-${style}.woff2`)
  return `@font-face { font-family: ${family}; font-weight: ${weight}; font-style: ${style}; src: url(data:font/woff2;base64,${readFileSync(f).toString('base64')}) format('woff2'); }`
}
const FONTS = font('Plex', 'ibm-plex-sans', 400) + font('Plex', 'ibm-plex-sans', 500) + font('Plex', 'ibm-plex-sans', 600)
  + font('PlexMono', 'ibm-plex-mono', 400) + font('PlexMono', 'ibm-plex-mono', 500)
  + font('PlexSerif', 'ibm-plex-serif', 400, 'italic')

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
  mkdirSync(MEDIA, { recursive: true })
  copyFileSync(join(WEB, 'public/og.jpg'), join(MEDIA, 'share-card.jpg'))
  console.log('wrote public/og.jpg and media/share-card.jpg')
}

// ---------------------------------------------------------------- clips

/** from/to in seconds of the pull, or parts: [[from, to], ...] joined by a labelled cut. */
const CLIPS = [
  { id: 'step-in-now', path: '/watch/claude-opus-5-5/plus10/2/3', from: 92, to: 102.5, model: 'Claude Opus 5.5', where: 'group 3, pull 3',
    title: 'Only the tank is in the circle. 1.5 seconds left.' },
  { id: 'nobody-inside', path: '/watch/claude-opus-5-5/plus10/0/1', from: 104, to: 116, model: 'Claude Opus 5.5', where: 'group 1, pull 1 (blind)',
    title: 'First pull: the party avoids the glowing circle.' },
  { id: 'saw-it-fail', path: '/watch/gpt-6-luna/plus10/6/4', parts: [[116, 123.5], [147.5, 156]], cut: '32 seconds later',
    model: 'GPT-6 Luna', where: 'group 7, pull 4', title: 'Two soak the first Pyre. Then only one does.' },
  { id: 'pyre-kills-five', path: '/watch/gpt-6-luna/plus10/7/3', from: 134.5, to: 145, model: 'GPT-6 Luna', where: 'group 8, pull 3',
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
  const parts = c.parts ?? [[c.from, c.to]]
  await openReplay(page, `${c.path}?t=${parts[0][0]}&paused=1${CAM}`)
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
    #mb-cap .cut { position: absolute; left: 50%; top: 26px; transform: translateX(-50%); padding: 8px 16px; border-radius: 8px; background: rgba(232,207,143,.95); color: #0a0a0c; font-size: 20px; font-weight: 600; }
    #mb-cap .mark { position: absolute; right: 22px; bottom: 16px; font-size: 15px; color: rgba(237,237,239,.7); }
    #mb-cap .clock { position: absolute; right: 24px; top: 24px; font-size: 18px; color: #ededef; padding: 6px 10px; border-radius: 8px; background: rgba(15,15,16,.8); font-variant-numeric: tabular-nums; }` })
  await page.evaluate(({ c }) => {
    const d = document.createElement('div')
    d.id = 'mb-cap'
    d.innerHTML = '<div class="top"><b></b><span></span></div><div class="clock"></div><div class="cut"></div><div class="lines"></div><div class="mark">mythicbench.com</div>'
    d.querySelector('.top b').textContent = c.title
    d.querySelector('.top span').textContent = `${c.model}, ${c.where}`
    document.body.appendChild(d)
  }, { c })

  const dir = join(MEDIA, 'clips', `.frames-${c.id}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // Every frame's replay time, and whether it opens a later part (the cut label shows for 1.6 s).
  const times = parts.flatMap(([a, z], k) => Array.from({ length: Math.round((z - a) * FPS) }, (_, i) => ({ t: (a + i / FPS) * 1000, cut: k > 0 && i < 1.6 * FPS ? c.cut : '' })))
  const n = times.length
  const t0 = Date.now()
  for (let i = 0; i < n; i++) {
    const { t, cut } = times[i]
    const shown = caps.filter((x) => x.t <= t && t - x.t < (x.kind === 'chat' ? 4500 : 3000)).slice(-3)
    await page.evaluate(({ t, cut, shown, colors }) => {
      window.__playback.getState().seek(t)
      const cl = document.querySelector('#mb-cap .cut'); cl.textContent = cut; cl.style.display = cut ? 'block' : 'none'
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
    }, { t, cut, shown, colors: COLORS })
    await frame(page)
    writeFileSync(join(dir, `${String(i).padStart(5, '0')}.jpg`), await page.screenshot({ type: 'jpeg', quality: 92 }))
    if (i % 30 === 0) process.stdout.write(`\r${c.id}: ${i}/${n} frames, ${((Date.now() - t0) / 1000 / (i + 1)).toFixed(1)} s each`)
  }
  await page.close()
  const out = join(MEDIA, 'clips', `${c.id}.mp4`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, '%05d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', out])
  rmSync(dir, { recursive: true, force: true })
  console.log(`\rwrote media/clips/${c.id}.mp4            `)
}

async function clips(ids) {
  const pick = ids.length ? CLIPS.filter((c) => ids.includes(c.id)) : CLIPS
  if (!pick.length) { console.error(`no such clip; choose from ${CLIPS.map((c) => c.id).join(', ')}`); process.exit(1) }
  const b = await launch()
  for (const c of pick) await clip(b, c)
  await b.close()
}

// ---------------------------------------------------------------- launch video
//
// One real group's story, then the contrast and the result. Every line on screen is
// verbatim from the replay it plays over (trimmed at a sentence or marked with an ellipsis).

const W = 1280
const H = 720
const XFADE = 0.4 // seconds of crossfade between segments
const WORK = join(MEDIA, 'launch', '.work')

/** Gameplay shots. cam0/cam1: the camera's offset from `look` at the start and end (a slow push in). */
const SHOTS = {
  blind: {
    path: '/watch/claude-opus-5-5/plus10/0/1', from: 107.6, to: 115.4, look: [1.2, 0.5, -4.6],
    cam0: [14, 16, 5], cam1: [11, 12.6, 4],
    title: 'Pull 1', sub: 'Claude Opus 5.5, group 1. Blind: nobody has told them anything.',
    lines: [{ t: 108.4, who: 'Wren', cls: 'ranger', text: 'New pyre at (2,-7) r2.5 goes off in 6s, unknown dmg: stay out of it.' }],
    booms: [{ t: 114.4, text: 'Nobody inside. It hits everyone.', kind: 'bad' }],
  },
  learned: {
    path: '/watch/claude-opus-5-5/plus10/0/2', from: 139.0, to: 146.8, look: [4.8, 0.5, -9.0],
    cam0: [-8, 14, 15], cam1: [-5.4, 10, 10.4],
    title: 'Pull 2', sub: 'The same group, after one debrief.',
    lines: [{ t: 139.6, who: 'Wren', cls: 'ranger', text: 'Moving into the Pyre at (4.5,-8.9) to soak. Everyone stack in it!' },
      { t: 144.6, who: 'Ivy', cls: 'lightweaver', text: 'Stay in the pyre until it pops.' }],
    booms: [{ t: 145.6, text: 'All five inside. The blast is split five ways.', kind: 'good' }],
  },
  never: {
    path: '/watch/gpt-6-luna/plus10/7/3', from: 137.6, to: 144.6, look: [1.5, 0.5, 3.5],
    cam0: [11, 16, 18], cam1: [9.6, 14, 15.6],
    title: 'Pull 3', sub: 'GPT-6 Luna. Its parties settled on healing through it.',
    lines: [{ t: 141.0, who: 'Brask', cls: 'berserker', text: 'Ivy, emergency heal Brask and Rook before Pyre!' }],
    booms: [{ t: 142.5, text: 'Nobody inside. All five die.', kind: 'bad' }],
  },
}

const SHOT_CSS = `${FONTS}
  .chat-bubble { display: none !important; }
  #mb { position: fixed; inset: 0; pointer-events: none; font-family: Plex, sans-serif; z-index: 99; color: #ededef; }
  #mb .vig { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.55) 100%); }
  #mb .flash { position: absolute; inset: 0; background: #fff3d6; opacity: 0; }
  #mb .head { position: absolute; left: 44px; top: 36px; }
  #mb .head b { display: block; font-size: 40px; font-weight: 500; letter-spacing: -0.01em; text-shadow: 0 2px 12px rgba(0,0,0,.6); }
  #mb .head span { display: block; margin-top: 4px; font-family: PlexMono, monospace; font-size: 15px; color: #c9c9d1; text-shadow: 0 1px 6px #000; }
  #mb .line { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); max-width: 1000px; padding: 10px 18px; border-radius: 10px;
    background: rgba(10,10,12,.82); font-size: 25px; line-height: 1.3; color: #aab4ff; text-align: center; }
  #mb .boom { position: absolute; left: 50%; bottom: 60px; transform: translateX(-50%); padding: 12px 24px; border-radius: 12px; white-space: nowrap;
    background: rgba(10,10,12,.86); font-size: 40px; font-weight: 600; letter-spacing: -0.01em; }
  #mb .bad { color: #ff7b7e; } #mb .good { color: #8be39a; }
  #mb .mark { position: absolute; right: 30px; bottom: 22px; font-family: PlexMono, monospace; font-size: 15px; color: rgba(237,237,239,.75); }`

const ease = (u) => (u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u))
const fadeIn = (dt, d = 0.25) => ease(dt / d)

async function renderShot(b, id, sh, frames) {
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const cam = (u) => sh.look.map((v, k) => v + sh.cam0[k] + (sh.cam1[k] - sh.cam0[k]) * u)
  await openReplay(page, `${sh.path}?t=${sh.from}&paused=1&follow=0&cam=${cam(0).join(',')}&look=${sh.look.join(',')}`)
  await page.addStyleTag({ content: SHOT_CSS })
  await page.evaluate((sh) => {
    const d = document.createElement('div')
    d.id = 'mb'
    d.innerHTML = '<div class="vig"></div><div class="flash"></div><div class="head"><b></b><span></span></div><div class="line"></div><div class="boom"></div><div class="mark">mythicbench.com</div>'
    d.querySelector('.head b').textContent = sh.title
    d.querySelector('.head span').textContent = sh.sub
    document.body.appendChild(d)
  }, sh)
  const dir = join(WORK, id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const n = Math.round((sh.to - sh.from) * FPS)
  const t0 = Date.now()
  for (const i of frames ?? Array.from({ length: n }, (_, i) => i)) {
    const t = sh.from + i / FPS
    const u = i / (n - 1)
    const line = sh.lines.filter((x) => x.t <= t).at(-1)
    const boom = sh.booms.filter((x) => x.t <= t).at(-1)
    await page.evaluate(({ t, u, pos, line, boom, colors }) => {
      window.__playback.getState().seek(t * 1000)
      window.__bridge.camera.position.set(pos[0], pos[1], pos[2])
      const q = (s) => document.querySelector(`#mb ${s}`)
      const head = q('.head'); head.style.opacity = String(Math.min(1, u * 12)); head.style.transform = `translateY(${(1 - Math.min(1, u * 12)) * 8}px)`
      const ln = q('.line')
      if (line) {
        const who = document.createElement('span'); who.style.color = colors[line.cls]; who.textContent = line.who
        ln.replaceChildren('[', who, `]: ${line.text}`)
        const a = Math.min(1, (t - line.t) / 0.25); ln.style.opacity = String(boom && t >= boom.t ? Math.max(0, 1 - (t - boom.t) / 0.15) : a)
      } else ln.style.opacity = '0'
      const bm = q('.boom'), fl = q('.flash')
      if (boom) {
        const dt = t - boom.t
        bm.textContent = boom.text; bm.className = `boom ${boom.kind}`
        bm.style.opacity = String(Math.min(1, dt / 0.15))
        bm.style.transform = `translateX(-50%) scale(${1.12 - 0.12 * Math.min(1, dt / 0.2)})`
        fl.style.opacity = String(Math.max(0, 0.32 * (1 - dt / 0.25)))
      } else { bm.style.opacity = '0'; fl.style.opacity = '0' }
    }, { t, u, pos: cam(ease(u)), line, boom, colors: COLORS })
    await frame(page)
    writeFileSync(join(dir, `${String(i).padStart(5, '0')}.jpg`), await page.screenshot({ type: 'jpeg', quality: 94 }))
    if (!frames && i % 24 === 0) process.stdout.write(`\r${id}: ${i}/${n} frames, ${((Date.now() - t0) / 1000 / (i + 1)).toFixed(1)} s each   `)
  }
  await page.close()
  return n
}

/** Title cards: plain HTML animated by render(s), s = seconds into the card. */
function cards(bg, grid) {
  const base = `${FONTS}
    * { margin: 0; box-sizing: border-box; }
    body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0a0a0c; font-family: Plex, sans-serif; color: #ededef; }
    .bg { position: absolute; inset: -40px; background: url(data:image/jpeg;base64,${bg}) center / cover; filter: blur(14px) brightness(.32) saturate(.8); }
    .in { opacity: 0; transform: translateY(14px); }
    .brand { position: absolute; left: 56px; top: 44px; display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 500; }
    .brand i, .dia { display: inline-block; width: 11px; height: 11px; background: #e8cf8f; transform: rotate(45deg); }
    .mono { font-family: PlexMono, monospace; }
    .center { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 120px; }`
  const anim = `<script>
    const ease = (u) => (u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u))
    function show(el, s, at, d = 0.45) { const u = ease((s - at) / d); el.style.opacity = u; el.style.transform = 'translateY(' + (1 - u) * 14 + 'px)' }
    function typed(el, s, at, cps) { const t = el.dataset.text; const n = Math.max(0, Math.min(t.length, Math.floor((s - at) * cps))); el.textContent = t.slice(0, n); el.style.opacity = n ? 1 : 0 }
  </script>`
  return [
    { id: 'c-intro', d: 3.4, html: `<style>${base} h1 { font-size: 64px; font-weight: 400; letter-spacing: -0.02em; line-height: 1.1; }</style>
      <div class="bg"></div><div class="brand in" id="b"><i></i>MythicBench</div>
      <div class="center"><h1 class="in" id="a">Five AI agents.</h1><h1 class="in" id="c" style="color:#b4b4bb">One boss they've never seen.</h1></div>${anim}
      <script>window.render = (s) => { show(b, s, 0.1); show(a, s, 0.3); show(c, s, 1.2) }</script>` },
    { id: 'c-debrief', d: 6.2, html: `<style>${base} h2 { font-size: 40px; font-weight: 400; letter-spacing: -0.01em; }
        .q { margin-top: 40px; font-family: PlexSerif, serif; font-style: italic; font-size: 44px; line-height: 1.3; color: #f3e6c4; min-height: 172px; }
        .who { margin-top: 22px; font-size: 20px; color: #8a8a93; }</style>
      <div class="bg"></div>
      <div class="center"><div class="mono in" id="k" style="font-size:16px;color:#e8cf8f;letter-spacing:.08em">THE WIPE · THE DEBRIEF</div>
        <h2 class="in" id="a" style="margin-top:14px">They read the combat log and talk it over.</h2>
        <div class="q" id="q" data-text="“…the log shows nobody was inside the circle. I think it has to be soaked.”"></div>
        <div class="who in" id="w">Rook, the tank. Claude Opus 5.5, debrief after pull 1</div></div>${anim}
      <script>window.render = (s) => { show(k, s, 0.1); show(a, s, 0.3); typed(q, s, 1.1, 34); show(w, s, 3.6) }</script>` },
    { id: 'c-turn', d: 3.6, html: `<style>${base} h1 { font-size: 56px; font-weight: 400; letter-spacing: -0.02em; line-height: 1.15; }</style>
      <div class="bg"></div>
      <div class="center"><h1 class="in" id="a">Two of seven models learned this.</h1>
        <h1 class="in" id="c" style="color:#b4b4bb">The other five almost never did.</h1></div>${anim}
      <script>window.render = (s) => { show(a, s, 0.2); show(c, s, 1.3) }</script>` },
    { id: 'c-chart', d: 5.6, html: `<style>${base}
        .l { position: absolute; left: 64px; top: 0; bottom: 0; width: 380px; display: flex; flex-direction: column; justify-content: center; }
        h2 { font-size: 40px; font-weight: 400; line-height: 1.15; letter-spacing: -0.01em; }
        .key { margin-top: 26px; font-size: 18px; line-height: 2; color: #b4b4bb; }
        .sw { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-right: 10px; vertical-align: -1px; }
        .g { position: absolute; right: 48px; top: 50%; width: 760px; transform-origin: 30% 30%; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.6); }
        .g img { display: block; width: 100%; }</style>
      <div class="l"><div class="mono in" id="k" style="font-size:16px;color:#e8cf8f;letter-spacing:.08em">EVERY PYRE, EVERY GROUP</div>
        <h2 class="in" id="a" style="margin-top:14px">Each square is one Bone Pyre, in order, pull by pull.</h2>
        <div class="key in" id="c"><div><span class="sw" style="background:#f3c969"></span>two or more inside: soaked</div>
          <div><span class="sw" style="background:#b3307a"></span>one player: not enough</div><div><span class="sw" style="background:#3a2452"></span>nobody inside</div></div></div>
      <div class="g in" id="g"><img src="data:image/png;base64,${grid}"></div>${anim}
      <script>window.render = (s) => { show(k, s, 0.1); show(a, s, 0.3); show(c, s, 1.0);
        const u = ease(s / 0.6); g.style.opacity = u; g.style.transform = 'translateY(-50%) scale(' + (1 + 0.05 * s / 5.6) + ') translateY(' + (1 - u) * 14 + 'px)' }</script>` },
    { id: 'c-end', d: 5.0, html: `<style>${base}
        .c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
        .logo { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 500; } .logo .dia { width: 18px; height: 18px; }
        h1 { margin-top: 30px; font-size: 58px; font-weight: 400; letter-spacing: -0.02em; }
        .st { margin-top: 26px; font-size: 21px; color: #b4b4bb; letter-spacing: .02em; }
        .url { margin-top: 44px; font-size: 30px; color: #e8cf8f; font-weight: 500; }
        .sm { margin-top: 12px; font-size: 18px; color: #8a8a93; }</style>
      <div class="bg"></div>
      <div class="c"><div class="logo in" id="l"><span class="dia"></span>MythicBench</div>
        <h1 class="in" id="a">Can five AI agents learn from a wipe?</h1>
        <div class="st mono in" id="s">7 models · 4 labs · 480 attempts · 0 clears</div>
        <div class="url in" id="u">mythicbench.com</div>
        <div class="sm in" id="m">Every pull is a 3D replay, with every agent's orders, chat and reasoning.</div></div>${anim}
      <script>window.render = (s) => { show(l, s, 0.1); show(a, s, 0.4); show(s_, s, 1.2); show(u, s, 1.9); show(m, s, 2.3) }; const s_ = document.getElementById('s')</script>` },
  ]
}

async function renderCard(b, c, times) {
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${c.html}</body></html>`)
  await page.waitForTimeout(300)
  const dir = join(WORK, c.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const n = Math.round(c.d * FPS)
  for (const i of times ?? Array.from({ length: n }, (_, i) => i)) {
    await page.evaluate((s) => window.render(s), i / FPS)
    writeFileSync(join(dir, `${String(i).padStart(5, '0')}.jpg`), await page.screenshot({ type: 'jpeg', quality: 94 }))
  }
  await page.close()
  return n
}

async function pyreGrid(b) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 120_000 })
  const card = page.locator('section', { has: page.locator('h2', { hasText: 'Learning to stand in the fire' }) }).locator('div.rounded-2xl').first()
  await card.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  const png = (await card.screenshot()).toString('base64')
  await page.close()
  return png
}

const ORDER = ['c-intro', 'blind', 'c-debrief', 'learned', 'c-turn', 'never', 'c-chart', 'c-end']

async function launchVideo() {
  const preview = !!process.env.MB_PREVIEW
  mkdirSync(WORK, { recursive: true })
  const b = await launch()
  const len = {}
  for (const [id, sh] of Object.entries(SHOTS).filter(([id]) => !process.env.MB_ONLY || process.env.MB_ONLY === id)) {
    const n = Math.round((sh.to - sh.from) * FPS)
    const boomI = Math.round((sh.booms[0].t - sh.from) * FPS)
    len[id] = await renderShot(b, id, sh, preview ? [0, Math.round(n / 3), boomI + 3, n - 1] : null)
    console.log(`\r${id}: done                                  `)
  }
  const bg = readFileSync(join(WORK, 'blind', '00000.jpg')).toString('base64')
  const grid = await pyreGrid(b)
  for (const c of cards(bg, grid)) {
    len[c.id] = await renderCard(b, c, preview ? [Math.round(c.d * FPS * 0.95)] : null)
  }
  await b.close()
  if (preview) { console.log(`preview stills in ${WORK}`); return }

  // Encode each segment, then chain crossfades.
  for (const id of ORDER) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(WORK, id, '%05d.jpg'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '14', '-preset', 'medium', join(WORK, `${id}.mp4`)])
  }
  const inputs = ORDER.flatMap((id) => ['-i', join(WORK, `${id}.mp4`)])
  let chain = ''
  let prev = '[0:v]'
  let acc = len[ORDER[0]] / FPS
  for (let k = 1; k < ORDER.length; k++) {
    const out = k === ORDER.length - 1 ? '[v]' : `[x${k}]`
    chain += `${prev}[${k}:v]xfade=transition=fade:duration=${XFADE}:offset=${(acc - XFADE).toFixed(3)}${out};`
    acc += len[ORDER[k]] / FPS - XFADE
    prev = out
  }
  const out = join(MEDIA, 'launch', 'mythicbench-launch.mp4')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', chain.replace(/;$/, ''), '-map', '[v]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-r', String(FPS), '-movflags', '+faststart', out])
  rmSync(WORK, { recursive: true, force: true })
  console.log(`wrote media/launch/mythicbench-launch.mp4 (${acc.toFixed(1)} s)`)
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'og') await og()
else if (cmd === 'clips') await clips(rest)
else if (cmd === 'launch') await launchVideo()
else { console.error('usage: node scripts/media.mjs og | clips [id..] | launch'); process.exit(1) }
