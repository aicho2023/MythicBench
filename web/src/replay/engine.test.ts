// These tests load the REAL replays produced by the Python simulator and
// check that the viewer reconstructs exactly what the simulator recorded.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReplayEngine, applyEvent, initialState } from './engine'
import { dungeonProgress, dungeonScore, runScore } from '../content/display'
import type { Replay } from './types'

const dir = join(__dirname, '../../public/replays')
const files = ['expert-clear.json', 'competent-run.json', 'sloppy-wipe.json']

describe.each(files)('%s', (file) => {
  const replay: Replay = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const engine = new ReplayEngine(replay)

  it('final hp matches the simulator', () => {
    const s = engine.stateAt(replay.meta.duration_ms)
    const end = replay.events[replay.events.length - 1]
    expect(end.type).toBe('encounter_end')
    if (end.type !== 'encounter_end') return
    for (const [id, hp] of Object.entries(end.final_hp)) expect(s.units[id].hp).toBe(hp)
    expect(s.ended?.outcome).toBe(replay.meta.outcome)
  })

  it('score matches the Python metrics', () => {
    const s = engine.stateAt(engine.duration)
    const boss = s.units.oruth
    const left = Math.round((1000 * boss.hp) / boss.info.max_hp) / 10
    const got = replay.meta.mode === 'dungeon'
      ? dungeonScore(s.ended!.outcome, s.ended!.t + s.penaltyMs, dungeonProgress(s.units), replay.meta.time_limit_ms)
      : runScore(s.ended!.outcome, s.ended!.t, left, replay.meta.time_limit_ms)
    expect(got).toBeCloseTo(replay.meta.metrics!.score, 1)
  })

  it('damage meter matches the Python metrics', () => {
    const s = engine.stateAt(engine.duration)
    for (const [id, dmg] of Object.entries(replay.meta.metrics!.damage_done)) expect(s.damageDone[id]).toBe(dmg)
  })

  it('scrubbing (snapshot + partial fold) equals folding from scratch', () => {
    // Deterministic pseudo-random sample of times, including snapshot edges.
    const ts = [0, 999, 1000, 1001, engine.duration]
    for (let k = 0; k < 40; k++) ts.push(Math.floor(((k * 7919) % 1000) / 1000 * engine.duration))
    for (const t of ts) {
      const fresh = initialState(replay)
      for (const e of replay.events) if (e.t <= t) applyEvent(fresh, e, replay)
      fresh.t = t
      const viaSnap = engine.stateAt(t)
      expect(JSON.stringify(viaSnap)).toBe(JSON.stringify(fresh))
    }
  })

  it('scrubbing backwards then forwards is stable', () => {
    const a = JSON.stringify(engine.stateAt(60_000))
    engine.stateAt(10_000)
    expect(JSON.stringify(engine.stateAt(60_000))).toBe(a)
  })
})

describe('timeline markers', () => {
  const load = (f: string): Replay => JSON.parse(readFileSync(join(dir, f), 'utf8'))

  it('mark each stand in a pool once, at the first hit', () => {
    const replay = load('competent-run.json')
    const pools = new ReplayEngine(replay).markers().filter((m) => m.kind === 'pool')
    const hits = replay.events.filter((e) => e.type === 'damage' && ['desecrate', 'restless_grave'].includes(e.ability)
      && replay.units.find((u) => u.id === e.target)?.kind === 'player')
    expect(pools.length).toBeGreaterThan(0)
    expect(pools.length).toBeLessThan(hits.length) // one marker per stand, not per tick
    for (const m of pools) expect(hits.some((e) => e.t === m.t)).toBe(true)
  })

  it('come out in time order', () => {
    const ms = new ReplayEngine(load('competent-run.json')).markers()
    expect(ms.map((m) => m.t)).toEqual([...ms.map((m) => m.t)].sort((a, b) => a - b))
  })
})
