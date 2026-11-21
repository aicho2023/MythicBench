/**
 * Replay engine: turns an event log into "the state of the world at time t".
 *
 * The key idea is *event sourcing*: state is never stored, it is always
 * computed by folding (applying, in order) every event up to time t.
 * That gives us, for free:
 *   - deterministic playback (same log => same picture, every time)
 *   - scrubbing (just ask for a different t)
 *   - honesty (the viewer cannot show anything that isn't in the log)
 *
 * Folding from t=0 every frame would get slow on long fights, so we keep
 * a snapshot of the state every SNAPSHOT_MS. To get state at t we clone the
 * nearest earlier snapshot and apply only the few events after it.
 */
import type { Replay, ReplayEvent, UnitInfo, Vec2 } from './types'

const SNAPSHOT_MS = 1000
/** Extra viewing time after the final event so death animations can play. */
export const EPILOGUE_MS = 4000

export interface MoveState { from: Vec2; to: Vec2; t0: number; dur: number }
export interface CastState { ability: string; target: string | null; t0: number; castMs: number; interruptible: boolean }

export interface UnitState {
  info: UnitInfo
  hp: number
  absorb: number
  alive: boolean
  deathT: number | null
  basePos: Vec2
  move: MoveState | null
  cast: CastState | null
  /** last cast_success (used for attack animations) */
  lastAction: { ability: string; t: number; target: string | null } | null
  /** last time the cast bar ended and how — drives the "Interrupted!" flash */
  lastCastEnd: { ability: string; t: number; how: 'success' | 'interrupted' } | null
  lastHitT: number
  auras: Record<string, { t0: number; dur: number; source: string; stacks?: number }>
  /** ability id -> time it becomes ready again */
  readyAt: Record<string, number>
  target: string | null
  /** dungeon: false for trash (and the boss) until pulled */
  engaged: boolean
}

export interface GroundState { id: string; kind: string; pos: Vec2; radius: number; t0: number; armMs: number; durMs: number }

export interface ReplayState {
  t: number
  units: Record<string, UnitState>
  /** ids in spawn order (players first, then boss, then adds) */
  order: string[]
  ground: Record<string, GroundState>
  damageDone: Record<string, number>
  healingDone: Record<string, number>
  avoidableTaken: Record<string, number>
  kicks: { casts: number; interrupted: number }
  deaths: number
  ended: { outcome: string; t: number } | null
  /** dungeon runs: when each pack (and "boss") was pulled / cleared, and revive penalties */
  pulled: Record<string, number>
  cleared: Record<string, number>
  penaltyMs: number
}

function makeUnit(info: UnitInfo, dungeon = false): UnitState {
  return {
    info, hp: info.max_hp, absorb: 0, alive: true, deathT: null, basePos: info.pos,
    move: null, cast: null, lastAction: null, lastCastEnd: null, lastHitT: -1e9,
    auras: {}, readyAt: {}, target: null,
    engaged: !(dungeon && (!!info.pack || info.kind === 'boss')),
  }
}

export function initialState(replay: Replay): ReplayState {
  const units: Record<string, UnitState> = {}
  const dungeon = replay.meta.mode === 'dungeon'
  for (const u of replay.units) units[u.id] = makeUnit(u, dungeon)
  return {
    t: 0, units, order: replay.units.map((u) => u.id), ground: {},
    damageDone: {}, healingDone: {}, avoidableTaken: {},
    kicks: { casts: 0, interrupted: 0 }, deaths: 0, ended: null,
    pulled: {}, cleared: {}, penaltyMs: 0,
  }
}

/** Position of a unit at time t — identical formula to the Python engine. */
export function posAt(u: UnitState, t: number): Vec2 {
  const m = u.move
  if (!m) return u.basePos
  const f = m.dur <= 0 ? 1 : Math.min(1, Math.max(0, (t - m.t0) / m.dur))
  return [m.from[0] + (m.to[0] - m.from[0]) * f, m.from[1] + (m.to[1] - m.from[1]) * f]
}

export function isMoving(u: UnitState, t: number): boolean {
  return !!u.move && u.alive && t < u.move.t0 + u.move.dur
}

/** Apply one event to the state, in place. */
export function applyEvent(s: ReplayState, e: ReplayEvent, replay: Replay): void {
  switch (e.type) {
    case 'spawn':
      s.units[e.unit.id] = makeUnit(e.unit)
      s.order.push(e.unit.id)
      break
    case 'move': {
      const u = s.units[e.unit]
      u.move = { from: e.from, to: e.to, t0: e.t, dur: e.duration_ms }
      u.basePos = e.to
      break
    }
    case 'cast_start': {
      const u = s.units[e.unit]
      u.cast = { ability: e.ability, target: e.target, t0: e.t, castMs: e.cast_ms, interruptible: e.interruptible }
      if (e.interruptible) s.kicks.casts++
      break
    }
    case 'cast_success': {
      const u = s.units[e.unit]
      if (u.cast && u.cast.ability === e.ability) {
        u.cast = null
        u.lastCastEnd = { ability: e.ability, t: e.t, how: 'success' }
      }
      u.lastAction = { ability: e.ability, t: e.t, target: e.target }
      const cd = replay.abilities[e.ability]?.cooldown_ms ?? 0
      if (cd) u.readyAt[e.ability] = e.t + cd
      if (e.target && s.units[e.target]?.info.kind !== 'player' && u.info.kind === 'player') u.target = e.target
      if (u.info.kind !== 'player' && e.target) u.target = e.target
      break
    }
    case 'cast_interrupted': {
      const u = s.units[e.unit]
      u.cast = null
      u.lastCastEnd = { ability: e.ability, t: e.t, how: 'interrupted' }
      if (e.reason === 'interrupt') s.kicks.interrupted++
      break
    }
    case 'damage': {
      const tgt = s.units[e.target]
      tgt.hp = e.hp
      tgt.absorb = e.absorb
      tgt.lastHitT = e.t
      s.damageDone[e.source] = (s.damageDone[e.source] ?? 0) + e.amount
      if (e.ability === 'desecrate' || e.ability === 'restless_grave') s.avoidableTaken[e.target] = (s.avoidableTaken[e.target] ?? 0) + e.amount + e.absorbed
      break
    }
    case 'heal':
      s.units[e.target].hp = e.hp
      s.healingDone[e.source] = (s.healingDone[e.source] ?? 0) + e.amount
      break
    case 'aura_apply': {
      const u = s.units[e.unit]
      u.auras[e.aura] = { t0: e.t, dur: e.duration_ms, source: e.source, stacks: e.stacks }
      if (e.absorb) u.absorb = e.absorb
      break
    }
    case 'aura_remove':
      delete s.units[e.unit].auras[e.aura]
      if (e.aura === 'lumen_ward') s.units[e.unit].absorb = 0
      break
    case 'ground_spawn':
      s.ground[e.id] = { id: e.id, kind: e.kind, pos: e.pos, radius: e.radius, t0: e.t, armMs: e.arm_ms, durMs: e.duration_ms }
      break
    case 'ground_expire':
      delete s.ground[e.id]
      break
    case 'death': {
      const u = s.units[e.unit]
      u.basePos = posAt(u, e.t)
      u.move = null
      u.alive = false
      u.deathT = e.t
      u.cast = null
      u.auras = {}
      u.absorb = 0
      if (u.info.kind === 'player') s.deaths++
      break
    }
    case 'pull':
      s.pulled[e.pack] = e.t
      for (const u of Object.values(s.units)) {
        if (u.info.pack === e.pack || (e.pack === 'boss' && u.info.kind === 'boss')) u.engaged = true
      }
      break
    case 'pack_cleared':
      s.cleared[e.pack] = e.t
      break
    case 'revive': {
      const u = s.units[e.unit]
      u.alive = true
      u.hp = e.hp
      u.deathT = null
      s.penaltyMs += e.penalty_ms
      break
    }
    case 'encounter_end':
      s.ended = { outcome: e.outcome, t: e.t }
      break
    default:
      break // projectile / emote / decision / start: visual-only, read via eventsBetween
  }
}

/** Fast deep copy of the state (it's small: ~10 units). */
function cloneState(s: ReplayState): ReplayState {
  const units: Record<string, UnitState> = {}
  for (const id in s.units) {
    const u = s.units[id]
    const auras: UnitState['auras'] = {}
    for (const a in u.auras) auras[a] = { ...u.auras[a] }
    units[id] = { ...u, auras, readyAt: { ...u.readyAt } }
  }
  return {
    ...s, units, order: [...s.order], ground: { ...s.ground },
    damageDone: { ...s.damageDone }, healingDone: { ...s.healingDone },
    avoidableTaken: { ...s.avoidableTaken }, kicks: { ...s.kicks },
    pulled: { ...s.pulled }, cleared: { ...s.cleared },
  }
}

export class ReplayEngine {
  readonly replay: Replay
  readonly duration: number
  private readonly times: number[]
  private readonly snapshots: { t: number; next: number; state: ReplayState }[] = []
  private cache: { t: number; state: ReplayState } | null = null

  constructor(replay: Replay) {
    this.replay = replay
    this.duration = replay.meta.duration_ms + EPILOGUE_MS
    this.times = replay.events.map((e) => e.t)
    // Build snapshots: state after all events with e.t <= boundary.
    const s = initialState(replay)
    let i = 0
    for (let b = 0; b <= this.duration + SNAPSHOT_MS; b += SNAPSHOT_MS) {
      while (i < replay.events.length && replay.events[i].t <= b) applyEvent(s, replay.events[i++], replay)
      s.t = b
      this.snapshots.push({ t: b, next: i, state: cloneState(s) })
    }
  }

  /** The world at time t (ms). Memoised for repeated calls within a frame. */
  stateAt(t: number): ReplayState {
    t = Math.max(0, Math.min(this.duration, t))
    if (this.cache && this.cache.t === t) return this.cache.state
    const snap = this.snapshots[Math.min(this.snapshots.length - 1, Math.floor(t / SNAPSHOT_MS))]
    const s = cloneState(snap.state)
    const ev = this.replay.events
    for (let i = snap.next; i < ev.length && ev[i].t <= t; i++) applyEvent(s, ev[i], this.replay)
    s.t = t
    this.cache = { t, state: s }
    return s
  }

  /** Index of first event with time >= t (binary search). */
  private lowerBound(t: number): number {
    let lo = 0
    let hi = this.times.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.times[mid] < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Events with t0 < e.t <= t1, plus their global index (stable keys). */
  eventsBetween(t0: number, t1: number): { e: ReplayEvent; i: number }[] {
    const out: { e: ReplayEvent; i: number }[] = []
    for (let i = this.lowerBound(t0 + 1e-6); i < this.times.length && this.times[i] <= t1; i++) {
      out.push({ e: this.replay.events[i], i })
    }
    return out
  }

  /** Interesting moments for the timeline (deaths, raises, big misses). */
  markers(): { t: number; kind: 'death' | 'raise' | 'missed' | 'kick' | 'end' | 'pull'; label: string }[] {
    const out: ReturnType<ReplayEngine['markers']> = []
    const names: Record<string, string> = Object.fromEntries(this.replay.units.map((u) => [u.id, u.name]))
    for (const e of this.replay.events) {
      if (e.type === 'death' && names[e.unit]) out.push({ t: e.t, kind: 'death', label: `${names[e.unit]} died` })
      else if (e.type === 'cast_start' && e.ability === 'raise_dead') out.push({ t: e.t, kind: 'raise', label: 'Summon the Restless' })
      else if (e.type === 'cast_success' && e.ability === 'requiem_of_bones') out.push({ t: e.t, kind: 'missed', label: 'Requiem not interrupted!' })
      else if (e.type === 'encounter_end') out.push({ t: e.t, kind: 'end', label: e.outcome === 'victory' ? 'Victory' : 'Wipe' })
      else if (e.type === 'pull') {
        const pack = this.replay.arena.packs?.find((p) => p.id === e.pack)
        out.push({ t: e.t, kind: 'pull', label: e.pack === 'boss' ? 'Mortisar pulled' : `${pack?.name ?? e.pack} pulled` })
      }
    }
    return out
  }
}
