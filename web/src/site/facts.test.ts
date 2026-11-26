// The report's tables are computed (facts.ts), but its prose still states numbers. Each
// check here recomputes one from the published per-pull facts and requires the sentence
// that states it, so a data change that moves a number fails here instead of leaving the
// site saying something the data no longer does. When the report is rewritten, update the
// expected sentences here along with it.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { behaviourRows, deathShare, soakRows } from './facts'
import type { Insights } from './PullGrid'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const data: Insights = JSON.parse(read('../../public/insights/v1.json'))
const report = read('../pages/Report.tsx').replace(/\s+/g, ' ')
const findings = read('../content/findings.ts').replace(/\s+/g, ' ')

const LEADERS = ['claude-opus-5-5', 'gpt-6.2-sol']
const OTHERS = Object.keys(data.models).filter((m) => !LEADERS.includes(m))
const MODELS = [...LEADERS, ...OTHERS]
const soaks = Object.fromEntries(soakRows(data, MODELS).map((r) => [r.model, r]))
const groupsThatSoaked = (ms: string[]) => ms.reduce((a, m) => a + Number(soaks[m].groups.split(' of ')[0]), 0)
const groupCount = (ms: string[]) => ms.reduce((a, m) => a + data.models[m].length, 0)

describe('Table 5, Bone Pyre', () => {
  it('matches the counts first published by hand', () => {
    expect(soaks['claude-opus-5-5']).toMatchObject({ groups: '6 of 6', soaked: '77 of 92', note: 'all after the first wipe' })
    expect(soaks['gpt-6.2-sol']).toMatchObject({ groups: '6 of 6', soaked: '71 of 95', note: '5 after the first wipe, 1 after the second' })
    expect(soaks['claude-haiku-5-5']).toMatchObject({ groups: '0 of 12', soaked: '0 of 93' })
    expect(soaks['gpt-6-luna']).toMatchObject({ groups: '2 of 12', soaked: '5 of 117' })
  })
})

describe('Table 7, behaviour', () => {
  it('matches the values first published by hand', () => {
    const b = Object.fromEntries(behaviourRows(data, MODELS).map((r) => [r.model, r]))
    expect(b['claude-opus-5-5']).toEqual({ model: 'claude-opus-5-5', kicks: '82%', chat: 76, deaths: 4.6 })
    expect(b['gpt-6-luna']).toEqual({ model: 'gpt-6-luna', kicks: '74%', chat: 16, deaths: 5 })
    expect(b['grok-4.3']).toEqual({ model: 'grok-4.3', kicks: '70%', chat: 10, deaths: 5.3 })
  })
})

describe('numbers stated in the prose', () => {
  it('the other five models soaked in few of their groups', () => {
    const s = `${groupsThatSoaked(OTHERS)} of their ${groupCount(OTHERS)} groups`
    expect(report).toContain(s)
    expect(findings).toContain(s)
  })

  it('the leaders soaked in every group, most after one wipe', () => {
    const afterOne = LEADERS.reduce((a, m) => a + data.models[m].filter((g) => g.pulls.find((p) => p.soaked > 0)?.pull === 2).length, 0)
    expect(afterOne).toBe(11)
    expect(report).toContain('eleven of them after a single wipe')
  })

  it('Desecrate deaths, leaders against Luna', () => {
    const [o, s, l] = ['claude-opus-5-5', 'gpt-6.2-sol', 'gpt-6-luna'].map((m) => deathShare(data, m, 'desecrate'))
    expect(report).toContain(`${o}% and ${s}% of their deaths, compared with ${l}% for Luna`)
  })

  it('Bone Pyre deaths: Luna, and the range for everyone else', () => {
    const luna = deathShare(data, 'gpt-6-luna', 'bone_pyre')
    const rest = MODELS.filter((m) => m !== 'gpt-6-luna').map((m) => deathShare(data, m, 'bone_pyre'))
    expect(report).toContain(`Bone Pyre caused ${luna}% of the deaths in GPT-6 Luna's groups, compared to about 30-40% for all the other models`)
    for (const v of rest) expect(v).toBeGreaterThanOrEqual(30)
    for (const v of rest) expect(v).toBeLessThanOrEqual(40)
  })

  it("Grok's first group: the plan written down, then 2 of 9 Pyres soaked", () => {
    const later = data.models['grok-4.3'].find((g) => g.episode === 0)!.pulls.filter((p) => p.pull >= 2)
    const [n, m] = [later.reduce((a, p) => a + p.soaked, 0), later.reduce((a, p) => a + p.pyres, 0)]
    const s = `${n} of ${m} Pyres`
    expect(report).toContain(`only ${n} of the ${m} Pyres`)
    expect(findings).toContain(`on ${s}`)
  })

  it("Grok: Pyres on pulls 2 to 5 with exactly one player inside", () => {
    const inside = data.models['grok-4.3'].filter((g) => g.ranked).flatMap((g) => g.pulls.filter((p) => p.pull >= 2).flatMap((p) => p.pyre_inside ?? []))
    expect(report).toContain(`${inside.filter((n) => n === 1).length} of the ${inside.length} Pyres on attempts 2 to 5 had exactly one player`)
  })

  it('Sol gets two agents in on about three Pyres in four', () => {
    const [soaked, all] = soaks['gpt-6.2-sol'].soaked.split(' of ').map(Number)
    expect(Math.round((4 * soaked) / all)).toBe(3)
    expect(report).toContain('three Pyres in four')
  })
})
