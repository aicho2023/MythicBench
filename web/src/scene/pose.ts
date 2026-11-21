// Converts a unit's replay state into an animation pose.
// Pure function of (state, t) => scrubbing/pause always look correct.
import type { UnitState } from '../replay/engine'
import { isMoving } from '../replay/engine'
import type { Replay } from '../replay/types'

export type PoseMode = 'idle' | 'walk' | 'cast' | 'attack' | 'shoot' | 'dead'
export interface Pose {
  mode: PoseMode
  /** 0..1 progress through the current action */
  k: number
  /** 0..1 flinch strength from being hit recently */
  hit: number
  t: number
  /** school of current/last spell (for glow colors) */
  school: string
  ability: string | null
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const easeOut = (x: number) => 1 - (1 - x) * (1 - x)

const RANGED = new Set(['steady_arrow', 'piercing_shot', 'silencing_arrow', 'sunspark'])

export function poseOf(u: UnitState, t: number, replay: Replay): Pose {
  const hit = clamp01(1 - (t - u.lastHitT) / 220)
  if (!u.alive) {
    return { mode: 'dead', k: clamp01((t - (u.deathT ?? t)) / 700), hit: 0, t, school: 'shadow', ability: null }
  }
  if (u.cast) {
    const ab = replay.abilities[u.cast.ability]
    return {
      mode: 'cast', k: clamp01((t - u.cast.t0) / u.cast.castMs), hit, t,
      school: ab?.school ?? 'holy', ability: u.cast.ability,
    }
  }
  if (isMoving(u, t)) return { mode: 'walk', k: 0, hit, t, school: 'physical', ability: null }
  const la = u.lastAction
  if (la && t - la.t < 450) {
    const ab = replay.abilities[la.ability]
    const kind = ab?.kind
    if (kind === 'damage' || kind === 'aoe_damage' || kind === 'interrupt' || kind === 'boss') {
      return {
        mode: RANGED.has(la.ability) ? 'shoot' : 'attack', k: clamp01((t - la.t) / 450), hit, t,
        school: ab?.school ?? 'physical', ability: la.ability,
      }
    }
    if (kind) return { mode: 'cast', k: 1, hit, t, school: ab?.school ?? 'holy', ability: la.ability }
  }
  return { mode: 'idle', k: 0, hit, t, school: 'physical', ability: null }
}
