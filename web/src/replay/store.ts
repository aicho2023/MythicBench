// Global playback state (zustand = a tiny state library; components can
// subscribe to just the slice they need, so the HUD doesn't re-render the 3D scene).
import { modelName, pullLabel } from '../content/display'
import { create } from 'zustand'
import { ReplayEngine } from './engine'
import type { Catalog, CatalogItem, CatalogRun, Replay, ReplayIndexEntry } from './types'
import { fetchMaybeGzipJson, fetchResults, parseWatchPath, watchPath, type Results } from '../site/results'
import { resultsCatalogRuns, resultsIndexEntries } from '../site/watchData'
import { FEATURED, REFERENCE_PROVIDERS, SHOW_REFERENCE_RUNS } from '../site/config'

/** Index id for one item (seed, or episode+pull) of a model run. */
export const runItemId = (runId: string, it: Pick<CatalogItem, 'seed' | 'episode' | 'pull'>) =>
  it.pull !== undefined ? `${runId}/e${it.episode}-p${it.pull}` : `${runId}/seed-${it.seed}`

interface LoadOptions {
  /** apply ?t=, ?paused=, ?speed= from the address bar, and leave the address as it is */
  deepLink?: boolean
  /** don't touch the address bar (the home page teaser) */
  quiet?: boolean
  /** start here instead of 0 (ms) */
  startMs?: number
}

interface Playback {
  index: ReplayIndexEntry[]
  catalog: Catalog | null
  currentId: string | null
  engine: ReplayEngine | null
  error: string | null
  t: number
  playing: boolean
  speed: number
  /** Load the replay list once (idempotent). */
  ensureIndex: () => Promise<void>
  /** Open what the address bar names, if anything; returns whether it named a replay. */
  openFromUrl: (opts?: { fallback?: boolean }) => Promise<boolean>
  load: (id: string, opts?: LoadOptions) => Promise<void>
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
    label: it.pull !== undefined ? `${who}, ${pullLabel(it.episode, it.pull)}` : `${who}, seed ${it.seed}`,
    blurb: `${run.label}, run ${run.run_id}`,
    file: `local/${it.file}`, outcome: it.outcome, duration_s: it.duration_s, score: it.score,
    local: true, runId: run.run_id,
  }))
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    // Static hosts answer unknown paths with index.html (SPA fallback), so check the type.
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return await res.json()
  } catch { /* missing */ }
  return null
}

let indexPromise: Promise<void> | null = null
/** The replay on screen came from a quiet load (the home teaser), not from a /watch address. */
let quietLoaded = false

/** The replay a /watch address names: path, ?replay=<id>, or ?run=<id>&episode=&pull= (or &seed=). */
function targetFromUrl(index: ReplayIndexEntry[], catalog: Catalog | null): string | null {
  const q = new URLSearchParams(location.search)
  const want = parseWatchPath(location.pathname)
  if (want) {
    const runs = index.filter((e) => e.path && e.runId?.startsWith(`results:${want.model}:`))
    const pick = runs.find((e) => e.path === watchPath({ model: want.model, tier: want.tier ?? '', memory: want.memory ?? true, episode: want.episode ?? -1, pull: want.pull ?? -1 }))
      // A partial address (/watch/<model>[/<tier>]): that model's first pull on the tier, +10 first.
      ?? runs.find((e) => (want.tier ? e.path!.startsWith(`/watch/${encodeURIComponent(want.model)}/${want.tier}/`) : e.path!.includes('/plus10/')))
      ?? runs[0]
    if (pick) return pick.id
  }
  const replay = q.get('replay')
  if (replay && index.some((r) => r.id === replay)) return replay
  const runQ = q.get('run')
  if (runQ && catalog) {
    const run = catalog.runs.find((r) => r.run_id === runQ) ?? catalog.runs.find((r) => r.run_id.includes(runQ))
    const num = (k: string) => (q.get(k) !== null ? Number(q.get(k)) : undefined)
    const item = run?.items.find((it) => it.pull !== undefined
      ? (num('episode') ?? it.episode) === it.episode && (num('pull') ?? it.pull) === it.pull
      : (num('seed') ?? it.seed) === it.seed)
    if (run && item) return runItemId(run.run_id, item)
  }
  return null
}

export const usePlayback = create<Playback>((set, get) => ({
  index: [],
  catalog: null,
  currentId: null,
  engine: null,
  error: null,
  t: 0,
  playing: false,
  speed: 1,
  ensureIndex: () => {
    indexPromise ??= (async () => {
      try {
        const res = await fetch(`${base}replays/index.json`)
        const index: ReplayIndexEntry[] = await res.json()
        // The published results dataset (leaderboard models, every pull), if present.
        let results: Results | null = null
        try { results = await fetchResults() } catch { /* no dataset */ }
        // Model runs saved on this machine (`python -m mythicsim llm ...` publishes
        // them to replays/local/catalog.json), if any. Local development only.
        const saved = await fetchJson<Catalog>(`${base}replays/local/catalog.json`)
        // Mock and scripted runs saved locally stay out of the run list unless references are on.
        const local = saved && !SHOW_REFERENCE_RUNS
          ? { ...saved, runs: saved.runs.filter((r) => !REFERENCE_PROVIDERS.includes(r.provider)) }
          : saved
        const fromResults = results ? resultsCatalogRuns(results) : []
        const catalog: Catalog | null = local || results
          ? { current_harness_version: local?.current_harness_version ?? results!.harness_version, runs: [...fromResults, ...(local?.runs ?? [])] }
          : null
        const entries = [...(results ? resultsIndexEntries(results) : []), ...(local?.runs ?? []).flatMap(runEntries)]
        // The home page's featured clip (a real model's pull), loadable by id but not listed.
        const featured: ReplayIndexEntry = {
          id: FEATURED.id, policy: 'llm', seed: 0, label: FEATURED.label, blurb: FEATURED.caption,
          file: FEATURED.file, url: `${base}${FEATURED.file}`, outcome: 'timeout', duration_s: 0,
        }
        entries.push(featured)
        set({ index: [...index, ...entries], catalog })
      } catch (err) {
        set({ error: `Could not load replays: ${String(err)}. Run \`npm run replays\`.` })
      }
    })()
    return indexPromise
  },
  openFromUrl: async ({ fallback = false } = {}) => {
    const { index, catalog, currentId, engine } = get()
    const want = targetFromUrl(index, catalog)
    if (want) {
      if (want !== currentId || quietLoaded) await get().load(want, { deepLink: true })
      return true
    }
    if (fallback && (!engine || quietLoaded) && index.length) {
      // Plain /watch: the leaderboard's top model on +10 if there is one, else (only
      // when references are on) the first showcase. Visitors never land on a bot run.
      const models = index.filter((e) => e.local)
      const top = models.find((e) => e.path?.includes('/plus10/')) ?? models[0]
        ?? index.find((e) => e.id === FEATURED.id) ?? (SHOW_REFERENCE_RUNS ? index[0] : undefined)
      if (top) await get().load(top.id, { deepLink: true })
      else set({ error: 'No model runs to watch yet. The official results are coming soon.' })
    }
    return false
  },
  load: async (id, opts = {}) => {
    const entry = get().index.find((r) => r.id === id)
    if (!entry) return
    let replay: Replay
    try {
      replay = await fetchMaybeGzipJson<Replay>(entry.url ?? `${base}replays/${entry.file}`)
    } catch (err) {
      set({ error: `Could not load ${entry.label}: ${String(err)}` })
      return
    }
    // Deep links: ?t=<seconds>&paused=1&speed=2 jump straight to a moment.
    const q = new URLSearchParams(location.search)
    const deep = !!opts.deepLink
    const t0 = deep && q.get('t') ? Number(q.get('t')) * 1000 : opts.startMs ?? 0
    const playing = !(deep && q.get('paused') === '1')
    if (deep && q.get('speed')) set({ speed: Number(q.get('speed')) })
    const engine = new ReplayEngine(replay)
    quietLoaded = !!opts.quiet
    set({ engine, currentId: id, error: null, t: Math.max(0, Math.min(engine.duration, t0)), playing })
    if (!deep && !opts.quiet && location.pathname.startsWith('/watch')) {
      // Keep the address bar shareable: it always names the replay on screen.
      const url = new URL(location.href)
      for (const k of ['t', 'paused', 'run', 'seed', 'episode', 'pull', 'replay']) url.searchParams.delete(k)
      if (entry.path) url.pathname = entry.path
      else {
        url.pathname = '/watch'
        if (entry.runId) {
          url.searchParams.set('run', entry.runId)
          const m = /\/e(\d+)-p(\d+)$/.exec(id)
          if (m) { url.searchParams.set('episode', m[1]); url.searchParams.set('pull', m[2]) }
          else url.searchParams.set('seed', String(entry.seed))
        } else url.searchParams.set('replay', id)
      }
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
