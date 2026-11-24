// Hooks for /play into the 3D scene, kept out of the replay code: what a tap
// or hover on a unit does (choosing a target), whose character the camera
// follows, and the short tags that tell enemies apart on their nameplates.
import type { ReplayState } from '../replay/engine'

export const picking: {
  unit: ((id: string) => void) | null
  hover: ((id: string | null) => void) | null
  follow: string | null
  /** The unit being pointed at: its nameplate lights up. */
  highlight: string | null
} = { unit: null, hover: null, follow: null, highlight: null }

/** Every enemy but the boss gets a number, in the order it appeared: 1-5 the first pack, 6-9 the second, then adds. */
export function enemyTags(s: Pick<ReplayState, 'order' | 'units'>): Record<string, string> {
  const out: Record<string, string> = {}
  let n = 0
  for (const id of s.order) {
    const u = s.units[id]
    if (u && u.info.kind === 'add') out[id] = String(++n)
  }
  return out
}
