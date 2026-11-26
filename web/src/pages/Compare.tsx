import { Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CLASS_COLORS, dungeonProgress, dungeonScore, fmtNum, fmtTime, GRAVE_MARK, GROUND_COLORS, runScore } from '../content/display'
import { EPILOGUE_MS, ReplayEngine, posAt, type ReplayState, bossOf } from '../replay/engine'
import { usePlayback } from '../replay/store'
import type { Replay, ReplayIndexEntry } from '../replay/types'
import { Page } from '../site/Layout'
import { Link } from '../site/router'
import { fetchMaybeGzipJson } from '../site/results'
import { COLOR } from '../site/tokens'

const VIEW_M = 34 // metres shown across each map; the view follows the party
const SPEEDS = [1, 2, 4, 8]

const base = import.meta.env.BASE_URL

/** Top-down tactical map of one replay at time t: rooms, pools, units. */
function TacticalMap({ engine, s, t }: { engine: ReplayEngine; s: ReplayState; t: number }) {
  const a = engine.replay.arena
  const party = s.order.map((id) => s.units[id]).filter((u) => u.info.kind === 'player')
  const alive = party.filter((u) => u.alive)
  const pts = (alive.length ? alive : party).map((u) => posAt(u, t))
  const cx = pts.reduce((m, p) => m + p[0], 0) / pts.length
  const cz = pts.reduce((m, p) => m + p[1], 0) / pts.length
  const h = VIEW_M / 2
  // Name labels sit above each player; when two players stand close, later labels step up
  // until they clear the ones already placed, so names never print on top of each other.
  // Each label is a box around its text; so is each dot. A label tries above its dot, then below,
  // right and left, and only steps further out (with a leader line back) if all four are taken.
  type Anchor = 'middle' | 'start' | 'end'
  const labels: { id: string; name: string; color: string; x: number; y: number; anchor: Anchor; dot: [number, number]; far: boolean; alive: boolean }[] = []
  const boxes = party.map((u) => {
    const [x, z] = posAt(u, t)
    const r = Math.max(0.45, u.info.radius)
    return { x0: x - r, x1: x + r, y0: z - r, y1: z + r }
  })
  const hits = (b: { x0: number; x1: number; y0: number; y1: number }) =>
    boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)
  for (const u of [...party].sort((p, q) => posAt(p, t)[0] - posAt(q, t)[0])) {
    const [x, z] = posAt(u, t)
    const w = u.info.name.length * 0.4 + 0.2
    const r = Math.max(0.45, u.info.radius)
    // [text x, baseline y, anchor]; the box is the text's extent from its anchor
    const spots: [number, number, Anchor][] = [
      [x, z - r - 0.35, 'middle'], [x, z + r + 0.75, 'middle'], [x + r + 0.3, z + 0.25, 'start'], [x - r - 0.3, z + 0.25, 'end'],
    ]
    const box = ([lx, ly, a]: [number, number, Anchor]) => {
      const x0 = a === 'middle' ? lx - w / 2 : a === 'start' ? lx : lx - w
      return { x0, x1: x0 + w, y0: ly - 0.65, y1: ly + 0.1 }
    }
    let spot = spots.find((sp) => !hits(box(sp)))
    let far = false
    if (!spot) {
      far = true
      let y = spots[0][1]
      for (let n = 0; n < 6 && hits(box([x, y, 'middle'])); n++) y -= 0.8
      spot = [x, y, 'middle']
    }
    boxes.push(box(spot))
    labels.push({ id: u.info.id, name: u.info.name, color: CLASS_COLORS[u.info.class], x: spot[0], y: spot[1], anchor: spot[2], dot: [x, z - r], far, alive: u.alive })
  }
  return (
    <svg viewBox={`${cx - h} ${cz - h} ${VIEW_M} ${VIEW_M}`} className="aspect-square w-full rounded-lg border border-line bg-bg" role="img"
      aria-label="Top-down map of the party, enemies and pools">
      {a.rooms ? a.rooms.map((r) => <circle key={r.id} cx={r.center[0]} cy={r.center[1]} r={r.radius} fill={COLOR.raised} stroke={COLOR.line} strokeWidth={0.15} />)
        : <circle cx={0} cy={0} r={a.radius} fill={COLOR.raised} stroke={COLOR.line} strokeWidth={0.15} />}
      {a.corridors?.map((c, i) => <rect key={i} x={-c.x_half} y={c.z_min} width={2 * c.x_half} height={c.z_max - c.z_min} fill={COLOR.raised} />)}
      {Object.values(s.ground).map((g) => (
        <circle key={g.id} cx={g.pos[0]} cy={g.pos[1]} r={g.radius}
          fill={g.kind === 'grave' ? 'rgba(167,139,250,0.28)' : 'rgba(74,222,128,0.22)'}
          stroke={t >= g.t0 + g.armMs ? (GROUND_COLORS[g.kind] ?? GROUND_COLORS.desecrate) : 'rgba(255,255,255,0.25)'} strokeWidth={0.12} strokeDasharray={t >= g.t0 + g.armMs ? undefined : '0.4 0.3'} />
      ))}
      {s.order.map((id) => {
        const u = s.units[id]
        if (u.info.kind !== 'player' && (!u.alive || !u.engaged)) return null
        const [x, z] = posAt(u, t)
        const r = u.info.kind === 'boss' ? u.info.radius : Math.max(0.45, u.info.radius)
        const color = u.info.kind === 'player' ? CLASS_COLORS[u.info.class] : u.info.kind === 'boss' ? CLASS_COLORS.boss : COLOR.bad
        return (
          <g key={id} opacity={u.alive ? 1 : 0.35}>
            {u.auras.grave_mark && <circle cx={x} cy={z} r={6} fill="none" stroke={GRAVE_MARK} strokeWidth={0.12} strokeDasharray="0.5 0.4" />}
            <circle cx={x} cy={z} r={r} fill={color} stroke={u.cast ? COLOR.warn : COLOR.bg} strokeWidth={u.cast ? 0.2 : 0.08} />
          </g>
        )
      })}
      {/* Names last, so no dot is drawn over one */}
      {labels.map((l) => (
        <g key={l.id} opacity={l.alive ? 1 : 0.35}>
          {l.far && <line x1={l.dot[0]} y1={l.dot[1]} x2={l.x} y2={l.y + 0.1} stroke={l.color} strokeWidth={0.06} opacity={0.6} />}
          <text x={l.x} y={l.y} textAnchor={l.anchor} fontSize={0.7} fill={l.color}
            stroke={COLOR.bg} strokeWidth={0.18} paintOrder="stroke" className="font-sans">{l.name}</text>
        </g>
      ))}
    </svg>
  )
}

function Side({ entry, engine, t }: { entry: ReplayIndexEntry; engine: ReplayEngine; t: number }) {
  const s = engine.stateAt(t)
  const m = engine.replay.meta
  const dungeon = m.mode === 'dungeon'
  const boss = bossOf(s)
  const progress = dungeon ? dungeonProgress(s.units) : 100 * (1 - (boss?.hp ?? 0) / (boss?.info.max_hp ?? 1))
  const score = dungeon
    ? dungeonScore(s.ended?.outcome ?? null, (s.ended?.t ?? t) + s.penaltyMs, progress, m.time_limit_ms)
    : runScore(s.ended?.outcome ?? null, s.ended?.t ?? 0, 100 - progress, m.time_limit_ms)
  const avoidable = Object.values(s.avoidableTaken).reduce((x, y) => x + y, 0)
  const said = engine.eventsBetween(t - 30000, t).filter(({ e }) => e.type === 'decision').slice(-4).reverse()
  const names = Object.fromEntries(engine.replay.units.map((u) => [u.id, u]))
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="truncate text-[15px] text-fg">{entry.label}</h2>
        <Link to={entry.path ?? `/watch?replay=${encodeURIComponent(entry.id)}`} className="shrink-0 text-[13px] text-fg-faint transition-colors hover:text-fg">Open in 3D</Link>
      </div>
      <div className="mt-2"><TacticalMap engine={engine} s={s} t={t} /></div>
      <dl className="mt-3 grid grid-cols-5 gap-2 text-[12px]">
        {[['Score', score.toFixed(1)], ['Progress', `${progress.toFixed(0)}%`], ['Deaths', `${s.deaths}`],
          ['Interrupts', `${s.kicks.interrupted}/${s.kicks.casts}`], ['Pool damage', fmtNum(avoidable)]].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line px-2 py-1.5">
            <dt className="text-fg-faint">{k}</dt>
            <dd className="num font-mono text-[14px] text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 min-h-[120px] text-[12px] leading-[18px]">
        {s.ended && (() => {
          // A clear is a timed clear (older replays could record a kill after the timer).
          const clear = s.ended.outcome === 'victory' && m.metrics?.in_time !== false
          const text = clear ? 'Cleared' : s.ended.outcome === 'victory' ? 'Killed after the timer' : s.ended.outcome === 'timeout' ? 'Time ran out' : 'Wiped'
          return <p className={clear ? 'text-good' : 'text-bad'}>{text} at {fmtTime(s.ended.t)}</p>
        })()}
        {said.map(({ e, i }) => e.type === 'decision' && (
          <p key={i} className="mt-1 text-fg-muted">
            <span className="num font-mono text-fg-faint">{fmtTime(e.t)}</span>{' '}
            <span style={{ color: CLASS_COLORS[names[e.unit]?.class] }}>{names[e.unit]?.name}</span>{' '}
            {e.reason}
          </p>
        ))}
      </div>
    </div>
  )
}

/**
 * Two replays side by side on one clock, as top-down maps: pull 1 against a
 * later pull, or two models on the same seed. /compare?a=<replay id>&b=<replay id>
 */
const DEFAULT_PAIR = ['/watch/claude-opus-5-5/plus10/1/1', '/watch/claude-opus-5-5/plus10/1/2']

export function Compare() {
  const ensureIndex = usePlayback((p) => p.ensureIndex)
  const index = usePlayback((p) => p.index)
  const q = new URLSearchParams(location.search)
  const ids = [q.get('a'), q.get('b')]
  // Opened without a pair: Claude Opus 5.5's group 2, its blind first pull against the pull after one debrief.
  const preset = !ids[0] || !ids[1]
  const entries = preset
    ? DEFAULT_PAIR.map((path) => index.find((e) => e.path === path))
    : ids.map((id) => index.find((e) => e.id === id))
  const [engines, setEngines] = useState<(ReplayEngine | null)[]>([null, null])
  const [error, setError] = useState<string | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)
  const last = useRef<number | null>(null)
  useEffect(() => { ensureIndex() }, [ensureIndex])
  const key = entries.map((e) => e?.id).join('|')
  useEffect(() => {
    if (!entries[0] || !entries[1]) return
    let live = true
    Promise.all(entries.map((e) => fetchMaybeGzipJson<Replay>(e!.url ?? `${base}replays/${e!.file}`)))
      .then((rs) => {
        if (!live) return
        setEngines(rs.map((r) => new ReplayEngine(r)))
        // Open just before the first of the two parties pulls Oruth: the corridor and trash
        // before that look the same in both, and the boss is where they differ.
        const boss = rs.flatMap((r) => r.events.flatMap((e) => (e.type === 'pull' && e.pack === 'boss' ? [e.t] : [])))
        setT(boss.length ? Math.max(0, Math.min(...boss) - 3000) : 0)
      })
      .catch((err) => setError(String(err)))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const dur = useMemo(() => Math.max(...engines.map((e) => e?.duration ?? 0)), [engines])
  useEffect(() => {
    if (!playing) { last.current = null; return }
    let raf = 0
    const step = (now: number) => {
      const dt = last.current === null ? 0 : now - last.current
      last.current = now
      setT((x) => {
        const n = x + dt * speed
        if (n >= dur) { setPlaying(false); return dur }
        return n
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, dur])

  const missing = index.length > 0 && (!entries[0] || !entries[1])
  return (
    <Page>
      <div className="py-8">
        <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">Side by side</h1>
        <p className="mt-1 text-[14px] text-fg-muted">
          {preset
            ? 'Claude Opus 5.5, group 2: the blind first pull against the second, after one debrief. Two replays on one clock, seen from above.'
            : 'Two replays on one clock, seen from above. The view follows each party.'}
        </p>
        {missing && <p className="mt-6 text-[14px] text-bad">Couldn't find both replays. Open this page from a replay's learning panel.</p>}
        {error && <p className="mt-6 text-[14px] text-bad">{error}</p>}
        {engines[0] && engines[1] && entries[0] && entries[1] && (
          <>
            <div className="sticky top-0 z-10 mt-6 flex items-center gap-3 border-b border-line bg-bg py-3">
              <button onClick={() => { if (!playing && t >= dur) setT(0); setPlaying((p) => !p) }}
                className="grid h-8 w-8 place-items-center rounded-lg bg-fg text-bg" aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause size={16} fill="currentColor" /> : t >= dur ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />}
              </button>
              <span className="num w-24 font-mono text-[12px] text-fg-faint"><span className="text-fg">{fmtTime(Math.min(t, dur - EPILOGUE_MS))}</span> / {fmtTime(dur - EPILOGUE_MS)}</span>
              <input type="range" min={0} max={dur} step={100} value={t} onChange={(e) => setT(Number(e.target.value))}
                className="flex-1 accent-white" aria-label="Time" />
              <div className="seg" role="group" aria-label="Speed">
                {SPEEDS.map((sp) => <button key={sp} aria-pressed={sp === speed} onClick={() => setSpeed(sp)} className="num font-mono">{sp}×</button>)}
              </div>
            </div>
            <div className="mt-6 grid gap-8 md:grid-cols-2">
              <Side entry={entries[0]} engine={engines[0]} t={t} />
              <Side entry={entries[1]} engine={engines[1]} t={t} />
            </div>
          </>
        )}
        {!missing && !error && !(engines[0] && engines[1]) && <p className="mt-6 text-[14px] text-fg-faint">Loading…</p>}
      </div>
    </Page>
  )
}
