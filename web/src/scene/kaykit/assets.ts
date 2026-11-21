/**
 * KayKit asset manifest (CC0, Kay Lousberg). Files live in
 * web/public/assets/kaykit/ — see docs/ASSETS.md.
 *
 * KayKit 2.0 ships characters and animations separately: every character
 * uses the same 23-bone "Rig_Medium" skeleton, so one library of animation
 * clips drives the whole cast (heroes and skeletons alike).
 */
const BASE = `${import.meta.env.BASE_URL}assets/kaykit`

export const CHARACTER_URL: Record<string, string> = {
  Knight: `${BASE}/adventurers/Characters/gltf/Knight.glb`,
  Mage: `${BASE}/adventurers/Characters/gltf/Mage.glb`,
  Barbarian: `${BASE}/adventurers/Characters/gltf/Barbarian.glb`,
  Rogue: `${BASE}/adventurers/Characters/gltf/Rogue.glb`,
  Rogue_Hooded: `${BASE}/adventurers/Characters/gltf/Rogue_Hooded.glb`,
  Ranger: `${BASE}/adventurers/Characters/gltf/Ranger.glb`,
  Skeleton_Warrior: `${BASE}/skeletons/characters/gltf/Skeleton_Warrior.glb`,
  Skeleton_Minion: `${BASE}/skeletons/characters/gltf/Skeleton_Minion.glb`,
  Skeleton_Mage: `${BASE}/skeletons/characters/gltf/Skeleton_Mage.glb`,
  Skeleton_Rogue: `${BASE}/skeletons/characters/gltf/Skeleton_Rogue.glb`,
}

// Only the Rig_Medium libraries we actually use (Rig_Large is for big monsters).
export const ANIMATION_URLS = ['General', 'MovementBasic', 'MovementAdvanced', 'CombatMelee', 'CombatRanged', 'Special', 'Simulation']
  .map((n) => `${BASE}/animations/Animations/gltf/Rig_Medium/Rig_Medium_${n}.glb`)

const gear = (n: string) => `${BASE}/adventurers/Assets/gltf/${n}.gltf`
const boneGear = (n: string) => `${BASE}/skeletons/assets/gltf/${n}.gltf`
export const dungeon = (n: string) => `${BASE}/dungeon/Assets/gltf/${n}.gltf`

/** What each model holds. Weapons attach to the rig's `handslot` bones. */
export const LOADOUT: Record<string, { right?: string; left?: string }> = {
  Knight: { right: gear('sword_1handed'), left: gear('shield_badge_color') },
  // Lumi the healer: staff plus an open prayer book (KayKit has no cleric model).
  Mage: { right: gear('staff'), left: gear('spellbook_open') },
  Barbarian: { right: gear('axe_2handed') },
  Rogue_Hooded: { right: gear('dagger'), left: gear('dagger') },
  Rogue: { right: gear('dagger'), left: gear('dagger') },
  Ranger: { left: gear('bow_withString') },
  Skeleton_Warrior: { right: boneGear('Skeleton_Blade') },
  Skeleton_Minion: {},
  Skeleton_Mage: { right: boneGear('Skeleton_Staff') },
  Skeleton_Rogue: { right: boneGear('Skeleton_Staff') },
}

/** Visual scale per unit kind so the boss towers over the party. */
export const MODEL_SCALE = { player: 0.86, boss: 2.35, add: 0.85 } as const

export const ALL_GEAR_URLS = [...new Set(Object.values(LOADOUT).flatMap((l) => [l.right, l.left]).filter(Boolean) as string[])]
