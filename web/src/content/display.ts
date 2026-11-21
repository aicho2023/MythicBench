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
 * The run score (mirror of sim/mythicsim/metrics.py run_score):
 * kill = 100 + seconds left on the timer; wipe = % of boss health removed.
 */
export function runScore(outcome: string | null, endMs: number, bossHpPctLeft: number, limitMs: number): number {
  if (outcome === 'victory') return Math.round((100 + Math.max(0, (limitMs - endMs) / 1000)) * 10) / 10
  return Math.round((100 - bossHpPctLeft) * 10) / 10
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
