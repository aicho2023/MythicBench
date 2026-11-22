// The results dataset: what `python -m mythicsim results <protocol> --out <dir>`
// writes (sim/mythicsim/campaign.py, build_results). The site reads nothing else.
import { RESULTS_DIR, resultsUrl } from './config'

export type CI = [number, number] | null

export interface PullResult {
  pull: number; seed: number; score: number; outcome: string; duration_s: number
  /** a kill only counts as a clear when it's within the timer */
  in_time?: boolean
  deaths?: number; kicks?: [number, number]; avoidable?: number
  /** path inside the dataset, e.g. replays/<model>/<tier>/ep0-pull1.json.gz */
  file: string
  usd: number | null
}

export interface EpisodeResult { episode: number; run_id: string; pulls: PullResult[] }

/** One model on one tier (or a memory-off control). */
export interface TierCell {
  episodes: number; pulls: number
  /** every planned episode finished (incomplete cells are shown, never ranked) */
  complete?: boolean
  progression_score: number; progression_score_ci95: CI
  /** each episode's progression score (the unit the interval is over) */
  episode_scores?: number[]
  /** timed clears only. pulls_to_clear: the clearing pull, or null for an episode that didn't clear */
  clear_rate: number | null; pulls_to_clear_mean: number | null; pulls_to_clear: (number | null)[]
  /** memory on minus the memory-off control (same seeds), when the protocol has a control here */
  learning_effect?: number; learning_effect_ci95?: CI
  first_pull_score_mean: number | null
  curve_mean: number[] | null
  cost_usd: number; usd_per_pull: number | null; tokens_per_pull: [number, number] | null
  refusals: number; unusable_replies: number; truncated_replies?: number; api_errors?: number; pulls_out_of_calls?: number
  harness_versions: string[]
  episode_list: EpisodeResult[]
}

export interface LeaderboardRow {
  model: string; provider: string; name: string; effort: string | null
  tiers: Record<string, TierCell>
  mythicbench_score: number | null; mythicbench_score_ci95?: CI
  cost_usd?: number
  /** 1-based; null when a cell is incomplete (shown, not ranked) */
  rank?: number | null; complete?: boolean
}

export interface ControlRow extends TierCell { model: string; tier: string; memory: false }

export interface BotScore { progression_score_mean: number; progression_score_ci95: CI; episodes?: number }

export interface Results {
  protocol: {
    name: string; description?: string; mode: string; knowledge: string; tiers: string[]
    episodes: number; max_pulls: number; effort: string; models: string[]
    controls?: { model: string; memory: boolean; tiers?: string[] }[]
  }
  harness_version: string; content_version: string; sim_version?: string
  tiers: Record<string, { name: string; affixes: string[] }>
  leaderboard: LeaderboardRow[]
  controls: ControlRow[]
  bots?: Record<string, Record<string, BotScore>>
}

let cached: Promise<Results> | null = null

/** leaderboard.json, fetched once per page load. */
export function fetchResults(): Promise<Results> {
  cached ??= fetch(resultsUrl('leaderboard.json')).then(async (res) => {
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
      throw new Error(`No results at ${RESULTS_DIR}/leaderboard.json`)
    }
    return res.json() as Promise<Results>
  })
  cached.catch(() => { cached = null })
  return cached
}

/**
 * Fetch JSON that may be gzipped on disk (`.json.gz`). Hosts serve these as
 * application/gzip, so we decompress in the browser; if a host already decoded
 * it (Content-Encoding: gzip), the bytes are plain JSON and are used as is.
 */
export async function fetchMaybeGzipJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} for ${url}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return JSON.parse(await gunzipIfNeeded(bytes)) as T
}

export async function gunzipIfNeeded(bytes: Uint8Array): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const LAB_NAMES: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', mock: 'No API (mock)' }
export const labName = (provider: string) => LAB_NAMES[provider] ?? provider

/**
 * Series colors in one fixed order, assigned by a model's position in the
 * protocol (never by rank), so a model keeps its color on every chart.
 * Validated on the dark surface #111113: adjacent pairs pass; at seven series
 * not every pair separates, so charts also label each series by name.
 */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9']
export function modelColor(r: Results, model: string): string {
  const i = r.protocol.models.indexOf(model)
  return SERIES[(i < 0 ? r.protocol.models.length : i) % SERIES.length]
}

export const BOT_NAMES: Record<string, string> = { expert: 'Expert bots', competent: 'Competent bots', sloppy: 'Sloppy bots' }

/** Tier ids in protocol order, e.g. ['normal', 'plus10']. */
export const tierIds = (r: Results) => Object.keys(r.tiers)
export const tierName = (r: Results, tier: string) => r.tiers[tier]?.name ?? tier

/** What one blind episode on every tier costs at list prices (one "run" of the benchmark). */
export function costPerRun(row: LeaderboardRow): number | null {
  const cells = Object.values(row.tiers)
  if (!cells.length) return null
  return cells.reduce((s, c) => s + c.cost_usd / Math.max(1, c.episodes), 0)
}

/** The bots' headline score, combined across tiers the same way as a model's. */
export function botHeadline(r: Results, bot: string): { score: number; ci: CI } | null {
  const tiers = tierIds(r)
  const cells = tiers.map((t) => r.bots?.[t]?.[bot])
  if (!cells.length || cells.some((c) => !c)) return null
  const means = cells.map((c) => c!.progression_score_mean)
  const ses = cells.map((c) => (c!.progression_score_ci95 ? (c!.progression_score_ci95[1] - c!.progression_score_ci95[0]) / (2 * 1.96) : 0))
  const mean = means.reduce((a, b) => a + b, 0) / means.length
  const half = (1.96 * Math.sqrt(ses.reduce((s, x) => s + x * x, 0))) / ses.length
  return { score: round1(mean), ci: [round1(mean - half), round1(mean + half)] }
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function fmtUsd(x: number | null | undefined): string {
  if (x == null) return '–'
  if (x === 0) return '$0'
  if (x < 0.1) return `$${x.toFixed(3)}`
  if (x < 100) return `$${x.toFixed(2)}`
  return `$${Math.round(x).toLocaleString('en-US')}`
}
export const fmtScore = (x: number | null | undefined) => (x == null ? '–' : x.toFixed(1))
export const fmtPct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`)

// ---------------------------------------------------------------------------
// Replay addresses: /watch/<model>/<tier>/[memory-off/]<episode>/<pull>
// ---------------------------------------------------------------------------

export interface PullAddress { model: string; tier: string; memory: boolean; episode: number; pull: number }

/** Catalog run id for one model x tier (x memory) cell. No slashes: the run list splits ids on "/". */
export const resultsRunId = (model: string, tier: string, memory: boolean) =>
  `results:${model}:${tier}${memory ? '' : ':memory-off'}`

export const watchPath = (a: PullAddress) =>
  `/watch/${encodeURIComponent(a.model)}/${a.tier}/${a.memory ? '' : 'memory-off/'}${a.episode}/${a.pull}`

/** Parses a /watch path. `{ model }` alone for /watch/<model>; null for /watch or anything else. */
export function parseWatchPath(path: string): (Partial<PullAddress> & { model: string }) | null {
  const parts = path.split('/').filter(Boolean)
  if (parts[0] !== 'watch' || parts.length < 2) return null
  const model = decodeURIComponent(parts[1])
  if (parts.length === 2) return { model }
  const tier = parts[2]
  const memory = parts[3] !== 'memory-off'
  const rest = parts.slice(memory ? 3 : 4)
  const num = (s?: string) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined)
  return { model, tier, memory, episode: num(rest[0]), pull: num(rest[1]) }
}

/** A model's per-episode headline: the mean of its tier scores episode by episode (tiers share seeds). */
export function episodeHeadlines(row: LeaderboardRow): number[] {
  const cells = Object.values(row.tiers)
  const n = Math.min(...cells.map((c) => c.episode_scores?.length ?? 0))
  if (!cells.length || !isFinite(n) || n === 0) return []
  return Array.from({ length: n }, (_, k) => cells.reduce((a, c) => a + c.episode_scores![k], 0) / cells.length)
}
