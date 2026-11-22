// Where a unit's spells and arrows come from: a point on its weapon (the bow,
// the tip of a staff, the boss's orb hand). Avatars register an anchor here;
// effects read its world position. Units without one fall back to the chest.
import * as THREE from 'three'

export const muzzles = new Map<string, THREE.Object3D>()

const tmp = new THREE.Vector3()

/**
 * The muzzle's offset from the unit's feet right now (world x/z offset and
 * height), or null. Effects add it to the unit's position at the moment a
 * shot left, so a projectile stays a pure function of replay time.
 */
export function muzzleOffset(id: string, feet: [number, number]): [number, number, number] | null {
  const m = muzzles.get(id)
  if (!m) return null
  m.getWorldPosition(tmp)
  return [tmp.x - feet[0], tmp.y, tmp.z - feet[1]]
}

/**
 * An anchor on a held weapon: the middle of a bow, or the far end of a staff
 * or wand from the grip (weapon models have their origin at the grip).
 */
export function weaponAnchor(weapon: THREE.Object3D, kind: 'center' | 'tip'): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(weapon)
  const inv = new THREE.Matrix4().copy(weapon.matrixWorld).invert()
  box.applyMatrix4(inv) // into the weapon's own frame
  const anchor = new THREE.Object3D()
  if (kind === 'center') {
    box.getCenter(anchor.position)
  } else {
    const size = box.getSize(new THREE.Vector3())
    const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z'
    const far = Math.abs(box.max[axis]) >= Math.abs(box.min[axis]) ? box.max[axis] : box.min[axis]
    anchor.position[axis] = far
  }
  weapon.add(anchor)
  return anchor
}

// Dev only: lets the browser console (and tests driving it) inspect anchors.
if (import.meta.env.DEV) (window as unknown as { __mbMuzzles?: typeof muzzles }).__mbMuzzles = muzzles
