import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { resultsIndexEntries } from './watchData'
import { botHeadline, costPerRun, gunzipIfNeeded, headlineTier, modelsOnly, parseWatchPath, topPull, watchPath, type Results } from './results'

const sample: Results = JSON.parse(readFileSync(new URL('../../public/results/sample/leaderboard.json', import.meta.url), 'utf8'))

describe('watch paths', () => {
  it('round-trips a pull address, memory on and off', () => {
    for (const memory of [true, false]) {
      const a = { model: 'gpt-6.2-sol', tier: 'plus10', memory, episode: 2, pull: 4 }
      expect(parseWatchPath(watchPath(a))).toEqual(a)
    }
  })
  it('parses a model-only address and ignores other paths', () => {
    expect(parseWatchPath('/watch/claude-opus-5-5')).toEqual({ model: 'claude-opus-5-5' })
    expect(parseWatchPath('/watch')).toBeNull()
    expect(parseWatchPath('/paper')).toBeNull()
  })
})

describe('the sample dataset', () => {
  it('gives every pull a replay file and a unique /watch path', () => {
    const entries = resultsIndexEntries(sample)
    const pulls = [...sample.leaderboard, ...(sample.baselines ?? [])].flatMap((r) => Object.values(r.tiers)).concat(sample.controls)
      .reduce((n, c) => n + c.pulls, 0)
    expect(entries).toHaveLength(pulls)
    expect(new Set(entries.map((e) => e.path)).size).toBe(entries.length)
    for (const e of entries) expect(e.url).toMatch(/\/replays\/.+\.json\.gz$/)
  })
  it('scores the bots on the headline tier, like a model', () => {
    expect(headlineTier(sample)).toBe('plus10')
    const h = botHeadline(sample, 'expert')!
    expect(h.score).toBeCloseTo(sample.bots!.plus10.expert.progression_score_mean, 1)
    expect(h.ci![0]).toBeLessThanOrEqual(h.score)
    const row = sample.leaderboard[0]
    expect(row.mythicbench_score).toBe(row.tiers.plus10.progression_score)
  })
  it('lists the scripted commander as an unranked baseline', () => {
    const [b] = sample.baselines!
    expect(b.model).toBe('commander')
    expect(b.rank).toBeNull()
  })
  it('costs a run as one episode per tier', () => {
    expect(costPerRun(sample.leaderboard[0], sample)).toBe(0)
  })
})

describe('gunzipIfNeeded', () => {
  it('decompresses gzip and passes plain JSON through', async () => {
    const json = '{"a":1}'
    expect(await gunzipIfNeeded(new Uint8Array(gzipSync(json)))).toBe(json)
    expect(await gunzipIfNeeded(new TextEncoder().encode(json))).toBe(json)
  })
})


describe('what visitors see', () => {
  it('drops the mock model, the scripted commander and the bots', () => {
    const r = modelsOnly(sample)
    expect(r.leaderboard).toHaveLength(0) // the sample's only "model" is the mock
    expect(r.baselines).toEqual([])
    expect(r.bots).toBeUndefined()
    expect(r.controls).toHaveLength(0)
  })
  it('keeps real models and picks the hero pull from the top one', () => {
    const real = { ...sample.leaderboard[0], model: 'claude-haiku-5-5', provider: 'anthropic', rank: 1 }
    const r = modelsOnly({ ...sample, leaderboard: [real, ...sample.leaderboard] })
    expect(r.leaderboard.map((x) => x.model)).toEqual(['claude-haiku-5-5'])
    const top = topPull(r)!
    expect(top.id.startsWith('results:claude-haiku-5-5:plus10/')).toBe(true)
    expect(top.path).toMatch(/^\/watch\/claude-haiku-5-5\/plus10\/\d+\/\d+$/)
  })
})
