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
  /** ms since the current action started (drives skeletal clip playheads) */
  since: number
  /** true for instant spells (a quick gesture rather than a channel) */
  instant: boolean
  /** 0..1 flinch strength from being hit recently */
  hit: number
  t: number
  /** school of current/last spell (for glow colors) */
  school: string
  ability: string | null
}

/** How long an attack/shoot/instant gesture is shown after it happens. */
export const ACTION_MS = 650

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const easeOut = (x: number) => 1 - (1 - x) * (1 - x)

const RANGED = new Set(['steady_arrow', 'piercing_shot', 'silencing_arrow', 'sunspark', 'desecrate'])

export function poseOf(u: UnitState, t: number, replay: Replay): Pose {
  const hit = clamp01(1 - (t - u.lastHitT) / 220)
  const base = { hit, t, instant: false }
  if (!u.alive) {
    const since = t - (u.deathT ?? t)
    return { ...base, hit: 0, mode: 'dead', k: clamp01(since / 700), since, school: 'shadow', ability: null }
  }
  if (u.cast) {
    const ab = replay.abilities[u.cast.ability]
    const since = t - u.cast.t0
    return { ...base, mode: 'cast', k: clamp01(since / u.cast.castMs), since, school: ab?.school ?? 'holy', ability: u.cast.ability }
  }
  if (isMoving(u, t) && u.move) {
    return { ...base, mode: 'walk', k: 0, since: t - u.move.t0, school: 'physical', ability: null }
  }
  const la = u.lastAction
  if (la && t - la.t < ACTION_MS) {
    const ab = replay.abilities[la.ability]
    const kind = ab?.kind
    const since = t - la.t
    const k = clamp01(since / ACTION_MS)
    const school = ab?.school ?? 'physical'
    if (kind === 'damage' || kind === 'aoe_damage' || kind === 'interrupt' || kind === 'boss') {
      return { ...base, mode: RANGED.has(la.ability) ? 'shoot' : 'attack', k, since, school, ability: la.ability }
    }
    if (kind) return { ...base, mode: 'cast', instant: true, k: 1, since, school, ability: la.ability }
  }
  return { ...base, mode: 'idle', k: 0, since: t, school: 'physical', ability: null }
}
