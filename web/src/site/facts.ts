// The report's Bone Pyre and behaviour tables, computed from the published per-pull
// facts (web/public/insights/v1.json, built by scripts/build_insights.py from the
// replays), so they can't drift from the data.
import type { GroupFacts, Insights } from './insights'

const ORDINAL = ['first', 'second', 'third', 'fourth']

export interface SoakRow { model: string; groups: string; soaked: string; note?: string }

/**
 * Bone Pyre on +10, over all of a model's memory-on groups: how many groups soaked a Pyre
 * at least once, and how many Pyres on pulls 2 to 5 were soaked. When every group soaked,
 * the note says after which wipe each first did.
 */
export function soakRows(data: Insights, models: string[]): SoakRow[] {
  return models.filter((m) => data.models[m]?.length).map((model) => {
    const groups = data.models[model]
    const firsts = groups.map(firstSoakPull).filter((p): p is number => p !== null)
    const later = groups.flatMap((g) => g.pulls.filter((p) => p.pull >= 2))
    const soaked = later.reduce((a, p) => a + p.soaked, 0)
    const pyres = later.reduce((a, p) => a + p.pyres, 0)
    let note: string | undefined
    if (firsts.length === groups.length && firsts.length > 0) {
      const byWipe = new Map<number, number>()
      for (const p of firsts) byWipe.set(p - 1, (byWipe.get(p - 1) ?? 0) + 1)
      const wipes = [...byWipe.entries()].sort((a, b) => a[0] - b[0])
      const nth = (w: number) => ORDINAL[w - 1] ?? `${w}th`
      // "all after the first wipe", or "5 after the first wipe, 1 after the second"
      note = wipes.length === 1
        ? `all after the ${nth(wipes[0][0])} wipe`
        : wipes.map(([w, n], i) => `${n} after the ${nth(w)}${i === 0 ? ' wipe' : ''}`).join(', ')
    }
    return { model, groups: `${firsts.length} of ${groups.length}`, soaked: `${soaked} of ${pyres}`, note }
  })
}

function firstSoakPull(g: GroupFacts): number | null {
  return g.pulls.find((p) => p.soaked > 0)?.pull ?? null
}

export interface BehaviourRow { model: string; chat: number; deaths: number }

/** How each party played on +10, over its memory-on groups: chat lines and deaths per pull. */
export function behaviourRows(data: Insights, models: string[]): BehaviourRow[] {
  return models.filter((m) => data.models[m]?.length).map((model) => {
    const pulls = data.models[model].flatMap((g) => g.pulls)
    const mean = (f: (p: (typeof pulls)[number]) => number) => pulls.reduce((a, p) => a + f(p), 0) / Math.max(1, pulls.length)
    return {
      model,
      chat: Math.round(mean((p) => p.chat)),
      deaths: Math.round(10 * mean((p) => p.deaths)) / 10,
    }
  })
}

/** The causes of death the report names, and the abilities each one counts (Figure 5's columns). */
export const DEATH_CAUSES: { key: string; head: string; short: string; sub: string; ids: string[] }[] = [
  { key: 'pyre', head: 'Bone Pyre', short: 'Pyre', sub: 'the circle', ids: ['bone_pyre'] },
  { key: 'pools', head: 'Desecrate', short: 'Pools', sub: 'floor pools', ids: ['desecrate'] },
  { key: 'boss', head: 'Oruth’s hits', short: 'Oruth', sub: 'on the tank', ids: ['hollow_strike', 'soul_rend'] },
  { key: 'adds', head: 'Adds', short: 'Adds', sub: 'undead melee', ids: ['bone_claw'] },
]

/** How many deaths each ability caused over these groups' pulls. */
export function killedBy(groups: GroupFacts[]): Record<string, number> {
  const by: Record<string, number> = {}
  for (const g of groups) for (const p of g.pulls) for (const [id, n] of Object.entries(p.killed_by ?? {})) by[id] = (by[id] ?? 0) + n
  return by
}

/** Share of a model's deaths on its ranked groups caused by these abilities, as a whole percent. */
export function deathShare(data: Insights, model: string, ids: string[]): number {
  const by = killedBy((data.models[model] ?? []).filter((g) => g.ranked))
  const total = Object.values(by).reduce((a, b) => a + b, 0)
  return total ? Math.round((100 * ids.reduce((a, id) => a + (by[id] ?? 0), 0)) / total) : 0
}
