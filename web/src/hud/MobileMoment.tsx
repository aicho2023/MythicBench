// The viewer on phones (below 640px, see .phone-only in index.css): a one-row
// party strip instead of the full party card, and a "What happened here" bar that
// opens a drawer with the moment's evidence: the score so far, the last few key
// events, the party chat, and what each agent last ordered. The full scorecard,
// learning panel and decision log need a wider screen.
import { ChevronUp, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CLASS_COLORS, dungeonProgress, dungeonScore, fmtTime } from '../content/display'
import { bossOf, type ReplayEngine } from '../replay/engine'
import { usePlayback, useHud } from '../replay/store'
import { HIGHLIGHTS, highlightPath } from '../content/highlights'
import { useInspector } from './CallInspector'
import { Bar } from './bits'

const PARTY_CHAT = '#aab4ff'
/** How far back the drawer looks for key events and chat. */
const EVENTS_MS = 20000
const CHAT_MS = 45000

type Line = { t: number; text: string; tone: 'bad' | 'good' | 'plain' }

/** Key events (the timeline's markers, plus Pyres that were soaked) in (t0, t1]. */
function keyEvents(engine: ReplayEngine, markers: ReturnType<ReplayEngine['markers']>, t0: number, t1: number): Line[] {
  const names: Record<string, string> = Object.fromEntries(engine.replay.units.map((u) => [u.id, u.name]))
  const out: Line[] = markers.filter((m) => m.t > t0 && m.t <= t1)
    .map((m) => ({ t: m.t, text: m.label, tone: m.kind === 'pull' || m.kind === 'raise' ? 'plain' : m.kind === 'end' && m.label === 'Victory' ? 'good' : 'bad' }))
  for (const { e } of engine.eventsBetween(t0, t1)) {
    if (e.type === 'pyre_detonate' && e.soaked) out.push({ t: e.t, text: `Bone Pyre soaked by ${e.inside.map((u) => names[u]).join(', ')}`, tone: 'good' })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** One row of five: name, health and whether each character is alive. */
export function CompactParty() {
  const h = useHud()
  if (!h) return null
  const { s } = h
  const players = s.order.map((id) => s.units[id]).filter((u) => u.info.kind === 'player')
  return (
    <div className="pointer-events-auto grid grid-cols-5 gap-1 rounded-lg bg-[rgba(17,17,19,0.82)] p-1.5">
      {players.map((u) => (
        <div key={u.info.id} className={`min-w-0 ${u.alive ? '' : 'opacity-40'}`}>
          <div className="truncate text-[11px] font-medium leading-4" style={{ color: CLASS_COLORS[u.info.class] }}>{u.info.name}</div>
          <Bar frac={u.alive ? u.hp / u.info.max_hp : 0} color={CLASS_COLORS[u.info.class]} height={4} />
        </div>
      ))}
    </div>
  )
}

/** The bar above the transport: the latest thing that happened, and a way into the drawer. */
export function MomentBar() {
  const h = useHud()
  const markers = useMarkers()
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has('t'))
  if (!h) return null
  const { engine, t, s } = h
  const ev = keyEvents(engine, markers, t - EVENTS_MS, t).at(-1)
  let chat: Line | null = null
  for (const { e } of engine.eventsBetween(t - 8000, t)) {
    if (e.type === 'chat') chat = { t: e.t, text: `${s.units[e.unit]?.info.name ?? e.unit}: ${e.text}`, tone: 'plain' }
  }
  const latest = chat && (!ev || chat.t > ev.t) ? chat : ev
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="pointer-events-auto flex w-full items-center gap-2 rounded-lg border border-line bg-[rgba(17,17,19,0.9)] px-3 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium leading-4 text-fg">What happened here</span>
          <span className={`block truncate text-[12px] leading-4 ${latest === chat ? '' : latest?.tone === 'bad' ? 'text-bad' : 'text-fg-muted'}`}
            style={latest === chat ? { color: PARTY_CHAT } : undefined}>
            {latest ? `${fmtTime(latest.t)} ${latest.text}` : 'Tap for the score, the chat and the agents’ orders'}
          </span>
        </span>
        <ChevronUp size={16} className="shrink-0 text-fg-muted" />
      </button>
      {open && <MomentDrawer onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * What each agent last ordered, from its recorded model calls up to t: the top of
 * its priority list (replies may leave out a list that hasn't changed, so this is
 * the latest one sent) and, if its last call moved it, where to.
 */
function standingOrders(engine: ReplayEngine, t: number): Record<string, { action: string; move?: string }> {
  const names: Record<string, string> = Object.fromEntries(engine.replay.units.map((u) => [u.id, u.name]))
  const out: Record<string, { action: string; move?: string }> = {}
  for (const c of engine.replay.calls ?? []) {
    if (c.t > t) break
    let r: { priority?: [string, string][]; move_to?: unknown } | null = null
    try {
      const raw = c.reply ?? ''
      r = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1))
    } catch { continue }
    if (!r) continue
    const o = (out[c.agent] ??= { action: 'no orders yet' })
    const top = Array.isArray(r.priority) ? r.priority[0] : null
    if (top) o.action = `${engine.replay.abilities[top[0]]?.name ?? top[0]}${top[1] ? ` → ${names[top[1]] ?? top[1]}` : ''}`
    o.move = r.move_to === 'safe' ? 'stepping out of pools' : Array.isArray(r.move_to) ? 'moving' : r.move_to === 'stop' ? 'holding still' : undefined
  }
  return out
}

function useMarkers() {
  const engine = usePlayback((p) => p.engine)
  return useMemo(() => engine?.markers() ?? [], [engine])
}

function MomentDrawer({ onClose }: { onClose: () => void }) {
  const h = useHud()
  const markers = useMarkers()
  const seek = usePlayback((p) => p.seek)
  const inspect = useInspector((p) => p.show)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  if (!h) return null
  const { engine, t, s } = h
  const m = engine.replay.meta
  const hasCalls = (engine.replay.calls?.length ?? 0) > 0

  // The score so far, as the scorecard computes it.
  const boss = bossOf(s)
  const dungeon = m.mode === 'dungeon'
  const progress = dungeon ? dungeonProgress(s.units) : 0
  const now = s.ended ? Math.min(t, s.ended.t) : t
  const score = dungeon ? dungeonScore(s.ended?.outcome ?? null, (s.ended?.t ?? now) + s.penaltyMs, progress, m.time_limit_ms) : null
  const bossPct = boss ? (100 * boss.hp) / boss.info.max_hp : null

  const events = keyEvents(engine, markers, t - EVENTS_MS, t).reverse()
  const chat: { t: number; who: string; cls: string; text: string }[] = []
  const orders = standingOrders(engine, t)
  for (const { e } of engine.eventsBetween(t - CHAT_MS, t)) {
    if (e.type === 'chat') {
      const u = s.units[e.unit]
      chat.push({ t: e.t, who: u?.info.name ?? e.unit, cls: u?.info.class ?? '', text: e.text })
    }
  }
  const players = s.order.map((id) => s.units[id]).filter((u) => u.info.kind === 'player')
  const go = (at: number) => { seek(at - 2000); onClose() }
  // A highlight on this pull that starts within the last minute: its story leads the drawer.
  const highlight = HIGHLIGHTS.find((x) => x.t != null && highlightPath(x).split('?')[0] === location.pathname
    && t >= (x.t - 5) * 1000 && t <= (x.t + 60) * 1000)

  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex flex-col justify-end" role="dialog" aria-label="What happened here">
      <button className="flex-1 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="max-h-[68vh] animate-[fadein_250ms_cubic-bezier(0.22,1,0.36,1)] overflow-y-auto rounded-t-2xl border-t border-line bg-surface px-4 pb-6 pt-3">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/15" aria-hidden />
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-medium text-fg">What happened here <span className="num ml-1 font-mono text-[13px] text-fg-faint">{fmtTime(t)}</span></h2>
          <button onClick={onClose} className="icon-btn" aria-label="Close"><X size={16} /></button>
        </div>

        {highlight && (
          <div className="mt-3 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2.5">
            <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-accent">Highlight</div>
            <div className="mt-0.5 text-[14px] font-medium leading-5 text-fg">{highlight.title}</div>
            <p className="mt-1 text-[13px] leading-5 text-fg-muted">{highlight.summary}</p>
          </div>
        )}

        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {score != null && <Stat label="Score so far" value={score.toFixed(1)} />}
          <Stat label="Oruth" value={!boss?.engaged ? 'asleep' : `${bossPct!.toFixed(0)}% left`} />
          <Stat label="Deaths" value={String(s.deaths)} bad={s.deaths > 0} />
        </dl>

        <Head>Last {EVENTS_MS / 1000} seconds</Head>
        {events.length === 0 ? <Empty>Nothing major. Tap a time to rewind.</Empty> : events.map((r, i) => (
          <button key={i} onClick={() => go(r.t)} className="grid w-full grid-cols-[40px_1fr] gap-2 py-1 text-left">
            <span className="num font-mono text-[12px] leading-5 text-fg-faint">{fmtTime(r.t)}</span>
            <span className={`text-[13px] leading-5 ${r.tone === 'bad' ? 'text-bad' : r.tone === 'good' ? 'text-good' : 'text-fg'}`}>{r.text}</span>
          </button>
        ))}

        <Head>Party chat</Head>
        {chat.length === 0 ? <Empty>Nobody spoke in the last {CHAT_MS / 1000} seconds.</Empty> : chat.slice(-6).reverse().map((c, i) => (
          <button key={i} onClick={() => go(c.t)} className="grid w-full grid-cols-[40px_1fr] gap-2 py-1 text-left">
            <span className="num font-mono text-[12px] leading-5 text-fg-faint">{fmtTime(c.t)}</span>
            <span className="text-[13px] leading-5" style={{ color: PARTY_CHAT }}>
              [<span style={{ color: CLASS_COLORS[c.cls] ?? '#ededef' }}>{c.who}</span>]: {c.text}
            </span>
          </button>
        ))}

        <Head>What each agent is doing</Head>
        {players.map((u) => {
          const o = orders[u.info.id]
          return (
            <div key={u.info.id} className="grid grid-cols-[52px_1fr_auto] items-start gap-2 py-1">
              <span className="text-[13px] font-medium leading-5" style={{ color: CLASS_COLORS[u.info.class] }}>{u.info.name}</span>
              <span className={`text-[13px] leading-5 ${u.alive ? 'text-fg-muted' : 'text-fg-faint'}`}>{!u.alive ? 'dead' : o ? o.action : 'no orders yet'}{u.alive && o?.move && <span className="text-fg-faint">, {o.move}</span>}</span>
              {hasCalls && o && (
                <button onClick={() => inspect(u.info.id, t)} className="rounded-md border border-line px-1.5 py-0.5 text-[12px] text-fg-muted">Why?</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-white/[0.04] px-2 py-2">
      <dd className={`num font-mono text-[16px] leading-6 ${bad ? 'text-bad' : 'text-fg'}`}>{value}</dd>
      <dt className="text-[11px] leading-4 text-fg-faint">{label}</dt>
    </div>
  )
}

function Head({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 mt-5 text-[12px] font-medium uppercase tracking-[0.06em] text-fg-faint">{children}</h3>
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-1 text-[13px] text-fg-faint">{children}</p>
}
