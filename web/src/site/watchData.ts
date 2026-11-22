// Turns the results dataset into the viewer's run list (Catalog) and replay
// index, so the existing run browser and player work on it unchanged.
import { modelName, pullLabel } from '../content/display'
import type { CatalogRun, ReplayIndexEntry } from '../replay/types'
import { resultsUrl } from './config'
import { resultsRunId, tierName, watchPath, type Results, type TierCell } from './results'

function cellRun(r: Results, model: string, provider: string, effort: string | null, tier: string, memory: boolean, cell: TierCell,
  role: string): CatalogRun {
  const items = cell.episode_list.flatMap((ep) => ep.pulls.map((p) => ({
    episode: ep.episode, pull: p.pull, seed: p.seed, file: p.file, outcome: p.outcome, score: p.score, duration_s: p.duration_s,
    in_time: p.in_time, deaths: p.deaths, kicks: p.kicks, avoidable: p.avoidable, usd: p.usd, stats: p.stats, run_id: ep.run_id,
  })))
  return {
    run_id: resultsRunId(model, tier, memory),
    name: `${r.protocol.name} protocol`,
    tags: [`campaign:${r.protocol.name}`],
    mode: 'progression',
    label: `${provider}:${model}`,
    provider, model, effort,
    created: '',
    harness_version: cell.harness_versions[0] ?? r.harness_version,
    prompt_hash: null, git_commit: null,
    knowledge: r.protocol.knowledge, memory, tier, role, dungeon_mode: r.protocol.mode, max_pulls: r.protocol.max_pulls,
    status: null, note: null,
    summary: {
      score_mean: cell.progression_score, score_ci95: cell.progression_score_ci95, win_rate: cell.clear_rate,
      kill_rate: cell.clear_rate, pulls_to_kill_mean: cell.pulls_to_clear_mean,
      curve_mean: cell.curve_mean, progression_score_mean: cell.progression_score,
      progression_score_ci95: cell.progression_score_ci95, cost_usd: cell.cost_usd, usd_per_fight: cell.usd_per_pull,
    },
    items,
  }
}

/** Every model x tier cell (and memory-off control) as a run, leaderboard order. */
export function resultsCatalogRuns(r: Results): CatalogRun[] {
  const runs: CatalogRun[] = []
  const baselines = new Set(r.baselines ?? [])
  for (const row of [...r.leaderboard, ...(r.baselines ?? [])]) {
    const role = (cell: TierCell) => baselines.has(row) ? 'baseline' : cell.sanity ? 'sanity' : 'ranked'
    for (const [tier, cell] of Object.entries(row.tiers)) runs.push(cellRun(r, row.model, row.provider, row.effort, tier, true, cell, role(cell)))
    for (const c of r.controls.filter((c) => c.model === row.model)) runs.push(cellRun(r, row.model, row.provider, row.effort, c.tier, false, c, 'control'))
  }
  return runs
}

/** One index entry per pull, with the file's URL and its /watch path. */
export function resultsIndexEntries(r: Results): ReplayIndexEntry[] {
  return resultsCatalogRuns(r).flatMap((run) => run.items.map((it) => {
    const who = modelName(run.model)
    const tier = tierName(r, run.tier!)
    return {
      id: `${run.run_id}/e${it.episode}-p${it.pull}`,
      policy: `llm:${run.label}`, seed: it.seed,
      label: `${who}, ${tier}${run.memory ? '' : ' memory off'}, ${pullLabel(it.episode, it.pull)}`,
      blurb: `${run.name}`,
      file: it.file, url: resultsUrl(it.file),
      outcome: it.outcome, duration_s: it.duration_s, score: it.score,
      local: true, runId: run.run_id,
      path: watchPath({ model: run.model, tier: run.tier!, memory: !!run.memory, episode: it.episode!, pull: it.pull! }),
    }
  }))
}
