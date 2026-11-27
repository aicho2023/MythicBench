// What the viewer derives from the showcase replays, pinned by digest: the
// state at sampled times, every unit's pose, and the timeline markers. A
// refactor of the engine or the pose rules must leave all three unchanged.
// (Only fields the viewer reads are hashed, so dropping an unread one is fine.)
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { poseOf } from '../scene/pose'
import { ReplayEngine } from './engine'
import type { Replay } from './types'

const dir = join(__dirname, '../../public/replays')
const sha = (x: unknown, skip: string[] = []) =>
  createHash('sha256').update(JSON.stringify(x, (k, v) => (skip.includes(k) ? undefined : v))).digest('hex').slice(0, 16)

const PINS: Record<string, { state: string; poses: string; markers: string }> = {
  'commander-plus10.json': { state: '64921f62a98a3593', poses: '63e7392a0119b3a9', markers: '75f319371a94f005' },
  'commander-normal.json': { state: '1a76c078dbbe1169', poses: '1adc2882a835a0fc', markers: '49dc2fca05dfeccc' },
  'expert-plus10.json': { state: '53fc4ea78ab2cc14', poses: '330a408e55a7d646', markers: '2cd6fb804f189539' },
  'expert-normal.json': { state: '234967394d756957', poses: '609c7103ff0a3357', markers: '7f91b30d355469f4' },
}

describe.each(Object.keys(PINS))('%s', (file) => {
  const replay: Replay = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const engine = new ReplayEngine(replay)
  const times = Array.from({ length: 61 }, (_, k) => Math.floor((k / 60) * engine.duration))

  it('state at sampled times', () => {
    expect(sha(times.map((t) => engine.stateAt(t)), ['lastCastEnd'])).toBe(PINS[file].state)
  })

  it('poses at sampled times', () => {
    const poses = times.map((t) => {
      const s = engine.stateAt(t)
      return s.order.map((id) => poseOf(s.units[id], t, replay))
    })
    expect(sha(poses, ['school'])).toBe(PINS[file].poses)
  })

  it('timeline markers', () => {
    const ms = engine.markers()
    expect(new Set(ms.map((m) => m.kind)).has('kick' as never)).toBe(false)
    expect(sha(ms.map((m) => [m.t, m.kind, m.label]))).toBe(PINS[file].markers)
  })
})
