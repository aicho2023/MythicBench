// The orders panel: what an agent replies, as controls. A move (stay, "safe",
// the next waypoint, stop, or a spot tapped on the floor), a priority list of
// [ability, target] used top to bottom, and an optional line of party chat.
// "Keep orders" sends {} (no change), as an agent may.
//
// Enemies are told apart by number: the same number is on their nameplate in
// the scene (scene/picking.ts). Pointing at a target here, or at a unit in the
// scene, rings it on the floor (PickLayer).
import { ArrowUp, Eye, MapPin, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CLASS_COLORS } from '../content/display'
import { AbilityIcon } from '../hud/bits'
import type { ReplayState } from '../replay/engine'
import { usePlayback } from '../replay/store'
import type { Replay } from '../replay/types'
import { enemyTags, picking } from '../scene/picking'
import type { Ask, Obs } from './sim'
import { ordersText, usePlay } from './store'

const SELF_KINDS = new Set(['buff', 'taunt', 'aoe_damage', 'raid_heal'])
const ALLY_KINDS = new Set(['heal', 'hot', 'absorb'])
const CHAT_MAX = 120
const PLAYER_RADIUS = 0.5
/** How far from the tank before the panel says the party is moving on without you. */
const LEFT_BEHIND_M = 14

/** The live world state the panel reads: every unit seen so far (adds included). */
function useWorld(): ReplayState | null {
  const engine = usePlayback((p) => p.engine)
  return useMemo(() => (engine ? engine.stateAt(engine.duration) : null), [engine])
}

/** Unit and ability ids as names; enemies carry their number ("Risen Bonewalker 3"). */
export function useNames(replay: Replay | null, world?: ReplayState | null) {
  return useMemo(() => {
    const m: Record<string, string> = {}
    for (const [k, a] of Object.entries(replay?.abilities ?? {})) m[k] = a.name
    const units = world ? Object.values(world.units).map((u) => u.info) : replay?.units ?? []
    const tags = world ? enemyTags(world) : {}
    for (const u of units) m[u.id] = tags[u.id] ? `${u.name} ${tags[u.id]}` : u.name
    return m
  }, [replay, world])
}

export function nice(text: string, names: Record<string, string>): string {
  const s = text.replace(/\b[a-z][a-z0-9_]*\b/g, (w) => names[w] ?? w)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

interface Target { id: string; name: string; tag?: string; sub: string; warn?: string; color: string }

/** The targets an ability can take now: allies for heals, else enemies (fighting first, then by number). */
function targetsFor(kind: string, obs: Obs, world: ReplayState, names: Record<string, string>, range: number | undefined): Target[] {
  const here = obs.self.pos
  const gap = (id: string, p: [number, number]) => Math.hypot(p[0] - here[0], p[1] - here[1]) - PLAYER_RADIUS - (world.units[id]?.info.radius ?? PLAYER_RADIUS)
  const reach = (id: string, p: [number, number]) => {
    if (range == null) return undefined
    const g = gap(id, p)
    return g > range ? `out of range (${Math.round(g)} m)` : undefined
  }
  if (ALLY_KINDS.has(kind)) {
    return obs.party.filter((p) => p.alive).map((p) => ({
      id: p.id, name: names[p.id] ?? p.id, sub: `${Math.round(p.hp_pct)}%`, warn: p.id === obs.self.id ? undefined : reach(p.id, p.pos), color: CLASS_COLORS[p.class],
    }))
  }
  const tags = enemyTags(world)
  const num = (id: string) => Number(tags[id] ?? 999)
  const fighting = obs.enemies.filter((e) => e.alive && e.engaged !== false).sort((a, b) => num(a.id) - num(b.id))
  // Not pulled yet: the nearest pack (and Oruth), so the list stays short.
  const idle = obs.enemies.filter((e) => e.alive && e.engaged === false).sort((a, b) => gap(a.id, a.pos) - gap(b.id, b.pos)).slice(0, fighting.length ? 3 : 6)
  return [...fighting, ...idle].map((e) => {
    const c = e.casting
    return {
      id: e.id, name: world.units[e.id]?.info.name ?? e.name, tag: tags[e.id],
      sub: e.engaged === false ? 'not pulled' : `${Math.round(e.hp_pct)}%`,
      warn: c?.interruptible ? `casting ${names[c.ability] ?? c.ability}` : reach(e.id, e.pos),
      color: e.role === 'boss' ? '#7dd3fc' : '#f87171',
    }
  })
}

function Tag({ tag, boss }: { tag?: string; boss?: boolean }) {
  if (!tag && !boss) return null
  return (
    <span className="grid h-[18px] min-w-[18px] place-items-center rounded px-1 font-mono text-[11px] leading-none text-[#fca5a5] ring-1 ring-inset ring-[rgba(252,165,165,0.6)]">
      {boss ? 'B' : tag}
    </span>
  )
}

export function Orders({ onAiView }: { onAiView: () => void }) {
  const ask = usePlay((s) => s.ask)
  const busy = usePlay((s) => s.busy)
  const seat = usePlay((s) => s.seat)
  const move = usePlay((s) => s.move)
  const setMove = usePlay((s) => s.setMove)
  const adding = usePlay((s) => s.adding)
  const setAdding = usePlay((s) => s.setAdding)
  const hover = usePlay((s) => s.hover)
  const setHover = usePlay((s) => s.setHover)
  const ranges = usePlay((s) => s.ranges)
  const send = usePlay((s) => s.send)
  const auto = usePlay((s) => s.auto)
  const setAuto = usePlay((s) => s.setAuto)
  const replay = usePlayback((p) => p.engine?.replay ?? null)
  const caught = usePlayback((p) => !!p.engine && p.t >= p.engine.duration - 1)
  const speed = usePlayback((p) => p.speed)
  const setSpeed = usePlayback((p) => p.setSpeed)
  const world = useWorld()
  const names = useNames(replay, world)
  const tags = useMemo(() => (world ? enemyTags(world) : {}), [world])

  const [priority, setPriority] = useState<[string, string][] | null>(null)
  const [say, setSay] = useState('')
  // A new decision: start from the current orders.
  useEffect(() => { setMove(null); setPriority(null); setSay(''); setAdding(null) }, [ask, setMove, setAdding])

  const active = !!ask && !busy && caught
  const list = priority ?? ask?.orders?.priority ?? []
  const me = replay?.units.find((u) => u.id === seat)
  const cls = me ? replay?.classes[me.class] : null
  const color = me ? CLASS_COLORS[me.class] : '#fff'
  const changed = move !== null || priority !== null || !!say.trim()
  const obs = ask?.obs

  const go = () => { if (active) void send(changed ? ordersText({ move, priority, say }) : '{}') }
  const keep = () => { if (active) void send('{}') }
  const add = (ab: string, tgt: string) => {
    setPriority([...list.filter((e) => !(e[0] === ab && e[1] === tgt)), [ab, tgt]])
    setAdding(null)
    setHover(null)
  }
  const pick = (ab: string) => {
    const kind = replay?.abilities[ab]?.kind ?? ''
    if (SELF_KINDS.has(kind)) add(ab, seat)
    else setAdding(adding === ab ? null : ab)
  }
  const targets = (ab: string) => (obs && world ? targetsFor(replay?.abilities[ab]?.kind ?? '', obs, world, names, ranges[ab]) : [])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); go() }
        return
      }
      if (!active) return
      const k = Number(e.key)
      if (e.key === ' ') { e.preventDefault(); keep() }
      else if (e.key === 'Enter') { e.preventDefault(); go() }
      else if (e.key === 'Escape') { setAdding(null); setHover(null) }
      else if (k >= 1 && cls && k <= cls.abilities.length) pick(cls.abilities[k - 1])
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  // The scene: pointing at a unit rings it; while choosing a target, a tap on one picks it.
  useEffect(() => {
    if (!active) { picking.unit = null; picking.hover = null; return }
    const ok = new Set(adding ? targets(adding).map((t) => t.id) : [])
    picking.hover = (id) => {
      setHover(id && (!adding || ok.has(id)) ? id : null)
      document.body.style.cursor = id && adding && ok.has(id) ? 'pointer' : ''
    }
    picking.unit = adding ? (id) => { if (ok.has(id)) add(adding, id) } : null
    return () => { picking.unit = null; picking.hover = null; document.body.style.cursor = '' }
  })

  const why = ask ? ask.why.map((w) => nice(w, names)).join('; ') : ''
  const routine = ask?.why.length === 1 && ask.why[0] === 'routine check-in'
  // A new player often stands still while the bots walk on: say so.
  const tank = obs?.party.find((p) => p.id === 'rook')
  const behind = !!(active && obs && tank?.alive && seat !== 'rook' && move === null && !obs.self.moving
    && Math.hypot(tank.pos[0] - obs.self.pos[0], tank.pos[1] - obs.self.pos[1]) > LEFT_BEHIND_M)
  const hoverProps = (id: string) => ({ onMouseEnter: () => setHover(id), onMouseLeave: () => setHover(null), onFocus: () => setHover(id), onBlur: () => setHover(null) })

  return (
    <div className={`card pointer-events-auto w-full max-w-[780px] transition-[border-color] ${active ? 'border-white/20' : ''}`}>
      {/* Status */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
        <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: active ? color : undefined }}>
          <span className={`h-2 w-2 rounded-full ${active ? 'animate-pulse' : 'opacity-40'}`} style={{ background: color }} aria-hidden />
          {active ? `Your move, ${names[seat]}` : 'Playing'}
        </span>
        {active && <span className={`order-last min-w-0 basis-full text-[13px] sm:order-none sm:basis-auto sm:flex-1 sm:truncate ${routine ? 'text-fg-faint' : 'text-fg'}`} title={why}>{why}</span>}
        <span className={`flex-1 ${active ? 'sm:hidden' : ''}`} />
        {!caught && <button className="btn h-7 px-2 text-[12px]" onClick={() => usePlayback.setState({ t: usePlayback.getState().engine?.duration ?? 0 })}>{ask ? 'Skip to my move' : 'Skip to the end'}</button>}
        <div className="seg" role="group" aria-label="Speed">
          {[1, 2, 4].map((v) => <button key={v} aria-pressed={speed === v} onClick={() => setSpeed(v)}>{v}×</button>)}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-fg-muted" title="At a routine check-in (nothing new happened), keep your orders and play on.">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[#ededef]" />
          <span className="hidden sm:inline">Skip routine check-ins</span><span className="sm:hidden">Skip routine</span>
        </label>
        <button className="icon-btn" onClick={onAiView} title="What the AI sees" aria-label="What the AI sees"><Eye size={16} /></button>
      </div>

      <fieldset disabled={!active} className={`space-y-3 px-3 py-3 transition-opacity ${active ? '' : 'opacity-50'}`}>
        {/* Move */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-[64px] shrink-0 text-[12px] text-fg-faint">Move</span>
          <div className="seg" role="group" aria-label="Move">
            {([[null, 'Stay'], ['safe', 'Safe spot'], ['next', 'Next waypoint'], ['stop', 'Stop']] as const).map(([v, label]) => (
              <button key={label} aria-pressed={move === v} onClick={() => setMove(v)}
                title={v === 'safe' ? 'Step to the nearest spot clear of harmful pools, keeping your first target in range' : v === 'next' ? 'Walk to the next waypoint toward the boss' : v === 'stop' ? 'Stop where you are' : 'No new move (a move under way carries on)'}>
                {label}
              </button>
            ))}
          </div>
          <span className={`flex items-center gap-1.5 text-[12px] ${Array.isArray(move) ? 'text-good' : 'text-fg-faint'}`}>
            <MapPin size={13} />
            {Array.isArray(move) ? <>To ({move[0].toFixed(1)}, {move[1].toFixed(1)}) <button onClick={() => setMove(null)} className="text-fg-faint hover:text-fg" aria-label="Clear the spot"><X size={12} /></button></> : 'or tap the floor'}
          </span>
          {behind && <span className="basis-full text-[12px] text-warn sm:basis-auto">Your party is moving on without you.</span>}
        </div>

        {/* Priority */}
        <div className="flex items-start gap-2">
          <span className="w-[64px] shrink-0 pt-1.5 text-[12px] text-fg-faint" title="Every tick your character uses the first entry that is ready">Priority</span>
          <div className="min-w-0 flex-1">
            <ol className="flex flex-wrap gap-1.5">
              {list.length === 0 && <li className="py-1.5 text-[12px] text-fg-faint">Nothing yet. Add abilities below: the first one that's ready is used, every tick.</li>}
              {list.map(([ab, tgt], i) => (
                <li key={`${ab}-${tgt}`} {...hoverProps(tgt)}
                  className={`flex items-center gap-1.5 rounded-lg border py-1 pl-1 pr-1.5 text-[12px] ${hover === tgt ? 'border-white/30 bg-white/[0.08]' : 'border-line bg-white/[0.04]'}`}>
                  <span className="num w-3 text-center font-mono text-fg-faint">{i + 1}</span>
                  <AbilityIcon ability={ab} info={replay?.abilities[ab]} size={20} />
                  <span className="text-fg">{names[ab] ?? ab}</span>
                  <span className="text-fg-faint">on</span>
                  <Tag tag={tags[tgt]} boss={tgt === 'oruth'} />
                  <span className="text-fg-muted">{tgt === seat ? 'self' : world?.units[tgt]?.info.name ?? tgt}</span>
                  {world?.units[tgt] && !world.units[tgt].alive && <span className="text-fg-faint">(dead)</span>}
                  {i > 0 && <button onClick={() => { const l = [...list]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; setPriority(l) }} className="text-fg-faint hover:text-fg" aria-label="Move up" title="Use before the one above"><ArrowUp size={12} /></button>}
                  <button onClick={() => setPriority(list.filter((_, k) => k !== i))} className="text-fg-faint hover:text-fg" aria-label="Remove"><X size={12} /></button>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(cls?.abilities ?? []).map((ab, k) => {
                const info = replay?.abilities[ab]
                const left = obs?.self.cooldowns?.[ab] ?? 0
                return (
                  <button key={ab} onClick={() => pick(ab)} aria-pressed={adding === ab}
                    className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[12px] transition-colors ${adding === ab ? 'border-white/30 bg-white/[0.08] text-fg' : 'border-line text-fg-muted hover:border-white/20 hover:text-fg'}`}
                    title={`${info?.description ?? ''} (key ${k + 1})`}>
                    <AbilityIcon ability={ab} info={info} size={20} remainingMs={left} totalMs={info?.cooldown_ms ?? 0} title="" />
                    {info?.name ?? ab}
                    {left > 0 && <span className="num font-mono text-[11px] text-fg-faint">{(left / 1000).toFixed(0)}s</span>}
                    <span className="hidden font-mono text-[11px] text-fg-faint lg:inline">{k + 1}</span>
                  </button>
                )
              })}
            </div>
            {adding && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-fg-faint">{names[adding]} on <span className="hidden sm:inline">(or click one in the scene)</span>:</span>
                {targets(adding).map((t) => (
                  <button key={t.id} onClick={() => add(adding, t.id)} {...hoverProps(t.id)}
                    className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[12px] text-fg transition-colors ${hover === t.id ? 'border-white/40 bg-white/[0.08]' : 'border-line hover:border-white/25'}`}>
                    {t.tag || t.id === 'oruth' ? <Tag tag={t.tag} boss={t.id === 'oruth'} /> : <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} aria-hidden />}
                    {t.name}
                    <span className="text-fg-faint">{t.sub}</span>
                    {t.warn && <span className={t.warn.startsWith('casting') ? 'text-warn' : 'text-bad'}>{t.warn}</span>}
                  </button>
                ))}
                {targets(adding).length === 0 && <span className="text-[12px] text-fg-faint">nothing in sight</span>}
              </div>
            )}
          </div>
        </div>

        {/* Say + send */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-[64px] shrink-0 text-[12px] text-fg-faint">Say</span>
          <input value={say} onChange={(e) => setSay(e.target.value.slice(0, CHAT_MAX))} placeholder="Party chat (optional)"
            className="h-8 min-w-[160px] flex-1 rounded-lg border border-line bg-white/[0.03] px-2.5 text-[13px] text-fg placeholder:text-fg-faint focus:border-white/25 focus:outline-none" />
          <button className="btn" onClick={keep} title="Space">Keep orders</button>
          <button className="btn btn-primary" onClick={go} title="Enter">{changed ? 'Send orders' : 'Go'}</button>
        </div>
      </fieldset>
    </div>
  )
}

/** The agent's view: the state text for this moment, and the rules. */
export function AiView({ ask, rules, onClose }: { ask: Ask | null; rules: string; onClose: () => void }) {
  const [tab, setTab] = useState<'state' | 'rules'>('state')
  return (
    <div className="pointer-events-auto absolute inset-y-4 right-4 z-30 flex w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-line bg-[rgba(14,14,16,0.97)] shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-fg">What the AI sees</div>
          <div className="text-[12px] text-fg-muted">The models got exactly this text, and replied in JSON. You get the same pauses.</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="px-4 pt-3">
        <div className="seg w-fit" role="group">
          <button aria-pressed={tab === 'state'} onClick={() => setTab('state')}>This moment</button>
          <button aria-pressed={tab === 'rules'} onClick={() => setTab('rules')}>The rules</button>
        </div>
      </div>
      <pre className="m-4 mt-3 flex-1 overflow-auto whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 font-mono text-[12px] leading-5 text-fg-muted">
        {tab === 'state' ? ask?.prompt ?? 'Waiting for the next decision.' : rules}
      </pre>
    </div>
  )
}
