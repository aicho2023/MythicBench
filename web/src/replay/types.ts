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
  pack?: string // dungeon trash: which pack it belongs to
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
  progress_pct?: number // dungeon runs
  penalty_s?: number
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
  /** Difficulty: "normal" or "plus10" (older replays have sigil_level instead). */
  tier?: string
  tier_name?: string
  affixes?: string[]
  sigil_level?: number
  time_limit_ms: number
  metrics?: Metrics
  /** Dungeon runs: "dungeon"; boss-only fights omit it. */
  mode?: string
  penalty_ms?: number
  revives?: number
  boss_engaged_ms?: number | null
  /** Model runs: which run produced this replay. */
  run?: { run_id: string; name: string | null; label: string; model: string; effort: string | null; harness_version: string; prompt_hash: string }
  /** Progression runs: this pull's place in its episode and what the model knew. */
  progress?: { episode: number; pull: number; memory: boolean; knowledge: string; level?: number; tier?: string; notes_before: string; notes_after: string; debrief: string }
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
  | (Base & { type: 'aura_apply'; unit: string; aura: string; source: string; duration_ms: number; absorb?: number; stacks?: number })
  | (Base & { type: 'aura_remove'; unit: string; aura: string; reason: string })
  | (Base & { type: 'ground_spawn'; id: string; kind: string; source: string; pos: Vec2; radius: number; arm_ms: number; duration_ms: number; target?: string })
  | (Base & { type: 'ground_expire'; id: string })
  | (Base & { type: 'projectile'; source: string; target: string; ability: string; travel_ms: number })
  | (Base & { type: 'death'; unit: string; killer: string; ability: string })
  | (Base & { type: 'pull'; pack: string; by: string | null })
  | (Base & { type: 'pack_cleared'; pack: string })
  | (Base & { type: 'revive'; unit: string; hp: number; penalty_ms: number })
  | (Base & { type: 'emote'; unit: string; style: 'yell' | 'warning'; text: string })
  | (Base & { type: 'decision'; unit: string; action: string; reason: string })

export interface Replay {
  schema_version: string
  meta: ReplayMeta
  arena: {
    radius: number
    doors: Vec2[]
    // dungeon runs only
    rooms?: { id: string; name: string; center: Vec2; radius: number }[]
    corridors?: { x_half: number; z_min: number; z_max: number }[]
    route?: Vec2[]
    packs?: { id: string; name: string; room: string; members: string[] }[]
  }
  classes: Record<string, { name: string; role: string; interrupt: string | null; abilities: string[] }>
  abilities: Record<string, AbilityInfo>
  auras: Record<string, AuraInfo>
  /** Active affixes (+10): name and tooltip. */
  affixes?: Record<string, { name: string; description: string }>
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
  runId?: string
}

/** One seed (or, later, one pull) of a model run, as listed in the catalog. */
export interface CatalogItem {
  episode?: number // progression runs
  pull?: number
  seed: number
  file: string
  outcome: string
  score: number
  duration_s: number
}

/** A model run (one `mythicsim llm` invocation), from replays/local/catalog.json. */
export interface CatalogRun {
  run_id: string
  name: string | null
  tags: string[]
  mode: string
  label: string
  provider: string
  model: string
  effort: string | null
  created: string
  harness_version: string | null
  prompt_hash: string | null
  git_commit: string | null
  knowledge?: string | null
  memory?: boolean | null
  level?: number | null
  tier?: string | null
  /** "dungeon" for the full run; missing on runs made before the dungeon existed (boss fight only) */
  dungeon_mode?: string | null
  max_pulls?: number | null
  /** "stopped": the run hit its spend budget part-way */
  status?: string | null
  note?: string | null
  summary: {
    score_mean: number | null; score_ci95: [number, number] | null; win_rate: number | null; reference_means: Record<string, number> | null
    kill_rate?: number | null; pulls_to_kill_mean?: number | null; pulls_to_kill_ci95?: [number, number] | null
    learning_gain_mean?: number | null; learning_gain_ci95?: [number, number] | null; curve_mean?: number[] | null
    progression_score_mean?: number | null; progression_score_ci95?: [number, number] | null
    /** list-price USD for the whole run, and per fight (pull) */
    cost_usd?: number | null; usd_per_fight?: number | null
  }
  items: CatalogItem[]
}

export interface Catalog {
  current_harness_version: string
  runs: CatalogRun[]
}
