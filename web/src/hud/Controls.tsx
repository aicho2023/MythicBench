import { ChevronDown, Info, ListTree, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { CLASS_COLORS, fmtNum, fmtTime, GRAVE_MARK } from '../content/display'
import { EPILOGUE_MS } from '../replay/engine'
import { usePlayback, useHud } from '../replay/store'
import { SiteHeader } from '../site/Layout'
import { COLOR } from '../site/tokens'

const SPEEDS = [0.5, 1, 2, 4]

// Each hue is one kind of event. Adds spawn in the bone-walker class color.
const MARKER_COLOR: Record<string, string> = {
  death: COLOR.bad, missed: COLOR.warn, raise: CLASS_COLORS.bonewalker, kick: COLOR.info, end: COLOR.fg, pull: COLOR.fgMuted,
  pool: '#c084fc', mark: GRAVE_MARK, soak: '#facc15',
}

// ---------------------------------------------------------------------------
// Top bar: the site header, plus which run you're watching and the "what is this" link.
// ---------------------------------------------------------------------------
export function TopBar({ onAbout, onRuns }: { onAbout: () => void; onRuns: () => void }) {
  const index = usePlayback((p) => p.index)
  const current = usePlayback((p) => p.currentId)
  const engine = usePlayback((p) => p.engine)
  const meta = engine?.replay.meta
  const tierName = meta?.tier_name ?? (meta?.sigil_level !== undefined ? `+${meta.sigil_level}` : undefined)
  const affixes = Object.values(engine?.replay.affixes ?? {})
  const catalogSize = usePlayback((p) => p.catalog?.runs.length ?? 0)
  const watching = index.find((r) => r.id === current)
  return (
    <SiteHeader
      overlay
      after={
        <span className="hidden items-baseline gap-2 text-[13px] text-fg-muted lg:flex">
          The Hollow Vault
          {tierName && <span className="num font-mono text-meta text-fg-faint">{tierName}</span>}
          {affixes.length > 0 && (
            <span className="hidden truncate text-meta text-fg-faint 2xl:inline" title={affixes.map((a) => `${a.name}: ${a.description}`).join('\n\n')}>
              {affixes.map((a) => a.name).join(', ')}
            </span>
          )}
        </span>
      }
      center={
        // What's on screen; opens the run list. The scripted commander lives in that list as a reference, not up here.
        <button onClick={onRuns} className="btn min-w-0 max-w-[520px] shrink" title="Choose a run">
          <ListTree size={16} className="shrink-0 text-fg-muted" />
          <span className="truncate">{watching ? watching.label : 'Choose a run'}</span>
          {watching?.id.startsWith('expert-') && <span className="shrink-0 text-meta text-accent/80">golden standard</span>}
          {watching && !watching.local && !watching.id.startsWith('expert-') && <span className="shrink-0 text-meta text-fg-faint">reference</span>}
          {catalogSize > 0 && <span className="hidden shrink-0 items-center gap-1 border-l border-line pl-2 text-meta text-fg-muted sm:inline-flex">All runs <ChevronDown size={14} /></span>}
        </button>
      }
      right={
        <button onClick={onAbout} className="icon-btn" title="About this eval" aria-label="About this eval">
          <Info size={16} />
        </button>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// Timeline / transport
// ---------------------------------------------------------------------------
export function ReplayControls() {
  const engine = usePlayback((p) => p.engine)
  const playing = usePlayback((p) => p.playing)
  const speed = usePlayback((p) => p.speed)
  const { toggle, seek, setSpeed } = usePlayback.getState()
  const h = useHud()
  const track = useRef<HTMLDivElement>(null)
  const markers = useMemo(() => engine?.markers() ?? [], [engine])

  // Keyboard: space = play/pause, arrows = +-5s, 1-4 = speed
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = usePlayback.getState()
      if (e.code === 'Space') { e.preventDefault(); p.toggle() }
      else if (e.code === 'ArrowLeft') p.seek(p.t - 5000)
      else if (e.code === 'ArrowRight') p.seek(p.t + 5000)
      else if (/^Digit[1-4]$/.test(e.code)) p.setSpeed(SPEEDS[Number(e.code.slice(5)) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!engine || !h) return null
  const dur = engine.duration
  const t = h.t
  // The clock shows the run itself (it ends at the timer at most); the few seconds after it, for the final animations, don't count.
  const runEnd = dur - EPILOGUE_MS
  const scrubTo = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    seek(((clientX - r.left) / r.width) * dur)
  }
  return (
    <div className="card transport-w pointer-events-auto flex items-center gap-2 p-2">
      <button onClick={() => seek(t - 10000)} className="icon-btn" title="Back 10 s"><SkipBack size={16} /></button>
      <button onClick={toggle} className="grid h-8 w-8 place-items-center rounded-lg bg-fg text-bg transition-[background-color,transform] duration-150 hover:bg-white active:scale-[0.97]" title="Play or pause (space)">
        {playing ? <Pause size={16} fill="currentColor" /> : t >= dur ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />}
      </button>
      <button onClick={() => seek(t + 10000)} className="icon-btn" title="Forward 10 s"><SkipForward size={16} /></button>
      <span className="num w-20 shrink-0 text-center font-mono text-meta text-fg-faint">
        <span className="text-fg">{fmtTime(Math.min(t, runEnd))}</span> / {fmtTime(runEnd)}
      </span>
      <div
        ref={track}
        className="group relative h-7 flex-1 cursor-pointer"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); scrubTo(e.clientX) }}
        onPointerMove={(e) => { if (e.buttons & 1) scrubTo(e.clientX) }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-fg/70" style={{ width: `${(t / dur) * 100}%` }} />
        {markers.map((m, k) => (
          <div
            key={k}
            title={`${m.label} at ${fmtTime(m.t)}`}
            className="absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-[1px]"
            style={{ left: `${(m.t / dur) * 100}%`, background: MARKER_COLOR[m.kind] ?? '#fff' }}
          />
        ))}
        <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg ring-[3px] ring-surface" style={{ left: `${(t / dur) * 100}%` }} />
      </div>
      <div className="seg max-sm:hidden">
        {SPEEDS.map((sp) => (
          <button key={sp} aria-pressed={sp === speed} onClick={() => setSpeed(sp)} className="num !px-2 font-mono !text-meta" title={`${sp}× speed`}>
            {sp}×
          </button>
        ))}
      </div>
    </div>
  )
}

export function TimelineLegend() {
  const dungeon = usePlayback((p) => p.engine?.replay.meta.mode === 'dungeon')
  const hasMarks = usePlayback((p) => (p.engine?.replay.meta.affixes ?? []).includes('hollow_tyrant'))
  const hasPyre = usePlayback((p) => !!p.engine?.replay.abilities.bone_pyre)
  const items = [['death', 'Death'], ['missed', 'Missed interrupt'], ['pool', 'Stood in a pool'], ...(hasPyre ? [['soak', 'Missed soak'] as const] : []), ...(hasMarks ? [['mark', 'Mark hit allies'] as const] : []), ['raise', 'Adds spawn'], ...(dungeon ? [['pull', 'Pull'] as const] : []), ['end', 'End']] as const
  return (
    <div className="pointer-events-auto flex w-fit flex-wrap justify-center gap-x-4 gap-y-1 rounded-lg bg-[rgba(17,17,19,0.8)] px-3 py-1 text-meta text-fg-muted">
      {items.map(([k, label]) => (
        <span key={k} className="flex items-center gap-2">
          <span className="h-3 w-[3px] rounded-[1px]" style={{ background: MARKER_COLOR[k] }} />{label}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result card at the end of a run
// ---------------------------------------------------------------------------
export function EndBanner() {
  const h = useHud()
  const { seek, setPlaying } = usePlayback.getState()
  if (!h || !h.s.ended || h.t < h.s.ended.t + 1500) return null
  const m = h.engine.replay.meta.metrics
  const win = h.s.ended.outcome === 'victory'
  const dungeonRun = h.engine.replay.meta.mode === 'dungeon'
  const players = h.engine.replay.units.filter((u) => u.kind === 'player')
  // Damage taken (absorbed included), from the event log.
  const taken: Record<string, number> = {}
  for (const e of h.engine.replay.events) {
    if (e.type === 'damage' && e.t <= h.s.ended.t && players.some((p) => p.id === e.target)) {
      taken[e.target] = (taken[e.target] ?? 0) + e.amount + (e.absorbed ?? 0)
    }
  }
  const avoidable = m ? Object.values(m.avoidable_damage_taken).reduce((a, b) => a + b, 0) : 0
  return (
    <div className="card pointer-events-auto w-[600px] max-w-[calc(100vw-32px)] animate-[fadein_400ms_cubic-bezier(0.22,1,0.36,1)] p-5">
      <div className="label">Result</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className={`text-[28px] font-medium leading-tight ${win ? 'text-good' : 'text-bad'}`}>{win ? (dungeonRun ? 'Crypt cleared' : 'Boss defeated') : h.s.ended.outcome === 'timeout' ? 'Time ran out' : 'Party wiped'}</span>
      </div>
      <div className="mt-2 text-[13px] text-fg-muted">
        {dungeonRun
          ? win ? `Oruth fell at ${fmtTime((m?.duration_s ?? 0) * 1000)}${m?.penalty_s ? ` (+${m.penalty_s}s revive penalties)` : ''}.`
            : `The party got ${m?.progress_pct ?? 0}% of the way through the crypt.`
          : win ? `Oruth fell in ${fmtTime((m?.duration_s ?? 0) * 1000)}.` : `Oruth survived with ${m?.boss_hp_pct_remaining}% health.`}
      </div>
      {m && (
        <div className="mt-4 grid grid-cols-5 gap-px overflow-hidden rounded-lg border border-line bg-line max-sm:grid-cols-3">
          <Stat label="Score" value={m.score.toFixed(1)} />
          <Stat label="Time" value={fmtTime(m.duration_s * 1000)} />
          <Stat label="Deaths" value={`${m.deaths.length}`} bad={m.deaths.length > 0} />
          <Stat label="Kicks" value={`${m.interrupts.interrupted}/${m.interrupts.interruptible_casts}`} bad={m.interrupts.interrupted < m.interrupts.interruptible_casts} />
          <Stat label="Pool damage" value={fmtNum(avoidable)} bad={avoidable > 0} />
        </div>
      )}
      <div className="mt-4 grid grid-cols-3 gap-4 max-sm:grid-cols-1">
        <Breakdown title="Damage done" players={players} values={h.s.damageDone} />
        <Breakdown title="Healing done" players={players} values={h.s.healingDone} />
        <Breakdown title="Damage taken" players={players} values={taken} />
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={() => { seek(0); setPlaying(true) }} className="btn">Watch again</button>
      </div>
    </div>
  )
}

/** One end-of-run chart: a bar per character, largest first, in class colours. */
function Breakdown({ title, players, values }: { title: string; players: { id: string; name: string; class: string }[]; values: Record<string, number> }) {
  const rows = players.map((p) => ({ p, v: values[p.id] ?? 0 })).sort((a, b) => b.v - a.v)
  const max = Math.max(1, ...rows.map((r) => r.v))
  return (
    <figure className="m-0">
      <figcaption className="text-meta text-fg-faint">{title}</figcaption>
      <ul className="mt-1.5 space-y-1">
        {rows.map(({ p, v }) => (
          <li key={p.id} className="grid grid-cols-[52px_1fr_44px] items-center gap-2 text-[12px]">
            <span className="truncate" style={{ color: CLASS_COLORS[p.class] }}>{p.name}</span>
            <span className="h-2 overflow-hidden rounded-sm bg-white/[0.06]">
              <span className="block h-full rounded-sm" style={{ width: `${(100 * v) / max}%`, background: CLASS_COLORS[p.class] }} />
            </span>
            <span className="num text-right font-mono text-fg-muted">{fmtNum(v)}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-meta text-fg-faint">{label}</div>
      <div className={`num mt-1 font-mono text-[15px] ${bad ? 'text-bad' : 'text-fg'}`}>{value}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// "About this eval" drawer: what is measured, how, and what exists today.
// ---------------------------------------------------------------------------
export function AboutPanel({ onClose }: { onClose: () => void }) {
  const engine = usePlayback((p) => p.engine)
  const m = engine?.replay.meta
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="h-full w-[440px] max-w-full animate-[slidein_300ms_cubic-bezier(0.22,1,0.36,1)] overflow-y-auto border-l border-line bg-surface px-6 py-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="label">About this eval</span>
          <button onClick={onClose} className="icon-btn -mr-2" title="Close (Esc)"><X size={16} /></button>
        </div>
        <h2 className="mt-4 text-[20px] font-medium leading-[28px] text-fg">
          Can an AI agent play its role in a five-person dungeon team?
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-fg-muted">
          MythicBench puts a decision-maker (the policy) in control of a party fighting one scripted boss,
          then scores how well it handled the fight. You are watching one recorded run.
        </p>

        <Section n="1" title="The task">
          Clear the crypt like a Mythic+ key: two trash packs (a caster to <b>kick</b>, a healer to <b>kill first</b>), then
          Oruth, on one 4:15 timer; resting and reviving between pulls costs time. Each boss ability tests one skill: an <b>interruptible cast</b> (react in time),
          a <b>tank buster</b> (use defensives), <b>pools on the ground</b> (move out), a <b>circle at least two players must stand in</b> (the one rule that has to be learned), and <b>adds</b> (switch targets).
        </Section>
        <Section n="2" title="The agent under test">
          Each of the five characters is driven by the policy. Every 100 ms it receives a JSON observation from that
          character's point of view (health, positions, casts, boss timers) and returns actions. It never gets engine
          internals, so the scripted commander and a language model compete on equal terms.
        </Section>
        <Section n="3" title="The score">
          One number per pull, from <b>0 to 100</b>. A clear (Oruth and every pack dead within the timer) earns
          <b>70 plus up to 30 for speed</b>; otherwise, a wipe or the timer running out, up to <b>70</b> for
          progress. The run ends at the timer. Win/loss alone would tie every team that wins, so the score keeps
          separating them. Interrupts, deaths, and pool damage explain where points went. Difficulty comes in two
          tiers, <b>Normal</b> and <b>+10</b>, which adds three affixes. Everything is computed from the replay's event log alone, so anyone can
          recompute it from the published file.
        </Section>
        <Section n="4" title="Controlled comparison">
          Each seed shuffles the boss's timers, so mechanics sometimes overlap. The timers come from their own seeded
          stream, so every policy on a seed faces the same boss script, and a difference in the result comes from
          decisions. Results are averaged over groups and reported with 95% confidence intervals.
        </Section>

        <div className="mt-6 rounded-lg border border-line bg-surface-raised p-4">
          <div className="label !text-fg">Status</div>
          <p className="mt-2 text-[13px] leading-5 text-fg-muted">
            The official run of five models is next. Until then, the run list has pilot pulls by real models.
          </p>
        </div>

        {m && (
          <div className="mt-6">
            <div className="label">This replay</div>
            <dl className="mt-2 space-y-1 font-mono text-meta">
              {[['Policy', m.policy], ['Seed', String(m.seed)], ['Outcome', m.outcome], ['Sim version', m.sim_version], ['Content version', m.content_version]].map(([k, v]) => (
                <div key={k} className="flex justify-between"><dt className="text-fg-faint">{k}</dt><dd className="text-fg">{v}</dd></div>
              ))}
            </dl>
          </div>
        )}
        <div className="mt-6 text-[12px] leading-5 text-fg-faint">
          <Key>Space</Key> plays or pauses, <Key>←</Key> <Key>→</Key> seek 5 s, and <Key>1</Key>–<Key>4</Key> set the speed.
          Click any agent decision to rewind to it.
        </div>
      </aside>
    </div>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 grid grid-cols-[20px_1fr] gap-x-2">
      <span className="num font-mono text-[13px] leading-5 text-fg-faint">{n}</span>
      <div>
        <h3 className="text-[13px] font-medium leading-5 text-fg">{title}</h3>
        <p className="mt-1 text-[13px] leading-5 text-fg-muted [&_b]:font-medium [&_b]:text-fg">{children}</p>
      </div>
    </section>
  )
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border border-line bg-surface-raised px-1 font-mono text-meta text-fg-muted">{children}</kbd>
}

/**
 * A one-time note for visitors who opened plain /watch: whose pull this is and what to look for.
 * The replay waits, paused, under it; pressing play (here or anywhere) clears it, so it never
 * covers the fight while it runs.
 */
export function LandingHint() {
  const landing = usePlayback((p) => p.landing)
  const playing = usePlayback((p) => p.playing)
  const label = usePlayback((p) => p.index.find((e) => e.id === p.currentId)?.label)
  const dismiss = usePlayback((p) => p.dismissLanding)
  useEffect(() => { if (landing && playing) dismiss() }, [landing, playing, dismiss])
  if (!landing || !label) return null
  return (
    <div className="card pointer-events-auto w-[480px] max-w-[calc(100vw-32px)] animate-[fadein_400ms_cubic-bezier(0.22,1,0.36,1)] px-4 py-3 text-[13px] leading-5">
      <p className="text-fg-muted">
        <span className="text-fg">{label}, one of the best pulls in the benchmark.</span> Watch the glowing circle on the
        floor: with two or more players inside, its blast is split between them; with fewer, it hits the whole party.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => usePlayback.getState().setPlaying(true)} className="btn btn-primary h-9 px-4 text-[13px]">
          <Play size={14} fill="currentColor" /> Play
        </button>
        <button onClick={dismiss} className="btn h-9 px-3 text-[13px]">Dismiss</button>
      </div>
    </div>
  )
}
