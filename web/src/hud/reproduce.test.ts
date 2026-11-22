import { describe, expect, it } from 'vitest'
import type { ReplayMeta } from '../replay/types'
import { reproduceCommand } from './Panels'

const base = { encounter: 'x', title: 'x', seed: 10, sim_version: '0.3.0', content_version: '1.2.0', tick_ms: 100, duration_ms: 1, outcome: 'wipe', time_limit_ms: 255000, tier: 'plus10', mode: 'dungeon' } as const

describe('reproduceCommand', () => {
  it('replays a scripted commander run from its seed', () => {
    expect(reproduceCommand({ ...base, policy: 'llm:scripted:commander' } as ReplayMeta))
      .toBe('cd sim && python -m mythicsim run --seed 10 --tier plus10 --mode dungeon --out replay.json')
  })

  it('rebuilds a campaign pull offline from its recordings, at its commit', () => {
    const cmd = reproduceCommand({
      ...base, policy: 'llm:anthropic:claude-haiku-5-5@medium',
      run: { run_id: 'r', name: null, label: 'anthropic:claude-haiku-5-5@medium', model: 'claude-haiku-5-5', effort: 'medium', harness_version: '0.9.0', prompt_hash: 'abc', git_commit: '014a417', max_pulls: 5, campaign: 'v1', seed_base: 70000 },
      progress: { episode: 2, pull: 3, memory: true, knowledge: 'blind', notes_before: {}, notes_after: {}, debrief: '' },
    } as ReplayMeta)
    expect(cmd.split('\n')).toEqual([
      'git checkout 014a417',
      'cd sim && python -m mythicsim progress --model anthropic:claude-haiku-5-5@medium --episodes 2 --max-pulls 5 --tier plus10 --mode dungeon --knowledge blind --memory on --seed-base 70000 --offline --cache-dir ../web/public/results/v1/recordings',
    ])
  })
})
