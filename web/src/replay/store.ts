// Global playback state (zustand = a tiny state library; components can
// subscribe to just the slice they need, so the HUD doesn't re-render the 3D scene).
import { modelName } from '../content/display'
import { create } from 'zustand'
import { ReplayEngine } from './engine'
import type { Catalog, CatalogItem, CatalogRun, Replay, ReplayIndexEntry } from './types'

/** Index id for one seed of a model run. */

/** Index id for one item (seed, or episode+pull) of a model run. */
export const runItemId = (runId: string, it: Pick<CatalogItem, 'seed' | 'episode' | 'pull'>) =>
  it.pull !== undefined ? `${runId}/e${it.episode}-p${it.pull}` : `${runId}/seed-${it.seed}`

interface Playback {
  index: ReplayIndexEntry[]
  catalog: Catalog | null
  currentId: string | null
  engine: ReplayEngine | null
  error: string | null
  t: number
  playing: boolean
  speed: number
  loadIndex: () => Promise<void>
  load: (id: string) => Promise<void>
  seek: (t: number) => void
  advance: (dtMs: number) => void
  toggle: () => void
  setPlaying: (p: boolean) => void
  setSpeed: (s: number) => void
}

const base = import.meta.env.BASE_URL

function runEntries(run: CatalogRun): ReplayIndexEntry[] {
  const who = modelName(run.model)
  return run.items.map((it) => ({
    id: runItemId(run.run_id, it), policy: `llm:${run.label}`, seed: it.seed,
    label: it.pull !== undefined ? `${who}, episode ${it.episode} pull ${it.pull}` : `${who}, seed ${it.seed}`,
    blurb: `${run.label}, run ${run.run_id}`,
    file: `local/${it.file}`, outcome: it.outcome, duration_s: it.duration_s, score: it.score,
    local: true, runId: run.run_id,
  }))
}
let deepLinkUsed = false
let indexRequested = false

export const usePlayback = create<Playback>((set, get) => ({
  index: [],
  catalog: null,
  currentId: null,
  engine: null,
  error: null,
  t: 0,
  playing: false,
  speed: 1,
  loadIndex: async () => {
    // React StrictMode runs effects twice in dev; only load once.
    if (indexRequested) return
    indexRequested = true
    try {
      const res = await fetch(`${base}replays/index.json`)
      const index: ReplayIndexEntry[] = await res.json()
      // Model runs saved on this machine (`python -m mythicsim llm ...` publishes
      // them to replays/local/catalog.json), if any.
      let catalog: Catalog | null = null
      try {
        const local = await fetch(`${base}replays/local/catalog.json`)
        if (local.ok && (local.headers.get('content-type') ?? '').includes('json')) catalog = await local.json()
      } catch { /* no local runs */ }
      for (const run of catalog?.runs ?? []) index.push(...runEntries(run))
      set({ index, catalog })
      // Deep links: ?replay=<id>, or ?run=<run id or unique part>&seed=N
      const q = new URLSearchParams(location.search)
      let want = q.get('replay')
      const runQ = q.get('run')
      if (runQ && catalog) {
        const run = catalog.runs.find((r) => r.run_id === runQ) ?? catalog.runs.find((r) => r.run_id.includes(runQ))
        const num = (k: string) => (q.get(k) !== null ? Number(q.get(k)) : undefined)
        const item = run?.items.find((it) => it.pull !== undefined
          ? (num('episode') ?? it.episode) === it.episode && (num('pull') ?? it.pull) === it.pull
          : (num('seed') ?? it.seed) === it.seed)
        if (run && item) want = runItemId(run.run_id, item)
      }
      await get().load(index.find((r) => r.id === want)?.id ?? index[0].id)
    } catch (err) {
      set({ error: `Could not load replays: ${String(err)}. Run \`npm run replays\`.` })
    }
  },
  load: async (id) => {
    const entry = get().index.find((r) => r.id === id)
    if (!entry) return
    const res = await fetch(`${base}replays/${entry.file}`)
    const replay: Replay = await res.json()
    // Deep links: ?replay=<id>&t=<seconds>&paused=1 jump straight to a moment.
    const q = new URLSearchParams(location.search)
    const first = !deepLinkUsed
    deepLinkUsed = true
    const t0 = first && q.get('t') ? Number(q.get('t')) * 1000 : 0
    const playing = !(first && q.get('paused') === '1')
    if (q.get('speed') && first) set({ speed: Number(q.get('speed')) })
    const engine = new ReplayEngine(replay)
    set({ engine, currentId: id, t: Math.max(0, Math.min(engine.duration, t0)), playing })
    if (!first) {
      // Keep the address bar shareable: it always names the replay on screen.
      const url = new URL(location.href)
      for (const k of ['t', 'paused', 'run', 'seed', 'episode', 'pull']) url.searchParams.delete(k)
      if (entry.runId) {
        url.searchParams.delete('replay')
        url.searchParams.set('run', entry.runId)
        const m = /\/e(\d+)-p(\d+)$/.exec(id)
        if (m) { url.searchParams.set('episode', m[1]); url.searchParams.set('pull', m[2]) }
        else url.searchParams.set('seed', String(entry.seed))
      } else url.searchParams.set('replay', id)
      history.replaceState(null, '', url)
    }
  },
  seek: (t) => {
    const e = get().engine
    if (!e) return
    set({ t: Math.max(0, Math.min(e.duration, t)) })
  },
  advance: (dtMs) => {
    const { engine, playing, t, speed } = get()
    if (!engine || !playing) return
    const next = t + dtMs * speed
    if (next >= engine.duration) set({ t: engine.duration, playing: false })
    else set({ t: next })
  },
  toggle: () => {
    const { playing, engine, t } = get()
    if (!playing && engine && t >= engine.duration) set({ t: 0 })
    set({ playing: !playing })
  },
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
}))

/** Read the current world state outside React (inside useFrame loops). */
export function frameState() {
  const { engine, t } = usePlayback.getState()
  if (!engine) return null
  const s = engine.stateAt(t)
  return { engine, s, t: s.t }
}

/**
 * React hook for HUD components: re-renders ~20x/second instead of every
 * frame. Cheap enough to keep the UI buttery while the 3D scene runs at 60fps.
 */
export function useHud() {
  usePlayback((p) => Math.floor(p.t / 50))
  const engine = usePlayback((p) => p.engine)
  if (!engine) return null
  const s = engine.stateAt(usePlayback.getState().t)
  return { engine, s, t: s.t }
}
