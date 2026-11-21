import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { resultsIndexEntries } from './watchData'
import { botHeadline, costPerRun, gunzipIfNeeded, parseWatchPath, watchPath, type Results } from './results'

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
    const pulls = sample.leaderboard.flatMap((r) => Object.values(r.tiers)).concat(sample.controls)
      .reduce((n, c) => n + c.pulls, 0)
    expect(entries).toHaveLength(pulls)
    expect(new Set(entries.map((e) => e.path)).size).toBe(entries.length)
    for (const e of entries) expect(e.url).toMatch(/\/replays\/.+\.json\.gz$/)
  })
  it('combines the bots across tiers like a model headline', () => {
    const h = botHeadline(sample, 'expert')!
    const means = Object.values(sample.bots!).map((t) => t.expert.progression_score_mean)
    expect(h.score).toBeCloseTo(means.reduce((a, b) => a + b, 0) / means.length, 1)
    expect(h.ci![0]).toBeLessThanOrEqual(h.score)
  })
  it('costs a run as one episode per tier', () => {
    expect(costPerRun(sample.leaderboard[0])).toBe(0)
  })
})

describe('gunzipIfNeeded', () => {
  it('decompresses gzip and passes plain JSON through', async () => {
    const json = '{"a":1}'
    expect(await gunzipIfNeeded(new Uint8Array(gzipSync(json)))).toBe(json)
    expect(await gunzipIfNeeded(new TextEncoder().encode(json))).toBe(json)
  })
})
