// /play: take one seat in the party and play by the agents' rules. The fight
// pauses whenever your character's agent would have been asked (every 4 s of
// game time, and at once when something concerns you); you send the same
// orders an agent sends. The expert script plays the other four seats.
import { Check, Copy, Download, LogOut, Share2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CLASS_COLORS, fmtTime } from '../content/display'
import { PartyFrames } from '../hud/PartyFrames'
import { RaidWarnings, Scorecard } from '../hud/Panels'
import { CompactParty } from '../hud/MobileMoment'
import { WorldOverlay } from '../hud/WorldOverlay'
import { AiView, Orders, useNames } from '../play/Orders'
import { sim } from '../play/sim'
import { MAX_PULLS, groupScore, todaysVault, usePlay, type PullResult, type Tier } from '../play/store'
import { SEAT_NAMES, TIER_NAME, decode, drawCard, encode, headline, shareText, xIntent, type Shared } from '../play/share'
import { usePlayback } from '../replay/store'
import { Scene } from '../scene/Scene'
import { picking } from '../scene/picking'
import { Page } from '../site/Layout'
import { modelsOnly } from '../site/results'
import { useResults } from '../site/useResults'
import { Link, useSearch } from '../site/router'
import { modelName } from '../content/display'

const SEATS: { id: string; role: string; line: string }[] = [
  { id: 'rook', role: 'Tank', line: 'Nothing moves until you pull. Hold the packs and Oruth, and kick.' },
  { id: 'ivy', role: 'Healer', line: 'Keep four people alive through everything. No kick.' },
  { id: 'brask', role: 'Melee damage', line: 'A cleave for the packs and a kick.' },
  { id: 'kit', role: 'Melee damage', line: 'An area attack, and a fast kick off the global cooldown.' },
  { id: 'wren', role: 'Ranged damage', line: 'A ranged kick and the party’s haste. A good first seat.' },
]

export function Play() {
  const phase = usePlay((s) => s.phase)
  useEffect(() => () => usePlay.getState().quit(), [])
  return phase === 'lobby' ? <Lobby /> : <Game />
}

// ---- Lobby ----------------------------------------------------------------------

function Lobby() {
  const search = useSearch()
  const shared = useMemo(() => decode(search), [search])
  const { seat, tier, vault, error, setSeat, setTier, setVault, begin } = usePlay()
  const [engine, setEngine] = useState<'loading' | 'ready' | 'failed'>('loading')
  const today = todaysVault()
  useEffect(() => {
    if (shared) { setVault(shared.vault); setTier(shared.tier); setSeat(shared.seat) }
    else setVault(today)
  }, [shared, setVault, setTier, setSeat, today])
  // Load the game while the player picks.
  useEffect(() => { sim.boot().then(() => setEngine('ready'), () => setEngine('failed')) }, [])

  return (
    <Page>
      <div className="mx-auto max-w-[960px] py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">Take a seat</h1>
          <p className="mt-4 max-w-[680px] text-[17px] leading-7 text-fg-muted">
            Play one character by the same rules the AI agents had. The fight pauses every 4 seconds, and whenever
            something concerns you, for your orders. Four expert bots play the rest of the party. You start blind,
            and you get five pulls to clear the vault.
          </p>
        </header>

        {shared && <Challenge r={shared} />}

        <section className="mt-10">
          <h2 className="text-[15px] font-medium text-fg">Difficulty</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(['normal', 'plus10'] as Tier[]).map((t) => (
              <button key={t} onClick={() => setTier(t)} aria-pressed={tier === t}
                className={`rounded-xl border p-4 text-left transition-colors ${tier === t ? 'border-white/30 bg-surface-raised' : 'border-line hover:border-white/20'}`}>
                <div className="text-[17px] text-fg">{TIER_NAME[t]}</div>
                <p className="mt-1 text-[14px] leading-6 text-fg-muted">
                  {t === 'normal'
                    ? 'Clearable. With an expert in your seat the party clears about 9 times in 10.'
                    : 'The benchmark’s tier, with three affixes. No model cleared it, and the expert bots almost never do. Play for score.'}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-[15px] font-medium text-fg">Your character</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {SEATS.map((s) => {
              const on = seat === s.id
              const col = CLASS_COLORS[SEAT_NAMES[s.id].cls]
              return (
                <button key={s.id} onClick={() => setSeat(s.id)} aria-pressed={on}
                  className={`flex flex-col items-center rounded-xl border px-3 pb-4 pt-2 text-center transition-colors ${on ? 'bg-surface-raised' : 'border-line hover:border-white/20'}`}
                  style={on ? { borderColor: col, background: `radial-gradient(ellipse 80% 60% at 50% 40%, ${col}22, transparent 70%)` } : undefined}>
                  <img src={`/portraits/${s.id}.png`} alt="" width={112} height={112} className="h-24 w-24 sm:h-28 sm:w-28" style={{ opacity: on ? 1 : 0.75 }} draggable={false} />
                  <span className="text-[16px] text-fg">{SEAT_NAMES[s.id].name}</span>
                  <span className="text-[12px]" style={{ color: col }}>{s.role}</span>
                  <span className="mt-2 text-[13px] leading-5 text-fg-muted">{s.line}</span>
                </button>
              )
            })}
          </div>
        </section>

        <div className="sticky bottom-0 z-10 -mx-4 mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <button className="btn btn-primary h-11 px-6 text-[15px]" disabled={engine !== 'ready'} onClick={() => void begin()}>
            {engine === 'loading' ? 'Loading the game…' : engine === 'failed' ? 'The game didn’t load' : `Play Vault #${vault}`}
          </button>
          <p className="text-[13px] text-fg-faint">
            {vault === today ? 'Today’s vault: everyone plays the same five seeds today.' : `Vault #${vault}, the same seeds your friend played.`}
            {' '}<Link to="/party" className="text-fg-muted underline decoration-white/25 underline-offset-4 hover:text-fg">Abilities</Link>
          </p>
        </div>
        {error && <p className="mt-4 text-[14px] text-bad">{error}</p>}

        <section className="mt-16 grid gap-6 border-t border-line pt-10 text-[14px] leading-6 text-fg-muted md:grid-cols-3">
          <div><h3 className="text-[15px] font-medium text-fg">How you play</h3><p className="mt-2">Pick a move (or tap the floor) and a priority list of abilities and targets. Your character uses the first one that's ready, every tick, until you change it.</p></div>
          <div><h3 className="text-[15px] font-medium text-fg">What you know</h3><p className="mt-2">Your party's abilities and the affixes, nothing about the enemies. After a wipe you read the same combat log the agents read, and write yourself notes.</p></div>
          <div><h3 className="text-[15px] font-medium text-fg">Fair to the AI</h3><p className="mt-2">You see the fight in 3D; the agents read it as text (the eye button shows you exactly what they read). Your games are never on the leaderboard.</p></div>
        </section>
      </div>
    </Page>
  )
}

function Challenge({ r }: { r: Shared }) {
  const who = SEAT_NAMES[r.seat]
  return (
    <div className="mt-8 rounded-xl border border-white/15 bg-surface-raised p-4">
      <div className="text-[13px] text-fg-faint">A friend's result, Vault #{r.vault} ({TIER_NAME[r.tier]})</div>
      <div className="mt-1 text-[18px] text-fg">{who.name}: {headline(r)}</div>
      <div className="mt-3 flex gap-1.5"><PullSquares pulls={r.pulls} /></div>
      <p className="mt-3 text-[14px] text-fg-muted">Same seeds, same seat picked for you below. Your turn.</p>
    </div>
  )
}

function PullSquares({ pulls, big = false }: { pulls: { score: number; cleared: boolean }[]; big?: boolean }) {
  return (
    <>
      {Array.from({ length: MAX_PULLS }, (_, k) => {
        const p = pulls[k]
        const c = !p ? 'rgba(255,255,255,0.08)' : p.cleared ? '#4ade80' : p.score >= 21 ? '#fbbf24' : '#f87171'
        return (
          <div key={k} className={`grid place-items-center rounded-lg border font-mono ${big ? 'h-14 w-14 text-[16px]' : 'h-9 w-9 text-[12px]'}`}
            style={{ borderColor: c, background: p ? `${c}22` : undefined, color: p ? '#ededef' : '#8b8b93' }} title={p ? `Pull ${k + 1}: ${p.score.toFixed(1)}${p.cleared ? ', cleared' : ''}` : `Pull ${k + 1}`}>
            {p ? p.score.toFixed(0) : k + 1}
          </div>
        )
      })}
    </>
  )
}

// ---- The game -------------------------------------------------------------------

function Game() {
  const phase = usePlay((s) => s.phase)
  const ended = usePlay((s) => s.ended)
  const finishPull = usePlay((s) => s.finishPull)
  const ask = usePlay((s) => s.ask)
  const rules = usePlay((s) => s.rules)
  const notes = usePlay((s) => s.notes)
  const caught = usePlayback((p) => !!p.engine && p.t >= p.engine.duration - 1)
  const [ai, setAi] = useState(false)
  const [notesOpen, setNotesOpen] = useState(true)
  const seat = usePlay((s) => s.seat)
  useEffect(() => { picking.follow = seat; return () => { picking.follow = null } }, [seat])
  // The pull is over once the viewer has shown its end.
  useEffect(() => { if (ended && caught) finishPull() }, [ended, caught, finishPull])

  return (
    <div className="viewer fixed inset-0 z-40 overflow-hidden bg-bg">
      <Scene />
      <WorldOverlay />
      <div className="pointer-events-none absolute inset-0">
        <TopBar />
        <div className="hud-top absolute inset-x-4 top-[64px]">
          <div className="hud-s no-phone justify-self-start [grid-area:party]"><PartyFrames /></div>
          <div className="phone-only [grid-area:party]"><CompactParty /></div>
          <div className="hud-s relative justify-self-center [grid-area:boss]"><RaidWarnings /></div>
          <div className="hud-s hud-side flex flex-col gap-2 justify-self-end [grid-area:side]">
            <Scorecard />
            {notes.trim() && (
              <div className="card pointer-events-auto w-[272px] px-3 py-2">
                <button onClick={() => setNotesOpen(!notesOpen)} className="label w-full text-left">Your notes {notesOpen ? '' : '(show)'}</button>
                {notesOpen && <p className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-fg-muted">{notes}</p>}
              </div>
            )}
          </div>
        </div>
        {phase === 'playing' && (
          <div className="absolute inset-x-2 bottom-2 flex justify-center sm:inset-x-4 sm:bottom-4">
            <div className="hud-s w-full max-w-[780px]"><Tips /><Orders onAiView={() => setAi(true)} /></div>
          </div>
        )}
        {phase === 'loading' && <Center><div className="card px-5 py-4 text-[14px] text-fg-muted">Setting up the pull…</div></Center>}
        {phase === 'between' && <Between />}
        {phase === 'done' && <Done />}
        {ai && <AiView ask={ask} rules={rules} onClose={() => setAi(false)} />}
      </div>
    </div>
  )
}

/** Three tips on a first game, until dismissed (remembered in this browser). */
function Tips() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('mb:play:tips') !== 'seen' } catch { return true } })
  if (!open) return null
  const close = () => { setOpen(false); try { localStorage.setItem('mb:play:tips', 'seen') } catch { /* storage off */ } }
  return (
    <div className="card pointer-events-auto mb-2 flex items-start gap-3 px-3 py-2.5 text-[13px] leading-5 text-fg-muted">
      <ul className="min-w-0 flex-1 space-y-1">
        <li><span className="text-fg">Attack:</span> pick an ability, then a target in the list or in the scene. Enemies are numbered on their nameplates.</li>
        <li><span className="text-fg">Move:</span> Next waypoint follows the route to the boss; or tap the floor. Your character holds still otherwise.</li>
        <li><span className="text-fg">Keys:</span> 1 to 5 pick abilities, Enter sends, Space keeps your orders, Esc cancels.</li>
      </ul>
      <button className="icon-btn h-7 w-7" onClick={close} aria-label="Hide tips"><X size={14} /></button>
    </div>
  )
}

function TopBar() {
  const { vault, tier, seat, pull, quit } = usePlay()
  return (
    <div className="pointer-events-auto absolute inset-x-0 top-0 flex h-12 items-center gap-3 border-b border-line bg-[rgba(15,15,16,0.92)] px-4">
      <span className="text-[14px] font-medium text-fg">MythicBench</span>
      <span className="truncate text-[13px] text-fg-muted">
        Vault #{vault}, {TIER_NAME[tier]}. You are <span style={{ color: CLASS_COLORS[SEAT_NAMES[seat].cls] }}>{SEAT_NAMES[seat].name}</span>. Pull {pull} of {MAX_PULLS}
      </span>
      <span className="flex-1" />
      <button className="btn" onClick={() => { if (confirm('Leave this run? It won’t be saved.')) quit() }}><LogOut size={14} /><span className="hidden sm:inline">Leave</span></button>
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="pointer-events-auto absolute inset-0 z-20 grid place-items-center bg-black/40 p-4">{children}</div>
}

function outcomeText(p: PullResult): string {
  const m = p.metrics
  if (m.in_time) return `Cleared in ${fmtTime(m.duration_s * 1000)}`
  if (m.outcome === 'victory') return 'Cleared, but over time'
  return m.outcome === 'timeout' ? 'Out of time' : 'Wipe'
}

function Between() {
  const { pulls, pull, notes, setNotes, nextPull, seat } = usePlay()
  const replay = usePlayback((p) => p.engine?.replay ?? null)
  const names = useNames(replay)
  const p = pulls[pulls.length - 1]
  const [log, setLog] = useState(false)
  const [review, setReview] = useState(false)
  if (!p) return null
  if (review) return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-4 flex justify-center">
      <button className="btn btn-primary" onClick={() => setReview(false)}>Back to the debrief</button>
    </div>
  )
  return (
    <Center>
      <div className="card max-h-[calc(100vh-96px)] w-full max-w-[640px] overflow-auto p-5">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-[20px] text-fg">Pull {p.pull}: {outcomeText(p)}</h2>
          <span className="num font-mono text-[24px] text-fg">{p.metrics.score.toFixed(1)}</span>
        </div>
        <div className="mt-3 flex gap-1.5"><PullSquares pulls={pulls.map((x) => ({ score: x.metrics.score, cleared: x.metrics.in_time }))} /></div>
        <p className="mt-3 text-[14px] text-fg-muted">
          {p.expert ? <>With the expert in your seat, this pull scored {p.expert.score.toFixed(1)}{p.expert.in_time ? ' (a clear)' : ''}.</> : 'Working out what the expert would have scored in your seat…'}
          {p.metrics.deaths.some((d) => d.unit === seat) && ` ${names[seat]} died.`}
        </p>

        <button onClick={() => setLog(!log)} className="mt-4 text-[13px] text-fg-muted underline decoration-white/25 underline-offset-4 hover:text-fg">
          {log ? 'Hide' : 'Read'} the combat log the AI agents get after a wipe
        </button>
        {log && <pre className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-lg bg-white/[0.03] p-3 font-mono text-[12px] leading-5 text-fg-muted">{p.debrief}</pre>}

        <label className="mt-5 block text-[13px] font-medium text-fg" htmlFor="notes">Your notes for the next pull</label>
        <p className="text-[12px] text-fg-faint">What the agents do here: write down what you learned. They stay on screen next pull.</p>
        <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 2000))} rows={4}
          className="mt-2 w-full rounded-lg border border-line bg-white/[0.03] p-2.5 text-[13px] text-fg placeholder:text-fg-faint focus:border-white/25 focus:outline-none"
          placeholder="e.g. the caster in the first pack needs a kick" />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="btn" onClick={() => { usePlayback.setState({ t: 0, playing: true }); setReview(true) }}>Watch it again</button>
          <button className="btn btn-primary" onClick={() => void nextPull()}>Pull {pull + 1} of {MAX_PULLS}</button>
        </div>
      </div>
    </Center>
  )
}

function Done() {
  const { pulls, vault, tier, seat, begin, quit } = usePlay()
  const { results } = useResults()
  const [copied, setCopied] = useState(false)
  const [card, setCard] = useState<string | null>(null)
  const r: Shared = { vault, tier, seat, pulls: pulls.map((p) => ({ score: p.metrics.score, cleared: p.metrics.in_time })) }
  const group = groupScore(r.pulls)
  const experts = pulls.map((p) => p.expert?.score).filter((x): x is number => x != null)
  const top = results ? modelsOnly(results).leaderboard[0] : null
  useEffect(() => {
    let url: string | null = null
    void drawCard(r).then((b) => { if (b) { url = URL.createObjectURL(b); setCard(url) } })
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [pulls.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    const text = shareText(r)
    const blob = await drawCard(r)
    const file = blob ? new File([blob], `mythicbench-vault-${vault}.png`, { type: 'image/png' }) : null
    try {
      if (file && navigator.canShare?.({ files: [file] })) { await navigator.share({ text, url: encode(r), files: [file] }); return }
      if (navigator.share) { await navigator.share({ text, url: encode(r) }); return }
    } catch { return /* cancelled */ }
    window.open(xIntent(r), '_blank', 'noopener')
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${shareText(r)}\n${encode(r)}`); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* blocked */ }
  }

  return (
    <Center>
      <div className="card max-h-[calc(100vh-96px)] w-full max-w-[680px] overflow-auto p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[13px] text-fg-faint">Vault #{vault}, {TIER_NAME[tier]}, as {SEAT_NAMES[seat].name}</div>
            <h2 className="mt-1 text-[26px] leading-tight text-fg">{headline(r)}</h2>
          </div>
          <button className="icon-btn" onClick={quit} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="mt-4 flex gap-2"><PullSquares pulls={r.pulls} big /></div>
        <dl className="mt-4 grid gap-2 text-[14px] sm:grid-cols-2">
          {group != null && <Row k="Group score, as on the leaderboard" v={group.toFixed(1)} />}
          {experts.length > 0 && <Row k="The expert in your seat, same seeds" v={(experts.reduce((a, b) => a + b, 0) / experts.length).toFixed(1)} sub="mean pull score" />}
          {tier === 'plus10' && top && <Row k={`${modelName(top.model)}, all five seats`} v={(top.tiers.plus10?.progression_score ?? top.mythicbench_score ?? 0).toFixed(1)} sub="group score" />}
        </dl>
        {card && <img src={card} alt="Your result card" className="mt-4 w-full rounded-lg border border-line" />}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => void share()}><Share2 size={14} />Share</button>
          <button className="btn" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy result'}</button>
          {card && <a className="btn" href={card} download={`mythicbench-vault-${vault}.png`}><Download size={14} />Save image</a>}
          <span className="flex-1" />
          <button className="btn" onClick={() => void begin()}>Play again</button>
          <button className="btn" onClick={quit}>Try another seat</button>
        </div>
        <p className="mt-4 text-[12px] leading-5 text-fg-faint">
          Not a like-for-like comparison: you had four expert bots, and the models played every seat themselves.
          {' '}<Link to="/" className="text-fg-muted underline decoration-white/25 underline-offset-4 hover:text-fg">See how the models did</Link>
        </p>
      </div>
    </Center>
  )
}

function Row({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <dt className="text-[12px] text-fg-faint">{k}</dt>
      <dd className="num mt-0.5 font-mono text-[18px] text-fg">{v}{sub && <span className="ml-2 font-sans text-[12px] text-fg-faint">{sub}</span>}</dd>
    </div>
  )
}
