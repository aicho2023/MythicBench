// Purely cosmetic display data (colors, icons). Game rules live in Python.
import {
  ArrowUpRight, Axe, Biohazard, Bone, Crosshair, Droplets, Fan, Flame, Flower2, Ghost, Hand,
  HeartPulse, Megaphone, PawPrint, Scissors, Shield, ShieldAlert, ShieldCheck, ShieldPlus,
  Skull, Slash, Sparkles, Sun, Sword, Swords, Tornado, VolumeX, Zap, type LucideIcon,
} from 'lucide-react'

export const CLASS_COLORS: Record<string, string> = {
  guardian: '#6fa8ff',
  lightweaver: '#ffe38a',
  berserker: '#ff7a59',
  shadowblade: '#c68bff',
  ranger: '#7ee08a',
  boss: '#7fe6ff',
  bonewalker: '#b9f59a',
}

export const ROLE_LABEL: Record<string, string> = { tank: 'Tank', healer: 'Healer', dps: 'DPS' }

export const SCHOOL_COLORS: Record<string, string> = {
  physical: '#f2e6c9',
  holy: '#ffe58a',
  shadow: '#b77bff',
  nature: '#8cff7a',
  frost: '#8fe8ff',
}

export const ICONS: Record<string, LucideIcon> = {
  shield: Shield, sword: Sword, shield_star: ShieldPlus, shield_bash: ShieldAlert, roar: Megaphone,
  heal: HeartPulse, bloom: Flower2, ward: ShieldCheck, hymn: Sparkles, sun: Sun, axe: Axe,
  slash: Slash, whirl: Tornado, fist: Hand, daggers: Swords, venom: Droplets, fan: Fan, jab: Zap,
  arrow: ArrowUpRight, pierce: Crosshair, silence: VolumeX, wild: PawPrint, rend: Scissors,
  requiem: Ghost, desecrate: Biohazard, raise: Skull, claw: Bone, fury: Flame,
}

/** Abilities shown on each party frame's cooldown tracker. */
export const TRACKED_COOLDOWNS: Record<string, string[]> = {
  guardian: ['rampart_bash', 'ironhide', 'challenging_roar'],
  lightweaver: ['lumen_ward', 'radiant_hymn'],
  berserker: ['throat_punch', 'cleaving_storm'],
  shadowblade: ['quick_jab', 'fan_of_blades'],
  ranger: ['silencing_arrow', 'wild_roar'],
}

/** Boss casts important enough to flash a raid warning. */
export const WARN_CASTS: Record<string, string> = {
  requiem_of_bones: 'Requiem of Bones — Interrupt!',
  soul_rend: 'Soul Rend on {target} — Defensives!',
}

/**
 * The 0-100 pull score (mirror of sim/mythicsim/metrics.py run_score):
 * a wipe earns up to 70 for boss health removed; a kill earns 70 plus up to 30
 * for speed (the full 30 with a quarter of the timer or more left).
 */
export function runScore(outcome: string | null, endMs: number, bossHpPctLeft: number, limitMs: number): number {
  if (outcome === 'victory') {
    const speed = Math.min(1, Math.max(0, limitMs - endMs) / (0.25 * limitMs))
    return Math.round((70 + 30 * speed) * 10) / 10
  }
  return Math.round(0.7 * (100 - bossHpPctLeft) * 10) / 10
}

/** Dungeon progress weights (mirror of content.PROGRESS_WEIGHTS). */
export const PROGRESS_WEIGHTS: Record<string, number> = { pack1: 0.15, pack2: 0.15, boss: 0.7 }

/** % of the dungeon done: each pack's health removed, then the boss's (mirror of metrics.dungeon_progress). */
export function dungeonProgress(units: Record<string, { hp: number; info: { max_hp: number; pack?: string; kind: string } }>): number {
  const packs: Record<string, [number, number]> = {}
  let boss = 0
  for (const u of Object.values(units)) {
    if (u.info.pack) {
      const p = (packs[u.info.pack] ??= [0, 0])
      p[0] += u.info.max_hp - u.hp
      p[1] += u.info.max_hp
    } else if (u.info.kind === 'boss') boss = (u.info.max_hp - u.hp) / u.info.max_hp
  }
  let total = PROGRESS_WEIGHTS.boss * boss
  for (const [k, [done, all]] of Object.entries(packs)) total += (PROGRESS_WEIGHTS[k] ?? 0) * (done / all)
  return Math.round(1000 * total) / 10
}

/** The 0-100 dungeon-run score (mirror of metrics.dungeon_score); timer includes revive penalties. */
export function dungeonScore(outcome: string | null, timerMs: number, progressPct: number, limitMs: number): number {
  if (outcome === 'victory') return runScore('victory', timerMs, 0, limitMs)
  return Math.round((70 * progressPct) / 100 * 10) / 10 // same operation order as metrics.dungeon_score
}

export function fmtNum(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return `${Math.round(n)}`
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
