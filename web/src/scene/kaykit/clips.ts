/**
 * Which KayKit animation clip to show for a given pose, and where its
 * playhead should be. The playhead is computed from replay time (pose.since),
 * never from wall-clock time — so pause/scrub stay perfectly deterministic.
 */
import { ACTION_MS, type Pose } from '../pose'

export interface ClipChoice {
  name: string
  /** playhead in seconds, given the clip's duration */
  time: (dur: number) => number
}

const loop = (p: Pose, rate = 1) => (d: number) => ((p.since / 1000) * rate) % d
/** squeeze the whole clip into `windowMs` (snappy one-shot gestures) */
const squeeze = (p: Pose, windowMs: number) => (d: number) => Math.min(d - 1e-3, (p.since / windowMs) * d)
/** play at natural speed and hold the last frame */
const hold = (p: Pose) => (d: number) => Math.min(d - 1e-3, p.since / 1000)
/** follow cast progress 0..1 */
const progress = (p: Pose) => (d: number) => Math.min(d - 1e-3, p.k * d)

type Group = 'hero' | 'boss' | 'add'

const IDLE: Record<string, string> = {
  guardian: 'Melee_Blocking', lightweaver: 'Idle_B', berserker: 'Melee_2H_Idle', shadowblade: 'Idle_A',
  ranger: 'Ranged_Bow_Idle', boss: 'Melee_2H_Idle', bonewalker: 'Skeletons_Idle',
}
const WALK: Record<string, string> = {
  guardian: 'Running_A', lightweaver: 'Running_B', berserker: 'Running_A', shadowblade: 'Running_B',
  ranger: 'Running_HoldingBow', boss: 'Walking_A', bonewalker: 'Skeletons_Walking',
}
/** One-shot gestures for instant abilities and attacks. */
const ACTION: Record<string, string> = {
  bulwark_slam: 'Melee_Block_Attack', rampart_strike: 'Melee_1H_Attack_Slice_Diagonal', rampart_bash: 'Melee_Block_Attack',
  ironhide: 'Melee_Block', challenging_roar: 'Cheering',
  ravage: 'Melee_2H_Attack_Chop', savage_hew: 'Melee_2H_Attack_Slice', cleaving_storm: 'Melee_2H_Attack_Spin',
  throat_punch: 'Melee_Unarmed_Attack_Punch_A',
  twin_fang: 'Melee_Dualwield_Attack_Slice', venom_burst: 'Melee_Dualwield_Attack_Chop', fan_of_blades: 'Melee_2H_Attack_Spin',
  quick_jab: 'Melee_Dualwield_Attack_Stab',
  steady_arrow: 'Ranged_Bow_Release', piercing_shot: 'Ranged_Bow_Release', silencing_arrow: 'Ranged_Bow_Release',
  wild_roar: 'Cheering',
  sunspark: 'Ranged_Magic_Shoot', mending_light: 'Ranged_Magic_Shoot', bloomward: 'Ranged_Magic_Shoot',
  lumen_ward: 'Ranged_Magic_Raise', radiant_hymn: 'Ranged_Magic_Summon',
  hollow_strike: 'Melee_2H_Attack_Chop', soul_rend: 'Melee_2H_Attack_Slice', desecrate: 'Ranged_Magic_Shoot',
  raise_dead: 'Ranged_Magic_Summon', requiem_of_bones: 'Ranged_Magic_Summon',
  bone_claw: 'Melee_Unarmed_Attack_Punch_A',
}
/** What to show WHILE a cast bar is filling. */
const CASTING: Record<string, { name: string; mode: 'loop' | 'progress' }> = {
  mending_light: { name: 'Ranged_Magic_Spellcasting', mode: 'loop' },
  radiant_hymn: { name: 'Ranged_Magic_Spellcasting_Long', mode: 'loop' },
  sunspark: { name: 'Ranged_Magic_Spellcasting', mode: 'loop' },
  steady_arrow: { name: 'Ranged_Bow_Draw', mode: 'progress' },
  piercing_shot: { name: 'Ranged_Bow_Draw', mode: 'progress' },
  requiem_of_bones: { name: 'Ranged_Magic_Spellcasting_Long', mode: 'loop' },
  soul_rend: { name: 'Ranged_Magic_Raise', mode: 'progress' },
  raise_dead: { name: 'Ranged_Magic_Spellcasting', mode: 'loop' },
}

export function chooseClip(cls: string, group: Group, p: Pose): ClipChoice {
  switch (p.mode) {
    case 'dead':
      return { name: group === 'hero' ? 'Death_A' : 'Skeletons_Death', time: hold(p) }
    case 'walk':
      return { name: WALK[cls] ?? 'Running_A', time: loop(p, group === 'add' ? 1 : 1.1) }
    case 'cast': {
      if (!p.instant && p.ability && CASTING[p.ability]) {
        const c = CASTING[p.ability]
        return { name: c.name, time: c.mode === 'loop' ? loop(p) : progress(p) }
      }
      if (p.ability && ACTION[p.ability]) return { name: ACTION[p.ability], time: squeeze(p, ACTION_MS) }
      return { name: 'Ranged_Magic_Spellcasting', time: loop(p) }
    }
    case 'attack':
    case 'shoot':
      return { name: (p.ability && ACTION[p.ability]) || 'Melee_1H_Attack_Chop', time: squeeze(p, ACTION_MS) }
    default:
      return { name: IDLE[cls] ?? 'Idle_A', time: loop(p) }
  }
}
