// Converts a unit's replay state into an animation pose.
// Pure function of (state, t) => scrubbing/pause always look correct.
import type { UnitState } from '../replay/engine'
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
  ability: string | null
}

/** Timescale of the procedural (fallback) gestures: `k` goes 0..1 over this. */
export const ACTION_MS = 650
/**
 * How long an attack/shoot/instant gesture may stay on screen. Skeletal clips
 * play near natural speed and hand back to the idle stance when they finish
 * (see clips.ts), so this is only an upper bound.
 */
export const GESTURE_MS = 1400
/** A cast that starts this soon after the previous action resolved is "chained". */
export const CHAIN_MS = 300
/** How much of a chained cast is spent finishing the previous gesture (bow release, spell throw). */
export const RELEASE_MS = 450

/** Hops in a chase are merged into one walk when the pause between them is at most this. */
const MERGE_GAP_MS = 150
/** A walk shorter than this (time or distance) is a shuffle: keep the stance, just slide. */
const MIN_WALK_MS = 250
const MIN_WALK_M = 0.6

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const easeOut = (x: number) => 1 - (1 - x) * (1 - x)

const RANGED = new Set(['steady_arrow', 'piercing_shot', 'silencing_arrow', 'sunspark', 'desecrate'])

// ---------------------------------------------------------------------------
// Walk segments: chains of back-to-back moves, precomputed once per replay.
// ---------------------------------------------------------------------------

interface Seg { t0: number; t1: number; dist: number }
const segCache = new WeakMap<Replay, Map<string, Seg[]>>()

/** Per unit, the intervals during which it should look like it is walking. */
export function walkSegments(replay: Replay): Map<string, Seg[]> {
  let out = segCache.get(replay)
  if (out) return out
  const moves = new Map<string, { t: number; dur: number; dist: number }[]>()
  for (const e of replay.events) {
    if (e.type !== 'move') continue
    let list = moves.get(e.unit)
    if (!list) moves.set(e.unit, (list = []))
    list.push({ t: e.t, dur: e.duration_ms, dist: Math.hypot(e.to[0] - e.from[0], e.to[1] - e.from[1]) })
  }
  out = new Map()
  for (const [id, list] of moves) {
    const segs: Seg[] = []
    let cur: Seg | null = null
    list.forEach((m, i) => {
      // A new move replaces the old one, so a move only lasts until the next starts.
      const end = Math.min(m.t + m.dur, list[i + 1]?.t ?? Infinity)
      const dist = m.dur > 0 ? m.dist * clamp01((end - m.t) / m.dur) : 0
      if (cur && m.t - cur.t1 <= MERGE_GAP_MS) {
        cur.t1 = Math.max(cur.t1, end)
        cur.dist += dist
      } else {
        if (cur) segs.push(cur)
        cur = { t0: m.t, t1: end, dist }
      }
    })
    if (cur) segs.push(cur)
    out.set(id, segs.filter((s) => s.t1 - s.t0 >= MIN_WALK_MS && s.dist >= MIN_WALK_M))
  }
  segCache.set(replay, out)
  return out
}

/** The walk segment the unit is in at time t, or null (standing, or only shuffling). */
export function walkAt(u: UnitState, t: number, replay: Replay): Seg | null {
  if (!u.alive) return null
  const segs = walkSegments(replay).get(u.info.id)
  if (!segs) return null
  let lo = 0
  let hi = segs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (segs[mid].t0 <= t) lo = mid + 1
    else hi = mid
  }
  const s = segs[lo - 1]
  return s && t < s.t1 ? s : null
}

// ---------------------------------------------------------------------------

type Base = Pick<Pose, 'hit' | 't' | 'instant'>

/** The gesture for an action that resolved at `la.t` (attack, shot, instant spell). */
function gesturePose(la: NonNullable<UnitState['lastAction']>, t: number, replay: Replay, base: Base): Pose | null {
  const ab = replay.abilities[la.ability]
  const kind = ab?.kind
  const since = t - la.t
  const k = clamp01(since / ACTION_MS)
  if (kind === 'damage' || kind === 'aoe_damage' || kind === 'interrupt' || kind === 'boss') {
    return { ...base, mode: RANGED.has(la.ability) ? 'shoot' : 'attack', k, since, ability: la.ability }
  }
  if (kind) return { ...base, mode: 'cast', instant: true, k: 1, since, ability: la.ability }
  return null
}

export function poseOf(u: UnitState, t: number, replay: Replay): Pose {
  const hit = clamp01(1 - (t - u.lastHitT) / 220)
  const base = { hit, t, instant: false }
  if (!u.alive) {
    const since = t - (u.deathT ?? t)
    return { ...base, hit: 0, mode: 'dead', k: clamp01(since / 700), since, ability: null }
  }
  const la = u.lastAction
  if (u.cast) {
    const c = u.cast
    // Back-to-back casts (the ranger's arrows, a healer's chain): the next cast
    // bar starts on the very tick the last one resolved. Show the previous
    // release first, then let the wind-up fill the rest of the cast.
    let start = c.t0
    if (la && la.t <= c.t0 && c.t0 - la.t <= CHAIN_MS) {
      const leadEnd = Math.min(la.t + RELEASE_MS, c.t0 + c.castMs / 2)
      if (t < leadEnd) {
        const g = gesturePose(la, t, replay, base)
        if (g) return g
      }
      start = leadEnd
    }
    const span = Math.max(1, c.t0 + c.castMs - start)
    return { ...base, mode: 'cast', k: clamp01((t - start) / span), since: Math.max(0, t - start), ability: c.ability }
  }
  const walk = walkAt(u, t, replay)
  if (walk) {
    return { ...base, mode: 'walk', k: 0, since: t - walk.t0, ability: null }
  }
  if (la && t - la.t < GESTURE_MS) {
    const g = gesturePose(la, t, replay, base)
    if (g) return g
  }
  return { ...base, mode: 'idle', k: 0, since: t, ability: null }
}
