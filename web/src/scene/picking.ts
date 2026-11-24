// Hooks for /play into the 3D scene, kept out of the replay code: a handler
// for a tapped unit (choosing a target), and whose character the camera follows.
export const picking: { unit: ((id: string) => void) | null; follow: string | null } = { unit: null, follow: null }
