// Pose rules checked against the real showcase replays.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReplayEngine } from '../replay/engine'
import type { Replay } from '../replay/types'
import { RELEASE_MS, poseOf, walkSegments } from './pose'

const replay: Replay = JSON.parse(readFileSync(join(__dirname, '../../public/replays/expert-kill.json'), 'utf8'))
const engine = new ReplayEngine(replay)
const pose = (id: string, t: number) => poseOf(engine.stateAt(t).units[id], t, replay)

describe('pose', () => {
  it('shows the ranger releasing before the next draw of a chained shot', () => {
    // a cast_start on the same tick as the previous steady_arrow resolved
    const chained = replay.events.find((e, i) =>
      e.type === 'cast_start' && e.unit === 'bao' && e.ability === 'steady_arrow' &&
      replay.events.slice(Math.max(0, i - 4), i).some((p) => p.type === 'cast_success' && p.unit === 'bao' && p.t === e.t))
    expect(chained).toBeDefined()
    const t0 = chained!.t
    const release = pose('bao', t0 + 100)
    expect(release.mode).toBe('shoot')
    expect(release.since).toBe(100)
    const draw = pose('bao', t0 + RELEASE_MS + 100)
    expect(draw.mode).toBe('cast')
    expect(draw.k).toBeGreaterThan(0)
    expect(draw.k).toBeLessThan(0.2)
  })

  it('merges a chase of tiny hops into one walk', () => {
    // Grokka chases the adds around 40-43 s in many ~140 ms hops
    const segs = walkSegments(replay).get('grokka')!
    const chase = segs.find((s) => s.t0 <= 41000 && s.t1 >= 42900)
    expect(chase).toBeDefined()
    for (const t of [40950, 41040, 41450, 42650]) expect(pose('grokka', t).mode).toBe('walk')
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
    const a = pose('bao', 61234)
    pose('bao', 90000)
    expect(pose('bao', 61234)).toEqual(a)
  })
})
