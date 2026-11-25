// The results dataset: what `python -m mythicsim results <protocol> --out <dir>`
// writes (sim/mythicsim/campaign.py, build_results). The site reads nothing else.
import { REFERENCE_PROVIDERS, RESULTS_DIR, SHOW_REFERENCE_RUNS, resultsUrl } from './config'

export type CI = [number, number] | null

export interface PullResult {
  pull: number; seed: number; score: number; outcome: string; duration_s: number
  /** a kill only counts as a clear when it's within the timer */
  in_time?: boolean
  deaths?: number; kicks?: [number, number]; avoidable?: number
  /** path inside the dataset, e.g. replays/<model>/<tier>/ep0-pull1.json.gz */
  file: string
  usd: number | null
  /** the pull's call counts, tokens and reply problems */
  stats?: Record<string, unknown>
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
  learning_effect_p?: number | null
  first_pull_score_mean: number | null
  curve_mean: number[] | null
  /** effort sweeps: the default effort on this sweep's own groups (a like-for-like comparison) */
  default_effort_same_groups?: { effort: string; episodes: number[]; progression_score: number; progression_score_ci95: CI; usd_per_episode: number }
  cost_usd: number; usd_per_pull: number | null; tokens_per_pull: [number, number] | null
  refusals: number; unusable_replies: number; truncated_replies?: number; api_errors?: number; pulls_out_of_calls?: number
  /** model calls made (the denominator for the reply-problem counts), and entries dropped from usable replies */
  calls?: number; invalid_entries?: number
  harness_versions: string[]
  episode_list: EpisodeResult[]
  /** Extra memory-on groups behind the paired learning effect (published, not on the leaderboard). */
  paired_episode_list?: EpisodeResult[]
  usd_per_episode?: number | null
  clears?: number
  episode_ids?: number[]
  sanity?: boolean
  learning_pairs?: { episode: number; on: number; off: number }[]
}

/** The same model at another reasoning effort (for score-vs-cost curves). */
export interface ConfigRow { model: string; provider: string; effort: string; tiers: Record<string, TierCell> }

export interface LeaderboardRow {
  model: string; provider: string; name: string; effort: string | null
  tiers: Record<string, TierCell>
  mythicbench_score: number | null; mythicbench_score_ci95?: CI
  cost_usd?: number
  /** 1-based; null when a cell is incomplete (shown, not ranked) */
  rank?: number | null; complete?: boolean
}

export interface ControlRow extends TierCell {
  model: string; tier: string; memory: false
  /** the memory-on curve over the control's own (paired) groups */
  paired_on_curve_mean?: number[] | null
}

export interface Results {
  protocol: {
    name: string; description?: string; mode: string; knowledge: string; tiers: string[]
    episodes: number; max_pulls: number; effort: string; models: string[]
    controls?: { model: string; memory: boolean; tiers?: string[] }[]
  }
  harness_version: string; content_version: string; sim_version?: string
  tiers: Record<string, { name: string; affixes: string[] }>
  /** the tier the MythicBench score is (+10); the others are shown, not ranked on */
  headline_tier?: string
  leaderboard: LeaderboardRow[]
  /** reference players through the same interface (the scripted commander): shown, never ranked */
  baselines?: LeaderboardRow[]
  /** The scripted bot's score, kept as a reference line when the bot's rows are hidden. */
  bot_score?: number | null
  /** The scripted bot's row, kept for the reference marks (leaderboard row, learning-chart line)
   * when baselines are hidden from the run browser. */
  bot?: LeaderboardRow | null
  /** effort sweeps: other reasoning efforts of some models, unranked */
  configs?: ConfigRow[]
  controls: ControlRow[]
  /** every pair of ranked models on the same seeds: mean paired difference (a minus b), its 95% CI,
   * the paired t-test p and its Holm adjustment; claim is the better model where the adjusted p < 0.05 */
  pairwise?: { a: string; b: string; episodes: number[]; n: number; mean: number; ci95: [number, number]; p: number; p_holm: number; claim: string | null }[]
}

let cached: Promise<Results> | null = null

/** leaderboard.json, fetched once per page load. */
export function fetchResults(): Promise<Results> {
  cached ??= fetch(resultsUrl('leaderboard.json')).then(async (res) => {
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
      throw new Error(`No results at ${RESULTS_DIR}/leaderboard.json`)
    }
    const r = await res.json() as Results
    return SHOW_REFERENCE_RUNS ? r : modelsOnly(r)
  })
  cached.catch(() => { cached = null })
  return cached
}

/** The dataset as visitors see it: real models only (no mock model or scripted commander). */
export function modelsOnly(r: Results): Results {
  const real = (provider: string) => !REFERENCE_PROVIDERS.includes(provider)
  const models = new Set(r.leaderboard.filter((row) => real(row.provider)).map((row) => row.model))
  return {
    ...r,
    leaderboard: r.leaderboard.filter((row) => models.has(row.model)),
    controls: r.controls.filter((c) => models.has(c.model)),
    baselines: [],
    bot_score: r.baselines?.find((b) => b.mythicbench_score != null)?.mythicbench_score ?? null,
    bot: botRow(r),
    configs: (r.configs ?? []).filter((c) => models.has(c.model)),
  }
}

/** The scripted bot's row (the reference everything is compared with), if the dataset has one. */
export function botRow(r: Results): LeaderboardRow | null {
  return r.bot ?? r.baselines?.find((b) => b.provider === 'scripted' && b.mythicbench_score != null) ?? null
}

/** Models a paired test says are better than at least one other: the ones the charts colour. */
export function clearLeaders(r: Results): Set<string> {
  return new Set((r.pairwise ?? []).flatMap((p) => (p.claim ? [p.claim] : [])))
}

/** The hero replay: the top model's best pull on the headline tier, or null before there are results. */
export function topPull(r: Results): { id: string; path: string; model: string; tier: string; episode: number; pull: number } | null {
  const row = r.leaderboard.find((x) => x.rank) ?? r.leaderboard[0]
  const tier = headlineTier(r)
  const pulls = row?.tiers[tier]?.episode_list.flatMap((ep) => ep.pulls.map((p) => ({ ep: ep.episode, ...p }))) ?? []
  if (!row || !pulls.length) return null
  const best = pulls.reduce((a, b) => (b.score > a.score ? b : a))
  return {
    id: `${resultsRunId(row.model, tier, true)}/e${best.ep}-p${best.pull}`,
    path: watchPath({ model: row.model, tier, memory: true, episode: best.ep, pull: best.pull }),
    model: row.model, tier, episode: best.ep, pull: best.pull,
  }
}

export const topPullId = (r: Results) => topPull(r)?.id ?? null

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

export const LAB_NAMES: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', xai: 'xAI', alibaba: 'Alibaba', deepseek: 'DeepSeek', mock: 'No API (mock)',
}
export const labName = (provider: string) => LAB_NAMES[provider] ?? provider

/**
 * Series colors in one fixed order, assigned by a model's position in the
 * protocol (never by rank), so a model keeps its color on every chart.
 * Validated on the dark surface #111113: adjacent pairs pass; at seven series
 * not every pair separates, so charts also label each series by name. The
 * seventh is cyan, not amber: amber beside the sixth (green) failed for protan vision.
 */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#9085e9', '#d55181', '#0ca30c', '#1fa3b8']
export function modelColor(r: Results, model: string): string {
  const i = r.protocol.models.indexOf(model)
  return SERIES[(i < 0 ? r.protocol.models.length : i) % SERIES.length]
}

/** Tier ids in protocol order, e.g. ['normal', 'plus10']. */
export const tierIds = (r: Results) => Object.keys(r.tiers)
export const tierName = (r: Results, tier: string) => r.tiers[tier]?.name ?? tier

/** What one blind episode on every tier costs at list prices (one "run" of the benchmark). */
/** What one episode on the headline tier (+10) costs at list prices: the cost next to the score. */
export function costPerRun(row: LeaderboardRow, r?: Results): number | null {
  const cell = r ? row.tiers[headlineTier(r)] : Object.values(row.tiers)[0]
  if (!cell) return null
  return cell.usd_per_episode ?? cell.cost_usd / Math.max(1, cell.episodes)
}

/** The tier the headline score is (older datasets: the last tier). */
export const headlineTier = (r: Results) => r.headline_tier ?? (tierIds(r).includes('plus10') ? 'plus10' : tierIds(r)[tierIds(r).length - 1])

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

/** A model's per-episode headline scores: its episodes on the headline tier. */
export function episodeHeadlines(r: Results, row: LeaderboardRow): number[] {
  return row.tiers[headlineTier(r)]?.episode_scores ?? []
}

/** Calls that gave no usable answer (refused, or nothing readable), as a share of calls. Replies cut off at
 * the token limit are shown separately: their complete orders, if any, were still used. */
export function replyProblems(cell: TierCell | undefined): { text: string; title: string } {
  if (!cell?.calls) return { text: '–', title: 'Not recorded' }
  const none = (cell.refusals ?? 0) + (cell.unusable_replies ?? 0)
  return {
    text: `${((100 * none) / cell.calls).toFixed(1)}%`,
    title: `${cell.calls.toLocaleString()} calls: ${none} gave no usable answer (${cell.refusals ?? 0} refused, `
      + `${cell.unusable_replies ?? 0} unreadable). Separately, ${cell.truncated_replies ?? 0} were cut off at the token limit, `
      + `and ${cell.invalid_entries ?? 0} entries were dropped from usable replies`,
  }
}
