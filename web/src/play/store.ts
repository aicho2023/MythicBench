// The game on /play: a person plays one character by the agents' rules (the
// fight pauses whenever that character's agent would be asked), the expert
// script plays the other four. The simulator runs in a worker (sim.ts); this
// store keeps the run of up to five pulls and feeds what has been played so
// far to the 3D viewer, as a replay that grows.
import { create } from 'zustand'
import { ReplayEngine, EPILOGUE_MS } from '../replay/engine'
import { usePlayback } from '../replay/store'
import type { Replay, ReplayEvent } from '../replay/types'
import { sim, type Ask, type Metrics, type Orders } from './sim'

export const MAX_PULLS = 5
export type Tier = 'normal' | 'plus10'

/** Vault numbers count days from launch: everyone plays the same seeds on the same day. */
const LAUNCH = Date.UTC(2026, 11, 1)
export function todaysVault(now = Date.now()): number {
  const d = new Date(now)
  return Math.max(1, Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - LAUNCH) / 86_400_000) + 1)
}
/** The simulator's play seeds (sim/mythicsim/play.py: play_seed), far from the benchmark's. */
export const seedOf = (vault: number, pull: number) => 50_000_000 + vault * 10 + pull

export interface PullResult {
  pull: number
  seed: number
  metrics: Metrics
  debrief: string
  decisions: number
  replay: Replay | null
  /** The same pull with the expert in your seat too. */
  expert: Metrics | null
}

type Phase = 'lobby' | 'loading' | 'playing' | 'between' | 'done'

interface PlayState {
  phase: Phase
  error: string | null
  seat: string
  tier: Tier
  vault: number
  pull: number
  rules: string
  ask: Ask | null
  /** The sim has finished this pull; the viewer may still be catching up. */
  ended: { metrics: Metrics; debrief: string } | null
  busy: boolean
  /** Don't stop for routine check-ins: keep the orders and play on. */
  auto: boolean
  pulls: PullResult[]
  notes: string
  decisions: number
  /** Where the next move goes, picked on the floor (x, z). */
  marker: [number, number] | null
  picking: boolean
  setSeat: (s: string) => void
  setTier: (t: Tier) => void
  setVault: (v: number) => void
  setAuto: (a: boolean) => void
  setNotes: (n: string) => void
  setMarker: (m: [number, number] | null) => void
  setPicking: (p: boolean) => void
  begin: () => Promise<void>
  send: (text: string) => Promise<void>
  /** The viewer reached the end of the pull: show the result. */
  finishPull: () => void
  nextPull: () => Promise<void>
  quit: () => void
}

let head: Replay | null = null
let events: ReplayEvent[] = []
let chat: [number, string, string][] = []

/** The viewer's replay: what has been played so far, party chat in place (as add_chat_events does). */
function show(durationMs: number, final: boolean) {
  if (!head) return
  const all = [...events, ...chat.map(([t, unit, text]) => ({ t, type: 'chat', unit, text }) as ReplayEvent)]
  const rank = (e: ReplayEvent) => (e.type === 'encounter_end' ? 2 : e.type === 'chat' ? 1 : 0)
  all.sort((a, b) => a.t - b.t || rank(a) - rank(b))
  const replay: Replay = { ...head, meta: { ...head.meta, duration_ms: durationMs }, events: all }
  const pb = usePlayback.getState()
  const engine = new ReplayEngine(replay, final ? EPILOGUE_MS : 0)
  usePlayback.setState({ engine, currentId: 'play', error: null, t: Math.min(pb.engine?.replay.meta.policy === replay.meta.policy ? pb.t : 0, engine.duration), playing: true })
}

const routineOnly = (a: Ask) => a.why.length === 1 && a.why[0] === 'routine check-in'

export const usePlay = create<PlayState>((set, get) => ({
  phase: 'lobby', error: null, seat: 'wren', tier: 'normal', vault: todaysVault(), pull: 1, rules: '',
  ask: null, ended: null, busy: false, auto: true, pulls: [], notes: '', decisions: 0, marker: null, picking: false,
  setSeat: (seat) => set({ seat }),
  setTier: (tier) => set({ tier }),
  setVault: (vault) => set({ vault }),
  setAuto: (auto) => {
    set({ auto })
    const a = get().ask
    if (auto && a && routineOnly(a) && a.orders && !get().busy) void get().send('{}')
  },
  setNotes: (notes) => set({ notes }),
  setMarker: (marker) => set({ marker }),
  setPicking: (picking) => set({ picking }),

  begin: async () => {
    set({ phase: 'loading', error: null, pulls: [], pull: 1, notes: '' })
    await startPull(1)
  },

  send: async (text) => {
    if (get().busy || !get().ask) return
    set({ busy: true, marker: null, picking: false })
    try {
      const step = await sim.answer(text)
      set((s) => ({ decisions: s.decisions + 1 }))
      take(step)
    } catch (err) {
      set({ error: String(err), busy: false })
    }
  },

  finishPull: () => {
    const { ended, pull, seat, tier } = get()
    if (!ended) return
    const seed = seedOf(get().vault, pull)
    const result: PullResult = { pull, seed, metrics: ended.metrics, debrief: ended.debrief, decisions: get().decisions, replay: null, expert: null }
    const pulls = [...get().pulls, result]
    const over = ended.metrics.in_time || pull >= MAX_PULLS
    set({ pulls, phase: over ? 'done' : 'between', ended: null })
    remember(get().vault, tier, seat, pulls)
    // Keep the replay, and work out what the expert would have scored in this seat.
    void (async () => {
      try {
        const replay = await sim.replay()
        const expert = await sim.expert(seed, tier)
        set((s) => ({ pulls: s.pulls.map((p) => (p.pull === pull ? { ...p, replay, expert } : p)) }))
      } catch { /* the comparison is extra */ }
    })()
  },

  nextPull: async () => {
    const k = get().pull + 1
    set({ pull: k, phase: 'loading' })
    await startPull(k)
  },

  quit: () => {
    head = null; events = []; chat = []
    usePlayback.setState({ engine: null, currentId: null, playing: false, t: 0 })
    set({ phase: 'lobby', ask: null, ended: null, busy: false, pulls: [], marker: null, picking: false })
  },
}))

async function startPull(pull: number) {
  const { seat, tier, vault } = usePlay.getState()
  try {
    usePlay.setState({ busy: true, ask: null, ended: null, decisions: 0 })
    const start = await sim.start(seat, seedOf(vault, pull), tier, pull)
    head = start.replay_head
    head.meta.policy = `play:${seat}:${vault}:${pull}`
    events = []
    chat = []
    usePlayback.setState({ engine: null, t: 0 })
    usePlay.setState({ rules: start.rules, phase: 'playing' })
    take(start)
  } catch (err) {
    usePlay.setState({ error: `The game didn't load: ${String(err)}`, busy: false, phase: 'lobby' })
  }
}

function take(step: Awaited<ReturnType<typeof sim.answer>>) {
  events.push(...step.events)
  if (step.kind === 'ask') {
    chat = step.chat
    show(step.t, false)
    usePlay.setState({ ask: step, busy: false })
    // Auto: a routine check-in with orders already given plays on.
    if (usePlay.getState().auto && routineOnly(step) && step.orders) void usePlay.getState().send('{}')
  } else {
    const end = events.length ? events[events.length - 1].t : 0
    show(end, true)
    usePlay.setState({ ask: null, ended: { metrics: step.metrics, debrief: step.debrief }, busy: false })
  }
}

// ---- Scores ---------------------------------------------------------------

/** A group's score, as on the leaderboard: the mean over five pulls, a timed clear counting for every pull it saved. */
export function groupScore(pulls: { score: number; cleared: boolean }[]): number | null {
  if (!pulls.length) return null
  const cleared = pulls.some((p) => p.cleared)
  if (!cleared && pulls.length < MAX_PULLS) return null
  let last = 0
  const curve: number[] = []
  for (let k = 0; k < MAX_PULLS; k++) {
    last = pulls[k]?.score ?? last
    curve.push(last)
  }
  return curve.reduce((a, b) => a + b, 0) / MAX_PULLS
}

/** Best results so far, per vault, tier and seat, in this browser only. */
function remember(vault: number, tier: string, seat: string, pulls: PullResult[]) {
  try {
    const k = `mb:play:${vault}:${tier}:${seat}`
    localStorage.setItem(k, JSON.stringify(pulls.map((p) => [p.metrics.score, p.metrics.in_time ? 1 : 0])))
  } catch { /* storage off */ }
}

export function ordersText(o: { move: Orders['move_to']; priority: [string, string][] | null; say: string }): string {
  const out: Record<string, unknown> = {}
  if (o.move !== null) out.move_to = o.move
  if (o.priority !== null) out.priority = o.priority
  if (o.say.trim()) out.say = o.say.trim()
  return JSON.stringify(out)
}
