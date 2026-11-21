// TypeScript mirror of schema/replay.schema.json.
// If you change the schema, change this file too (the vitest suite will
// catch most mismatches because it loads the real generated replays).

export type Vec2 = [number, number]

export interface UnitInfo {
  id: string
  name: string
  kind: 'player' | 'boss' | 'add'
  class: string
  role: 'tank' | 'healer' | 'dps' | 'boss' | 'add'
  max_hp: number
  radius: number
  model: string
  pos: Vec2
}

export interface AbilityInfo {
  name: string
  kind: string
  icon: string
  school: string
  cast_ms: number
  cooldown_ms: number
  interruptible: boolean
  description: string
}

export interface AuraInfo {
  name: string
  icon: string
  harmful: boolean
  description?: string
}

export interface Metrics {
  score: number
  outcome: string
  duration_s: number
  in_time: boolean
  boss_hp_pct_remaining: number
  deaths: { unit: string; t: number; ability: string }[]
  interrupts: { interruptible_casts: number; interrupted: number }
  avoidable_damage_taken: Record<string, number>
  damage_done: Record<string, number>
  healing_done: Record<string, number>
}

export interface ReplayMeta {
  encounter: string
  title: string
  seed: number
  policy: string
  sim_version: string
  content_version: string
  tick_ms: number
  duration_ms: number
  outcome: 'victory' | 'wipe' | 'timeout'
  sigil_level: number
  time_limit_ms: number
  metrics?: Metrics
}

interface Base { t: number }
export type ReplayEvent =
  | (Base & { type: 'encounter_start'; encounter: string; boss: string })
  | (Base & { type: 'encounter_end'; outcome: ReplayMeta['outcome']; final_hp: Record<string, number> })
  | (Base & { type: 'spawn'; unit: UnitInfo })
  | (Base & { type: 'move'; unit: string; from: Vec2; to: Vec2; duration_ms: number })
  | (Base & { type: 'cast_start'; unit: string; ability: string; target: string | null; cast_ms: number; interruptible: boolean })
  | (Base & { type: 'cast_success'; unit: string; ability: string; target: string | null })
  | (Base & { type: 'cast_interrupted'; unit: string; ability: string; by: string | null; by_ability: string | null; reason: 'interrupt' | 'moved' })
  | (Base & { type: 'damage'; source: string; target: string; ability: string; amount: number; absorbed: number; overkill: number; crit: boolean; hp: number; absorb: number })
  | (Base & { type: 'heal'; source: string; target: string; ability: string; amount: number; overheal: number; crit: boolean; hp: number })
  | (Base & { type: 'aura_apply'; unit: string; aura: string; source: string; duration_ms: number; absorb?: number })
  | (Base & { type: 'aura_remove'; unit: string; aura: string; reason: string })
  | (Base & { type: 'ground_spawn'; id: string; kind: string; source: string; pos: Vec2; radius: number; arm_ms: number; duration_ms: number; target?: string })
  | (Base & { type: 'ground_expire'; id: string })
  | (Base & { type: 'projectile'; source: string; target: string; ability: string; travel_ms: number })
  | (Base & { type: 'death'; unit: string; killer: string; ability: string })
  | (Base & { type: 'emote'; unit: string; style: 'yell' | 'warning'; text: string })
  | (Base & { type: 'decision'; unit: string; action: string; reason: string })

export interface Replay {
  schema_version: string
  meta: ReplayMeta
  arena: { radius: number; doors: Vec2[] }
  classes: Record<string, { name: string; role: string; interrupt: string | null; abilities: string[] }>
  abilities: Record<string, AbilityInfo>
  auras: Record<string, AuraInfo>
  units: UnitInfo[]
  events: ReplayEvent[]
}

export interface ReplayIndexEntry {
  id: string
  policy: string
  seed: number
  label: string
  blurb: string
  file: string
  outcome: string
  duration_s: number
  score?: number
  local?: boolean // a model run saved on this machine (replays/local/), not a committed showcase
}
