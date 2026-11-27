/**
 * Floating combat text + nameplates.
 *
 * Rendered as plain HTML (crisp text, cheap) positioned every frame by
 * projecting 3D world points onto the screen with the scene's camera.
 * Like everything else, positions are a pure function of replay time.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { CLASS_COLORS, HOSTILE, SCHOOL_COLORS, fmtNum } from '../content/display'
import { posAt, bossOf } from '../replay/engine'
import { frameState } from '../replay/store'
import { sceneBridge } from '../scene/Scene'
import { ROLE_ICON, chatText } from './bits'
import { COLOR } from '../site/tokens'

const MAX_TEXT = 44
const MAX_PLATES = 16
const MAX_BUBBLES = 3 // the newest lines only: five at once cover the fight
const BUBBLE_MS = 4000 // a chat bubble stays up this long, fading over its last second
/** Bubbles never rise into the top band, where the warnings and banners sit (px). */
const BUBBLE_TOP = 150
const ABILITY_MS = 1200 // how long an instant ability's name shows under the caster's name
const TEXT_MS = 1100

const HOT_TICKS = new Set(['bloomward', 'radiant_afterglow'])
const HEAD: Record<string, number> = { boss: 6.4, add: 2.2, player: 2.55 }

/**
 * Nameplates that would overlap on screen stack upward instead, like an MMO's
 * stacking nameplates. The plate nearest the camera (lowest on screen) keeps
 * its spot.
 */
type Rect = { left: number; right: number; top: number; bottom: number }
function stackPlates(placed: { el: HTMLDivElement; x: number; y: number; drop?: boolean }[], avoid: Rect[] = []) {
  const boxes = placed.map((q) => ({ ...q, w: q.el.offsetWidth, h: q.el.offsetHeight }))
  boxes.sort((a, b) => b.y - a.y)
  const done: { x: number; y: number; w: number; h: number }[] = []
  for (const b of boxes) {
    let y = b.y
    for (let moved = true; moved;) {
      moved = false
      for (const d of done) {
        // anchors are bottom-centre: a box spans [x - w/2, x + w/2] x [y - h, y]
        if (Math.abs(b.x - d.x) < (b.w + d.w) / 2 && y > d.y - d.h && y - b.h < d.y) {
          y = d.y - d.h - 1
          moved = true
        }
      }
    }
    // A chat bubble pushed up into the top band is dropped rather than drawn over the HUD.
    // So is one that would land under a HUD panel (party frames, scorecard, chat log, controls).
    const under = (r: Rect) => b.x - b.w / 2 < r.right && b.x + b.w / 2 > r.left && y - b.h < r.bottom && y > r.top
    if (b.drop && (y - b.h < BUBBLE_TOP || avoid.some(under))) { b.el.style.display = 'none'; continue }
    done.push({ x: b.x, y, w: b.w, h: b.h })
    b.el.style.transform = `translate(${b.x}px, ${y}px) translate(-50%, -100%)`
  }
}

export function WorldOverlay() {
  const root = useRef<HTMLDivElement>(null)
  const texts = useRef<HTMLDivElement[]>([])
  const plates = useRef<HTMLDivElement[]>([])
  const bubbles = useRef<HTMLDivElement[]>([])
  const bossPlate = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raf = 0
    const v = new THREE.Vector3()
    const project = (x: number, y: number, z: number) => {
      const cam = sceneBridge.camera
      const el = root.current
      if (!cam || !el) return null
      v.set(x, y, z).project(cam)
      if (v.z > 1) return null
      return [((v.x + 1) / 2) * el.clientWidth, ((1 - v.y) / 2) * el.clientHeight] as const
    }
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const f = frameState()
      if (!f) return
      const { s, t, engine } = f

      // ---- what each player just used (ability names; auto attacks have no cast events)
      const used: Record<string, string> = {}
      for (const { e } of engine.eventsBetween(t - ABILITY_MS, t)) {
        if (e.type === 'cast_success' && s.units[e.unit]?.info.kind === 'player') used[e.unit] = e.ability
      }

      // ---- nameplates
      let p = 0
      const placed: { el: HTMLDivElement; x: number; y: number; drop?: boolean }[] = []
      for (const id of s.order) {
        const u = s.units[id]
        if (!u.alive || u.info.kind === 'boss' || p >= MAX_PLATES) continue
        const el = plates.current[p]
        if (!el) continue
        const pos = posAt(u, t)
        const sp = project(pos[0], HEAD[u.info.kind], pos[1])
        if (!sp) continue
        p++
        el.style.display = 'block'
        placed.push({ el, x: sp[0], y: sp[1] })
        const row = el.firstElementChild as HTMLElement
        const icons = row.firstElementChild as HTMLElement
        const name = row.lastElementChild as HTMLElement
        const bar = el.lastElementChild as HTMLElement
        const doing = el.children[1] as HTMLElement
        const player = u.info.kind === 'player'
        const casting = u.cast && !s.ended ? u.cast.ability : null
        const ab = casting ?? (player ? used[id] : undefined)
        const abInfo = ab ? engine.replay.abilities[ab] : undefined
        // Players: what they're casting or just used. Enemies: their cast, marked when it can be kicked.
        const doingText = !abInfo ? '' : player ? (casting ? `Casting ${abInfo.name}` : abInfo.name)
          : `${abInfo.name}${u.cast?.interruptible ? ' (kick)' : ''}`
        if (doing.textContent !== doingText) doing.textContent = doingText
        doing.style.display = doingText ? 'block' : 'none'
        if (abInfo) doing.style.color = player ? SCHOOL_COLORS[abInfo.school] ?? COLOR.fg : u.cast?.interruptible ? COLOR.warn : HOSTILE
        const label = u.info.kind === 'player' ? u.info.name : ''
        if (name.textContent !== label) name.textContent = label
        const role = u.info.kind === 'player' ? u.info.role : ''
        if (icons.dataset.role !== role) {
          icons.dataset.role = role
          for (const c of Array.from(icons.children) as HTMLElement[]) c.style.display = c.dataset.role === role ? 'inline-flex' : 'none'
        }
        name.style.color = u.info.kind === 'player' ? CLASS_COLORS[u.info.class] : HOSTILE
        const showBar = u.info.kind !== 'player'
        bar.style.display = showBar ? 'block' : 'none'
        if (showBar) (bar.firstElementChild as HTMLElement).style.width = `${(100 * u.hp) / u.info.max_hp}%`
        bar.style.width = '64px'
      }
      for (let i = p; i < MAX_PLATES; i++) if (plates.current[i]) plates.current[i].style.display = 'none'

      // ---- the boss's nameplate: health and cast bar over his head, as in the game
      const bp = bossPlate.current
      const boss = bossOf(s)
      const bsp = boss?.alive ? (() => { const bpos = posAt(boss, t); return project(bpos[0], HEAD.boss, bpos[1]) })() : null
      if (bp && boss && bsp) {
        bp.style.display = 'block'
        // Over his head, as in the game, unless that lands under the HUD warnings at the top of the
        // screen (Oruth near the top edge): then under his feet instead, where nothing covers it.
        const origin = root.current?.getBoundingClientRect()
        const warn = document.querySelector<HTMLElement>('.viewer [data-hud="warnings"]')?.getBoundingClientRect()
        const w2 = bp.offsetWidth / 2
        const blocked = !!(origin && warn && warn.height > 0
          && bsp[0] - w2 < warn.right - origin.left && bsp[0] + w2 > warn.left - origin.left
          && bsp[1] - bp.offsetHeight < warn.bottom - origin.top + 6)
        const bpos = posAt(boss, t)
        const feet = blocked ? project(bpos[0], 0, bpos[1]) : null
        placed.push(feet ? { el: bp, x: feet[0], y: feet[1] + 12 + bp.offsetHeight } : { el: bp, x: bsp[0], y: bsp[1] })
        const q = (k: string) => bp.querySelector(`[data-k="${k}"]`) as HTMLElement
        if (q('name').textContent !== boss.info.name) q('name').textContent = boss.info.name
        const pct = boss.hp >= boss.info.max_hp ? '100%' : `${((100 * boss.hp) / boss.info.max_hp).toFixed(1)}%`
        if (q('pct').textContent !== pct) q('pct').textContent = pct
        q('hp').style.width = `${(100 * boss.hp) / boss.info.max_hp}%`
        q('fury').style.display = boss.auras.hollow_fury ? 'inline' : 'none'
        const cast = s.ended ? null : boss.cast
        const castInfo = cast ? engine.replay.abilities[cast.ability] : null
        q('cast').style.display = cast && castInfo ? 'block' : 'none'
        if (cast && castInfo) {
          const fill = q('castfill')
          fill.style.width = `${Math.min(100, (100 * (t - cast.t0)) / cast.castMs)}%`
          fill.style.background = cast.interruptible ? 'rgba(251,191,36,0.9)' : 'rgba(161,161,170,0.75)'
          const label = `${castInfo.name}${cast.interruptible ? ' (kick)' : ''}`
          if (q('castname').textContent !== label) q('castname').textContent = label
          q('casttime').textContent = `${Math.max(0, (cast.t0 + cast.castMs - t) / 1000).toFixed(1)}`
        }
      } else if (bp) bp.style.display = 'none'

      // ---- chat bubbles: each player's latest party-chat line, over its head
      const said: Record<string, { text: string; t: number }> = {}
      for (const { e } of engine.eventsBetween(t - BUBBLE_MS, t)) if (e.type === 'chat') said[e.unit] = { text: chatText(s.units[e.unit]?.info.name ?? e.unit, e.text), t: e.t }
      const newest = Object.entries(said).sort((p, q) => q[1].t - p[1].t).slice(0, MAX_BUBBLES)
      let b = 0
      for (const [id, { text, t: at }] of newest) {
        const u = s.units[id]
        const el = bubbles.current[b]
        if (!u?.alive || !el) continue
        const pos = posAt(u, t)
        const sp = project(pos[0], HEAD.player + 0.9, pos[1])
        if (!sp) continue
        b++
        if (el.textContent !== text) el.textContent = text
        el.style.display = 'block'
        el.style.opacity = String(Math.min(1, (BUBBLE_MS - (t - at)) / 1000))
        placed.push({ el, x: sp[0], y: sp[1], drop: true })
      }
      for (let i = b; i < MAX_BUBBLES; i++) if (bubbles.current[i]) bubbles.current[i].style.display = 'none'
      // The HUD panels on screen, in this overlay's coordinates: chat bubbles stay out from under them.
      const origin = root.current?.getBoundingClientRect()
      const avoid = origin
        ? [...document.querySelectorAll<HTMLElement>('.viewer .card')].map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0).map((r) => ({ left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top }))
        : []
      stackPlates(placed, avoid)

      // ---- floating combat text
      const items: { i: number; x: number; y: number; z: number; age: number; text: string; color: string; size: number }[] = []
      for (const { e, i } of engine.eventsBetween(t - TEXT_MS, t)) {
        const age = t - e.t
        if (e.type === 'damage' || e.type === 'heal') {
          const tgt = s.units[e.target]
          if (!tgt) continue
          const toPlayer = tgt.info.kind === 'player'
          // Filter noise like an MMO player tunes combat text: no tiny ticks.
          if (e.amount <= 0) continue
          if (e.type === 'heal' && (e.amount < 1500 || HOT_TICKS.has(e.ability))) continue
          if (e.type === 'damage' && toPlayer && e.amount < 1500) continue
          const pos = posAt(tgt, t)
          const heal = e.type === 'heal'
          const text = heal ? `+${fmtNum(e.amount)}` : fmtNum(e.amount)
          const crit = e.crit
          items.push({
            i, x: pos[0], y: HEAD[tgt.info.kind] - (toPlayer ? 0.2 : tgt.info.kind === 'boss' ? 2.6 : 0.6), z: pos[1], age,
            text,
            color: heal ? COLOR.good : toPlayer ? COLOR.bad : crit ? COLOR.warn : '#ffffff',
            size: (toPlayer || heal ? 13 : 15) * (crit ? 1.45 : 1),
          })
        } else if (e.type === 'cast_interrupted' && e.reason === 'interrupt') {
          const u = s.units[e.unit]
          if (!u) continue
          const pos = posAt(u, t)
          items.push({ i, x: pos[0], y: u.info.kind === 'boss' ? 3.6 : 5.4, z: pos[1], age, text: 'Interrupted', color: COLOR.info, size: 20 })
        }
      }
      const shown = items.slice(-MAX_TEXT)
      let n = 0
      for (const it of shown) {
        const el = texts.current[n]
        if (!el) break
        const k = it.age / TEXT_MS
        const sp = project(it.x, it.y + k * 1.6, it.z)
        if (!sp) continue
        n++
        const jitter = (((it.i * 2654435761) >>> 0) % 70) - 35
        const pop = k < 0.12 ? 1.5 - (k / 0.12) * 0.5 : 1
        el.style.display = 'block'
        el.style.transform = `translate(${sp[0] + jitter}px, ${sp[1]}px) translate(-50%, -50%) scale(${pop})`
        el.style.opacity = String(k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1)
        el.style.color = it.color
        el.style.fontSize = `${it.size}px`
        if (el.textContent !== it.text) el.textContent = it.text
      }
      for (let i = n; i < MAX_TEXT; i++) if (texts.current[i]) texts.current[i].style.display = 'none'
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: MAX_PLATES }, (_, i) => (
        <div key={`p${i}`} ref={(el) => { if (el) plates.current[i] = el }} className="absolute left-0 top-0 hidden text-center">
          <div className="flex items-center justify-center gap-1 whitespace-nowrap font-sans text-[12px] font-medium [text-shadow:0_1px_2px_#000,0_0_3px_#000]">
            <span className="inline-flex [filter:drop-shadow(0_1px_1px_#000)]">
              {Object.entries(ROLE_ICON).map(([role, Icon]) => (
                <span key={role} data-role={role} style={{ display: 'none' }}>
                  <Icon size={12} strokeWidth={2} style={{ color: COLOR.fgMuted }} fill={role === 'healer' ? COLOR.fgMuted : 'none'} />
                </span>
              ))}
            </span>
            <span />
          </div>
          <div className="hidden whitespace-nowrap font-sans text-[11px] font-medium leading-[14px] [text-shadow:0_1px_2px_#000,0_0_3px_#000]" />
          <div className="mx-auto mt-0.5 h-[6px] overflow-hidden rounded-sm bg-black/80 ring-1 ring-black">
            <div className="h-full bg-bad" />
          </div>
        </div>
      ))}
      <div ref={bossPlate} className="absolute left-0 top-0 hidden w-[240px] font-sans [text-shadow:0_1px_2px_#000,0_0_3px_#000]">
        <div className="flex items-baseline justify-between gap-2 text-[13px] font-medium">
          <span style={{ color: HOSTILE }}><span data-k="name" /> <span data-k="fury" className="hidden text-[11px] text-bad">Enraged</span></span>
          <span data-k="pct" className="num font-mono text-[12px] text-white" />
        </div>
        <div className="mt-0.5 h-[9px] overflow-hidden rounded-sm bg-black/80 ring-1 ring-black">
          <div data-k="hp" className="h-full bg-bad" />
        </div>
        <div data-k="cast" className="mt-1 hidden">
          <div className="relative h-[16px] overflow-hidden rounded-sm bg-black/80 ring-1 ring-black">
            <div data-k="castfill" className="absolute inset-y-0 left-0" />
            <div className="absolute inset-0 flex items-center justify-between gap-2 px-1.5 text-[11px] font-medium text-white">
              <span data-k="castname" className="truncate" />
              <span data-k="casttime" className="num font-mono" />
            </div>
          </div>
        </div>
      </div>
      {Array.from({ length: MAX_BUBBLES }, (_, i) => (
        <div key={`b${i}`} ref={(el) => { if (el) bubbles.current[i] = el }}
          className="chat-bubble absolute left-0 top-0 hidden w-max max-w-[240px] rounded-lg bg-[rgba(12,12,14,0.86)] px-2 py-1 text-left font-sans text-[12px] leading-4 text-[#c9cfff] ring-1 ring-white/10" />
      ))}
      {Array.from({ length: MAX_TEXT }, (_, i) => (
        <div key={`t${i}`} ref={(el) => { if (el) texts.current[i] = el }}
          className="absolute left-0 top-0 num hidden whitespace-nowrap font-sans font-semibold [text-shadow:0_1px_2px_#000,0_0_4px_rgba(0,0,0,0.8)]" />
      ))}
    </div>
  )
}
