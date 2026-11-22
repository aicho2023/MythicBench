// Pose rules checked against the real showcase replays.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReplayEngine } from '../replay/engine'
import type { Replay } from '../replay/types'
import { RELEASE_MS, poseOf, walkSegments } from './pose'

const replay: Replay = JSON.parse(readFileSync(join(__dirname, '../../public/replays/commander-plus10.json'), 'utf8'))
const engine = new ReplayEngine(replay)
const pose = (id: string, t: number) => poseOf(engine.stateAt(t).units[id], t, replay)

describe('pose', () => {
  it('shows the ranger releasing before the next draw of a chained shot', () => {
    // a cast_start on the same tick as the previous steady_arrow resolved
    const chained = replay.events.find((e, i) =>
      e.type === 'cast_start' && e.unit === 'wren' && e.ability === 'steady_arrow' &&
      replay.events.slice(Math.max(0, i - 4), i).some((p) => p.type === 'cast_success' && p.unit === 'wren' && p.t === e.t))
    expect(chained).toBeDefined()
    const t0 = chained!.t
    const release = pose('wren', t0 + 100)
    expect(release.mode).toBe('shoot')
    expect(release.since).toBe(100)
    const draw = pose('wren', t0 + RELEASE_MS + 100)
    expect(draw.mode).toBe('cast')
    expect(draw.k).toBeGreaterThan(0)
    expect(draw.k).toBeLessThan(0.2)
  })

  it('merges a chase of tiny hops into one walk', () => {
    // Find a run of >= 3 back-to-back short hops by one unit (an add or melee chasing).
    const byUnit = new Map<string, { t: number; dur: number }[]>()
    for (const e of replay.events) if (e.type === 'move') (byUnit.get(e.unit) ?? byUnit.set(e.unit, []).get(e.unit)!).push({ t: e.t, dur: e.duration_ms })
    let found: { unit: string; t0: number; t1: number } | null = null
    for (const [unit, ms] of byUnit) {
      for (let i = 0; i + 2 < ms.length && !found; i++) {
        const [a, b, c] = [ms[i], ms[i + 1], ms[i + 2]]
        const chained = b.t - (a.t + Math.min(a.dur, b.t - a.t)) <= 150 && c.t - (b.t + Math.min(b.dur, c.t - b.t)) <= 150
        if (chained && b.t - a.t < 300 && c.t - b.t < 300 && c.t + c.dur - a.t >= 400) found = { unit, t0: a.t, t1: c.t }
      }
      if (found) break
    }
    expect(found).not.toBeNull()
    const segs = walkSegments(replay).get(found!.unit)!
    expect(segs.some((s) => s.t0 <= found!.t0 && s.t1 >= found!.t1)).toBe(true)
  })

  it('never walks on a lone shuffle', () => {
    for (const [, segs] of walkSegments(replay)) {
      for (const s of segs) {
        expect(s.t1 - s.t0).toBeGreaterThanOrEqual(250)
        expect(s.dist).toBeGreaterThanOrEqual(0.6)
      }
    }
  })

  it('is a pure function of time (scrubbing back gives the same pose)', () => {
    const a = pose('wren', 61234)
    pose('wren', 90000)
    expect(pose('wren', 61234)).toEqual(a)
  })
})
