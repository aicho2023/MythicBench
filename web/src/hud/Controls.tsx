import { Info, Pause, Play, RotateCcw, SkipBack, SkipForward, X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { CLASS_COLORS, fmtNum, fmtTime } from '../content/display'
import { usePlayback, useHud } from '../replay/store'

const SPEEDS = [0.5, 1, 2, 4]

const MARKER_COLOR: Record<string, string> = {
  death: '#f87171', missed: '#fbbf24', raise: '#a1a1aa', kick: '#7dd3fc', end: '#ededef',
}

// ---------------------------------------------------------------------------
// Top bar: identity, which run you're watching, and the "what is this" link.
// ---------------------------------------------------------------------------
export function TopBar({ onAbout }: { onAbout: () => void }) {
  const index = usePlayback((p) => p.index)
  const current = usePlayback((p) => p.currentId)
  const load = usePlayback((p) => p.load)
  const engine = usePlayback((p) => p.engine)
  const sigil = engine?.replay.meta.sigil_level
  return (
    <div className="pointer-events-auto flex h-12 items-center gap-4 border-b border-line bg-[rgba(10,10,12,0.72)] px-4 backdrop-blur-md">
      <div className="flex items-baseline gap-2">
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-fg">MythicBench</span>
        <span className="font-mono text-[10.5px] text-fg-faint">replay viewer</span>
      </div>
      <div className="h-4 w-px bg-white/10" />
      <div className="hidden items-baseline gap-2 text-[12.5px] text-fg-muted md:flex">
        <span>Gravecrown Crypt</span>
        {sigil !== undefined && <span className="font-mono text-[11px] text-fg-faint">sigil +{sigil}</span>}
      </div>

      <div className="mx-auto flex items-center gap-2">
        <span className="label hidden lg:inline">Run</span>
        <div className="seg">
          {index.map((r) => (
            <button key={r.id} aria-pressed={r.id === current} onClick={() => load(r.id)} title={r.blurb} className="flex items-baseline gap-2">
              <span>{r.label}</span>
              <span className={`num font-mono text-[10.5px] ${r.outcome === 'victory' ? 'text-good' : 'text-bad'}`}>
                {r.outcome === 'victory' ? 'kill' : 'wipe'} {fmtTime(r.duration_s * 1000)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <button onClick={onAbout} className="btn">
        <Info size={14} /> About this eval
      </button>
    </div>
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
  const scrubTo = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    seek(((clientX - r.left) / r.width) * dur)
  }
  return (
    <div className="card pointer-events-auto flex w-[640px] items-center gap-2 px-2 py-1.5">
      <button onClick={() => seek(t - 10000)} className="icon-btn" title="Back 10s (←)"><SkipBack size={15} /></button>
      <button onClick={toggle} className="grid h-8 w-8 place-items-center rounded-md bg-fg text-bg transition-colors hover:bg-white" title="Play / pause (space)">
        {playing ? <Pause size={15} fill="currentColor" /> : t >= dur ? <RotateCcw size={15} /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
      </button>
      <button onClick={() => seek(t + 10000)} className="icon-btn" title="Forward 10s (→)"><SkipForward size={15} /></button>
      <span className="num w-[78px] text-center font-mono text-[11px] text-fg-muted">
        <span className="text-fg">{fmtTime(t)}</span> / {fmtTime(dur)}
      </span>
      <div
        ref={track}
        className="group relative h-7 flex-1 cursor-pointer"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); scrubTo(e.clientX) }}
        onPointerMove={(e) => { if (e.buttons & 1) scrubTo(e.clientX) }}
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/10" />
        <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-fg/80" style={{ width: `${(t / dur) * 100}%` }} />
        {markers.map((m, k) => (
          <div
            key={k}
            title={`${fmtTime(m.t)} · ${m.label}`}
            className="absolute top-1/2 h-[11px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-[1px]"
            style={{ left: `${(m.t / dur) * 100}%`, background: MARKER_COLOR[m.kind] ?? '#fff' }}
          />
        ))}
        <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg shadow-[0_0_0_3px_rgba(10,10,12,0.8)] transition-transform group-hover:scale-110" style={{ left: `${(t / dur) * 100}%` }} />
      </div>
      <div className="seg">
        {SPEEDS.map((sp) => (
          <button key={sp} aria-pressed={sp === speed} onClick={() => setSpeed(sp)} className="num !px-1.5 !py-0.5 font-mono !text-[10.5px]">
            {sp}×
          </button>
        ))}
      </div>
    </div>
  )
}

export function TimelineLegend() {
  const items = [['death', 'Death'], ['missed', 'Missed interrupt'], ['raise', 'Adds spawn'], ['end', 'End']] as const
  return (
    <div className="mx-auto flex w-fit gap-3.5 rounded-full bg-black/55 px-3 py-1 font-mono text-[10px] text-fg-muted backdrop-blur">
      {items.map(([k, label]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="h-[9px] w-[3px] rounded-[1px]" style={{ background: MARKER_COLOR[k] }} />{label}
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
  const index = usePlayback((p) => p.index)
  const current = usePlayback((p) => p.currentId)
  const { load, seek, setPlaying } = usePlayback.getState()
  if (!h || !h.s.ended || h.t < h.s.ended.t + 1500) return null
  const m = h.engine.replay.meta.metrics
  const win = h.s.ended.outcome === 'victory'
  const i = index.findIndex((r) => r.id === current)
  const other = index.length > 1 ? index[(i + 1) % index.length] : undefined
  const players = h.engine.replay.units.filter((u) => u.kind === 'player')
  const top = players.map((u) => ({ u, v: h.s.damageDone[u.id] ?? 0 })).sort((a, b) => b.v - a.v)[0]
  const avoidable = m ? Object.values(m.avoidable_damage_taken).reduce((a, b) => a + b, 0) : 0
  return (
    <div className="card pointer-events-auto w-[480px] animate-[fadein_0.4s_ease-out] p-5">
      <div className="label">Result</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className={`text-[28px] font-semibold tracking-[-0.02em] ${win ? 'text-good' : 'text-bad'}`}>{win ? 'Boss defeated' : 'Party wiped'}</span>
      </div>
      <div className="mt-1 text-[13px] text-fg-muted">
        {win ? `Mortisar fell in ${fmtTime((m?.duration_s ?? 0) * 1000)}.` : `Mortisar survived with ${m?.boss_hp_pct_remaining}% health.`}
      </div>
      {m && (
        <div className="mt-4 grid grid-cols-5 gap-px overflow-hidden rounded-lg border border-line bg-line">
          <Stat label="Score" value={m.score.toFixed(1)} />
          <Stat label="Time" value={fmtTime(m.duration_s * 1000)} />
          <Stat label="Deaths" value={`${m.deaths.length}`} bad={m.deaths.length > 0} />
          <Stat label="Kicks" value={`${m.interrupts.interrupted}/${m.interrupts.interruptible_casts}`} bad={m.interrupts.interrupted < m.interrupts.interruptible_casts} />
          <Stat label="Avoidable" value={fmtNum(avoidable)} bad={avoidable > 0} />
        </div>
      )}
      {top && (
        <div className="mt-3 text-[12px] text-fg-faint">
          Top damage: <span style={{ color: CLASS_COLORS[top.u.class] }}>{top.u.name}</span> <span className="num font-mono">{fmtNum(top.v)}</span>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {other && <button onClick={() => load(other.id)} className="btn btn-primary">Compare with {other.label.toLowerCase()}</button>}
        <button onClick={() => { seek(0); setPlaying(true) }} className="btn">Watch again</button>
      </div>
    </div>
  )
}

function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="bg-[#0e0e12] px-3 py-2">
      <div className="label">{label}</div>
      <div className={`num mt-0.5 font-mono text-[16px] ${bad ? 'text-bad' : 'text-fg'}`}>{value}</div>
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
    <div className="pointer-events-auto absolute inset-0 z-20 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="h-full w-[420px] animate-[slidein_0.25s_ease-out] overflow-y-auto border-l border-line bg-[#0c0c0f] px-6 py-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="label">About this eval</span>
          <button onClick={onClose} className="icon-btn -mr-2" title="Close (Esc)"><X size={16} /></button>
        </div>
        <h2 className="mt-3 text-[20px] font-semibold leading-tight tracking-[-0.015em] text-fg">
          Can an AI agent play its role in a five-person dungeon team?
        </h2>
        <p className="mt-2 text-[13px] leading-[20px] text-fg-muted">
          MythicBench puts a decision-maker (the <i>policy</i>) in control of a party fighting one scripted boss,
          then scores how well it handled the fight. You are watching one recorded run.
        </p>

        <Section n="1" title="The task">
          Beat Mortisar before the 3:15 enrage. Each boss ability tests one skill: an <b>interruptible cast</b> (react in time),
          a <b>tank buster</b> (use defensives), <b>pools on the ground</b> (move out), and <b>adds</b> (switch targets).
        </Section>
        <Section n="2" title="The agent under test">
          Each of the five characters is driven by the policy. Every 100 ms it receives a JSON observation from that
          character's point of view (health, positions, casts, boss timers) and returns actions. It never gets engine
          internals, so a scripted bot and a language model compete on equal terms.
        </Section>
        <Section n="3" title="The score">
          One number per run: the <b>% of the boss's health removed</b>, or for a kill, <b>100 plus one point per
          second left</b> on the timer. Win/loss alone would tie every team that wins, so the score keeps separating
          them. Interrupts, deaths, and avoidable damage explain where points went. Everything is computed from the
          replay's event log alone, so anyone can recompute it from the published file.
        </Section>
        <Section n="4" title="Controlled comparison">
          Each seed shuffles the boss's timers, so mechanics sometimes overlap. The timers come from their own seeded
          stream, so every policy on a seed faces the same boss script, and a difference in the result comes from
          decisions. Results are averaged over hundreds of seeds and reported with 95% confidence intervals.
        </Section>

        <div className="mt-6 rounded-lg border border-warn/25 bg-warn/[0.06] p-3.5">
          <div className="label !text-warn">Status: Phase 1</div>
          <p className="mt-1.5 text-[12.5px] leading-[19px] text-fg-muted">
            Only hand-written baseline bots exist so far. Over 200 seeds they score{' '}
            <span className="text-fg">expert 128</span>, <span className="text-fg">competent 105</span>, and{' '}
            <span className="text-fg">sloppy 21</span>, with non-overlapping 95% intervals. Ranking three known skill
            levels correctly is the check that the benchmark can tell good play from bad. Language-model policies
            and a leaderboard come in Phase 2.
          </p>
        </div>

        {m && (
          <div className="mt-6">
            <div className="label">This replay</div>
            <dl className="mt-2 space-y-1 font-mono text-[11.5px]">
              {[['policy', m.policy], ['seed', String(m.seed)], ['outcome', m.outcome], ['sim version', m.sim_version], ['content version', m.content_version]].map(([k, v]) => (
                <div key={k} className="flex justify-between"><dt className="text-fg-faint">{k}</dt><dd className="text-fg">{v}</dd></div>
              ))}
            </dl>
          </div>
        )}
        <div className="mt-6 text-[11.5px] leading-[18px] text-fg-faint">
          Keyboard: space play/pause · ←/→ seek 5 s · 1–4 speed. Click any agent decision to rewind to it.
        </div>
      </aside>
    </div>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 grid grid-cols-[22px_1fr] gap-x-2">
      <span className="num pt-[1px] font-mono text-[11px] text-fg-faint">{n}</span>
      <div>
        <h3 className="text-[13.5px] font-medium text-fg">{title}</h3>
        <p className="mt-1 text-[12.5px] leading-[19px] text-fg-muted [&_b]:font-medium [&_b]:text-fg">{children}</p>
      </div>
    </section>
  )
}
