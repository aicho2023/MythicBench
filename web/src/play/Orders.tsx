// The orders panel: what an agent replies, as controls. A move (stay, "safe",
// the next waypoint, stop, or a spot tapped on the floor), a priority list of
// [ability, target] used top to bottom, and an optional line of party chat.
// "Keep orders" sends {} (no change), as an agent may.
import { ArrowUp, Eye, MapPin, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CLASS_COLORS } from '../content/display'
import { AbilityIcon } from '../hud/bits'
import { usePlayback } from '../replay/store'
import { picking } from '../scene/picking'
import type { Replay } from '../replay/types'
import type { Ask } from './sim'
import { ordersText, usePlay } from './store'

const SELF_KINDS = new Set(['buff', 'taunt', 'aoe_damage', 'raid_heal'])
const ALLY_KINDS = new Set(['heal', 'hot', 'absorb'])
const CHAT_MAX = 120

type Move = null | 'safe' | 'next' | 'stop' | [number, number]

/** Unit and ability ids in the agent's text, as names. */
export function useNames(replay: Replay | null) {
  return useMemo(() => {
    const m: Record<string, string> = {}
    for (const u of replay?.units ?? []) m[u.id] = u.name
    for (const [k, a] of Object.entries(replay?.abilities ?? {})) m[k] = a.name
    return m
  }, [replay])
}

export function nice(text: string, names: Record<string, string>): string {
  const s = text.replace(/\b[a-z][a-z_]*\d*\b/g, (w) => names[w] ?? w)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function Orders({ onAiView }: { onAiView: () => void }) {
  const ask = usePlay((s) => s.ask)
  const busy = usePlay((s) => s.busy)
  const seat = usePlay((s) => s.seat)
  const marker = usePlay((s) => s.marker)
  const setMarker = usePlay((s) => s.setMarker)
  const send = usePlay((s) => s.send)
  const auto = usePlay((s) => s.auto)
  const setAuto = usePlay((s) => s.setAuto)
  const replay = usePlayback((p) => p.engine?.replay ?? null)
  const caught = usePlayback((p) => !!p.engine && p.t >= p.engine.duration - 1)
  const speed = usePlayback((p) => p.speed)
  const setSpeed = usePlayback((p) => p.setSpeed)
  const names = useNames(replay)

  const [move, setMove] = useState<Move>(null)
  const [priority, setPriority] = useState<[string, string][] | null>(null)
  const [say, setSay] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  // A new decision: start from the current orders.
  useEffect(() => { setMove(null); setPriority(null); setSay(''); setAdding(null) }, [ask])
  useEffect(() => { if (marker) setMove(marker) }, [marker])

  const active = !!ask && !busy && caught
  const list = priority ?? ask?.orders?.priority ?? []
  const me = replay?.units.find((u) => u.id === seat)
  const cls = me ? replay?.classes[me.class] : null
  const color = me ? CLASS_COLORS[me.class] : '#fff'
  const changed = move !== null || priority !== null || !!say.trim()

  const reply = () => ordersText({ move, priority, say })
  const go = () => { if (active) void send(changed ? reply() : '{}') }
  const keep = () => { if (active) void send('{}') }

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); go() }
        return
      }
      if (e.key === ' ') { e.preventDefault(); keep() }
      else if (e.key === 'Enter') { e.preventDefault(); go() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const obs = ask?.obs
  const setList = (l: [string, string][]) => setPriority(l)
  const add = (ab: string, tgt: string) => {
    const l = list.filter((e) => !(e[0] === ab && e[1] === tgt))
    setList([...l, [ab, tgt]])
    setAdding(null)
  }
  const pick = (ab: string) => {
    const kind = replay?.abilities[ab]?.kind ?? ''
    if (SELF_KINDS.has(kind)) add(ab, seat)
    else setAdding(adding === ab ? null : ab)
  }
  const targets = (ab: string) => {
    const kind = replay?.abilities[ab]?.kind ?? ''
    if (!obs) return []
    if (ALLY_KINDS.has(kind)) return obs.party.filter((p) => p.alive).map((p) => ({ id: p.id, label: names[p.id] ?? p.id, sub: `${Math.round(p.hp_pct)}%`, color: CLASS_COLORS[p.class] }))
    const here = obs.self.pos
    const far = (p: [number, number]) => Math.hypot(p[0] - here[0], p[1] - here[1])
    // Fighting first, then the nearest; several of one kind are told apart by their number.
    return obs.enemies.filter((e) => e.alive)
      .sort((a, b) => Number(b.engaged !== false) - Number(a.engaged !== false) || far(a.pos) - far(b.pos))
      .slice(0, 8)
      .map((e) => {
        const n = /_(\d+)$/.exec(e.id)?.[1]
        const casting = e.casting ? `, casting ${names[e.casting.ability] ?? e.casting.ability}` : ''
        return { id: e.id, label: `${e.name}${n ? ` ${n}` : ''}`, sub: e.engaged === false ? `not pulled, ${far(e.pos).toFixed(0)} m` : `${Math.round(e.hp_pct)}%${casting}`, color: e.role === 'boss' ? '#7dd3fc' : '#f87171' }
      })
  }
  // While choosing a target, a tap on a unit in the scene picks it.
  useEffect(() => {
    if (!adding || !active) { picking.unit = null; return }
    const ok = new Set(targets(adding).map((t) => t.id))
    picking.unit = (id) => { if (ok.has(id)) add(adding, id) }
    return () => { picking.unit = null }
  })
  const cd = (ab: string) => obs?.self.cooldowns?.[ab] ?? 0

  const why = ask ? ask.why.map((w) => nice(w, names)).join('; ') : ''
  const routine = ask?.why.length === 1 && ask.why[0] === 'routine check-in'

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
              <button key={label} aria-pressed={move === v} onClick={() => { setMove(v); setMarker(null) }}
                title={v === 'safe' ? 'Step to the nearest spot clear of harmful pools, keeping your first target in range' : v === 'next' ? 'Walk to the next waypoint toward the boss' : v === 'stop' ? 'Stop where you are' : 'No new move (a move under way carries on)'}>
                {label}
              </button>
            ))}
          </div>
          <span className={`flex items-center gap-1.5 text-[12px] ${Array.isArray(move) ? 'text-good' : 'text-fg-faint'}`}>
            <MapPin size={13} />
            {Array.isArray(move) ? <>To ({move[0].toFixed(1)}, {move[1].toFixed(1)}) <button onClick={() => { setMove(null); setMarker(null) }} className="text-fg-faint hover:text-fg" aria-label="Clear the spot"><X size={12} /></button></> : 'or tap the floor'}
          </span>
        </div>

        {/* Priority */}
        <div className="flex items-start gap-2">
          <span className="w-[64px] shrink-0 pt-1.5 text-[12px] text-fg-faint" title="Every tick your character uses the first entry that is ready">Priority</span>
          <div className="min-w-0 flex-1">
            <ol className="flex flex-wrap gap-1.5">
              {list.length === 0 && <li className="py-1.5 text-[12px] text-fg-faint">Nothing yet. Add abilities below: the first one that's ready is used, every tick.</li>}
              {list.map(([ab, tgt], i) => (
                <li key={`${ab}-${tgt}`} className="flex items-center gap-1.5 rounded-lg border border-line bg-white/[0.04] py-1 pl-1 pr-1.5 text-[12px]">
                  <span className="num w-3 text-center font-mono text-fg-faint">{i + 1}</span>
                  <AbilityIcon ability={ab} info={replay?.abilities[ab]} size={20} />
                  <span className="text-fg">{names[ab] ?? ab}</span>
                  <span className="text-fg-faint">on</span>
                  <span className="text-fg-muted">{tgt === seat ? 'self' : names[tgt] ?? tgt}</span>
                  {i > 0 && <button onClick={() => { const l = [...list]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; setList(l) }} className="text-fg-faint hover:text-fg" aria-label="Move up" title="Use before the one above"><ArrowUp size={12} /></button>}
                  <button onClick={() => setList(list.filter((_, k) => k !== i))} className="text-fg-faint hover:text-fg" aria-label="Remove"><X size={12} /></button>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(cls?.abilities ?? []).map((ab) => {
                const info = replay?.abilities[ab]
                const left = cd(ab)
                return (
                  <button key={ab} onClick={() => pick(ab)} aria-pressed={adding === ab}
                    className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 text-[12px] transition-colors ${adding === ab ? 'border-white/30 bg-white/[0.08] text-fg' : 'border-line text-fg-muted hover:border-white/20 hover:text-fg'}`}
                    title={info?.description}>
                    <AbilityIcon ability={ab} info={info} size={20} remainingMs={left} totalMs={info?.cooldown_ms ?? 0} title="" />
                    {info?.name ?? ab}
                    {left > 0 && <span className="num font-mono text-[11px] text-fg-faint">{(left / 1000).toFixed(0)}s</span>}
                  </button>
                )
              })}
            </div>
            {adding && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-fg-faint">{names[adding]} on (or tap one in the scene):</span>
                {targets(adding).map((t) => (
                  <button key={t.id} onClick={() => add(adding, t.id)} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[12px] text-fg hover:border-white/25">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} aria-hidden />{t.label}<span className="text-fg-faint">{t.sub}</span>
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

/** The agent's view: the state text for this moment, the rules, and the reply as JSON. */
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
