/**
 * The crypt dressed with KayKit Dungeon pieces: tiled outer floor, a ring of
 * arched walls with banners and torches, decorated pillars, crypt gates,
 * clutter, and dormant skeleton sentinels.
 *
 * Every placement is computed from fixed math (no randomness at runtime),
 * so the room looks identical on every load.
 */
import { Clone, useGLTF } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { glow, softCircleTexture } from '../materials'
import { CHARACTER_URL, dungeon } from './assets'
import { findBone, toonify, useClipLibrary } from './KayKitAvatar'

const PIECES = [
  'floor_tile_large', 'wall', 'wall_arched', 'wall_doorway', 'pillar_decorated', 'torch_mounted',
  'banner_patternA_blue', 'banner_patternB_blue', 'barrel_large', 'crates_stacked', 'chest_gold', 'keg_decorated',
  'candle_triple', 'rubble_half', 'sword_shield_broken', 'trunk_large_A', 'box_stacked', 'shelf_small_candles',
] as const
type Piece = (typeof PIECES)[number]
const URLS = PIECES.map(dungeon)
const SHIELD_URL = `${import.meta.env.BASE_URL}assets/kaykit/skeletons/assets/gltf/Skeleton_Shield_Large_A.gltf`

const R = 15 // arena radius (matches the simulator)
const WALL_R = 23.5
const WALL_N = 18 // segments in the ring; each is a 4-unit wall scaled x2

function usePieces(): Record<Piece, THREE.Object3D> {
  const gltfs = useGLTF(URLS) as unknown as GLTF[]
  return useMemo(() => {
    const out = {} as Record<Piece, THREE.Object3D>
    PIECES.forEach((p, i) => {
      toonify(gltfs[i].scene)
      out[p] = gltfs[i].scene
    })
    return out
  }, [gltfs])
}

/** Position on a circle, rotated to face the arena centre. */
function ring(angle: number, r: number) {
  return { position: [Math.sin(angle) * r, 0, Math.cos(angle) * r] as [number, number, number], rotation: [0, angle + Math.PI, 0] as [number, number, number] }
}

/** Is this angle (around the arena, 0 = +z) inside an opening (a corridor out of the room)? */
const inOpening = (a: number, openings: number[], half = 0.38) =>
  openings.some((o) => Math.abs(Math.atan2(Math.sin(a - o), Math.cos(a - o))) < half)

export function KayKitDungeon({ doors, openings = [] }: { doors: [number, number][]; openings?: number[] }) {
  const P = usePieces()

  // Outer floor: 4x4 tiles filling the ring between the arena and the walls.
  const tiles = useMemo(() => {
    const out: [number, number][] = []
    for (let x = -26; x <= 26; x += 4) {
      for (let z = -26; z <= 26; z += 4) {
        const d = Math.hypot(x, z)
        if (d > R - 2 && d < WALL_R + 1) out.push([x, z])
      }
    }
    return out
  }, [])

  const walls = useMemo(() => Array.from({ length: WALL_N }, (_, k) => (k / WALL_N) * Math.PI * 2), [])
  const pillars = useMemo(() => Array.from({ length: 12 }, (_, k) => (k / 12) * Math.PI * 2 + Math.PI / 12), [])
  const clutter: { piece: Piece; a: number; r: number; s: number; turn: number }[] = useMemo(() => [
    { piece: 'barrel_large', a: 0.62, r: 20.5, s: 0.7, turn: 0.3 },
    { piece: 'crates_stacked', a: 0.95, r: 21, s: 0.8, turn: 1.1 },
    { piece: 'chest_gold', a: 1.55, r: 20.2, s: 0.9, turn: 0 },
    { piece: 'candle_triple', a: 1.75, r: 19.6, s: 1.2, turn: 0 },
    { piece: 'keg_decorated', a: 2.45, r: 20.8, s: 0.8, turn: 0.6 },
    { piece: 'rubble_half', a: 2.95, r: 21.2, s: 0.7, turn: 0.2 },
    { piece: 'sword_shield_broken', a: 3.7, r: 20.4, s: 1.2, turn: 0 },
    { piece: 'trunk_large_A', a: 4.15, r: 20.8, s: 0.9, turn: 0 },
    { piece: 'box_stacked', a: 4.65, r: 21, s: 0.8, turn: 0.4 },
    { piece: 'candle_triple', a: 5.05, r: 19.7, s: 1.2, turn: 0 },
    { piece: 'barrel_large', a: 5.6, r: 20.6, s: 0.65, turn: 0.9 },
    { piece: 'shelf_small_candles', a: 5.95, r: 22.2, s: 1.1, turn: 0 },
  ], [])

  return (
    <group>
      {tiles.map(([x, z]) => (
        <Clone key={`${x},${z}`} object={P.floor_tile_large} position={[x, -0.12, z]} receiveShadow />
      ))}
      {walls.map((a, k) => {
        if (inOpening(a, openings)) return null
        const arched = k % 2 === 0
        return (
          <group key={k} {...ring(a, WALL_R)} scale={2}>
            <Clone object={arched ? P.wall_arched : P.wall} />
            {arched ? (
              <group position={[0, 2.1, 0.5]}>
                <Clone object={P.torch_mounted} />
                <mesh position={[0, 0.75, 0.32]} scale={0.9}>
                  <planeGeometry />
                  <meshBasicMaterial map={softCircleTexture()} color={[3, 1.6, 0.6]} transparent depthWrite={false} toneMapped={false} />
                </mesh>
                {k % 6 === 0 && <pointLight position={[0, 0.8, 0.6]} color="#ffae5c" intensity={6} distance={9} decay={1.6} />}
              </group>
            ) : (
              <Clone object={k % 4 === 1 ? P.banner_patternA_blue : P.banner_patternB_blue} />
            )}
          </group>
        )
      })}
      {pillars.map((a, k) => inOpening(a, openings, 0.2) ? null : (
        <group key={k} {...ring(a, R + 2.8)} scale={1.5}>
          <Clone object={P.pillar_decorated} />
        </group>
      ))}
      {doors.map(([x, z], k) => {
        const a = Math.atan2(x, z)
        return (
          <group key={k} {...ring(a, R + 0.9)}>
            <Clone object={P.wall_doorway} />
            <mesh position={[0, 1.4, -0.2]}>
              <planeGeometry args={[2.2, 2.8]} />
              <meshBasicMaterial map={softCircleTexture()} color={[0.3, 1.5, 0.4]} transparent opacity={0.75} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        )
      })}
      {clutter.filter((c) => !inOpening(c.a, openings)).map((c, k) => (
        <group key={k} position={[Math.sin(c.a) * c.r, 0, Math.cos(c.a) * c.r]} rotation={[0, c.a + Math.PI + c.turn, 0]} scale={c.s}>
          <Clone object={P[c.piece]} castShadow />
        </group>
      ))}
      <Sentinels />
    </group>
  )
}

type Room = { id: string; name: string; center: [number, number]; radius: number }
type Corridor = { x_half: number; z_min: number; z_max: number }

/**
 * The rest of the crypt for dungeon runs: the rooms before the boss and the
 * corridors between them, from the layout recorded in the replay. Same KayKit
 * pieces as the throne room; every placement is fixed math.
 */
export function CryptRun({ rooms, corridors }: { rooms: Room[]; corridors: Corridor[] }) {
  const P = usePieces()
  const others = rooms.filter((r) => r.id !== 'boss')
  const tiles = useMemo(() => {
    const out = new Set<string>()
    const walk = (x: number, z: number) => {
      const inRoom = others.some((r) => Math.hypot(x - r.center[0], z - r.center[1]) < r.radius + 1.5)
      const inCor = corridors.some((c) => Math.abs(x) < c.x_half + 2.5 && z > c.z_min - 2 && z < c.z_max + 2)
      return inRoom || inCor
    }
    for (let x = -14; x <= 14; x += 4) for (let z = 16; z <= 92; z += 4) if (walk(x, z)) out.add(`${x},${z}`)
    return [...out].map((k) => k.split(',').map(Number) as [number, number])
  }, [others, corridors])
  // Room walls: a ring of wall segments, skipping where a corridor enters. Walls
  // are cut down (dollhouse style) so the fight stays visible from above.
  const roomWalls = useMemo(() => others.flatMap((r) => {
    const n = Math.max(10, Math.round((2 * Math.PI * (r.radius + 1.2)) / 3.6))
    const out: { x: number; z: number; a: number; k: number }[] = []
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      const x = r.center[0] + Math.sin(a) * (r.radius + 1.2)
      const z = r.center[1] + Math.cos(a) * (r.radius + 1.2)
      const open = corridors.some((c) => Math.abs(x) < c.x_half + 1.6 && z > c.z_min - 1.5 && z < c.z_max + 1.5)
      if (!open) out.push({ x, z, a, k })
    }
    return out
  }), [others, corridors])
  const corridorWalls = useMemo(() => corridors.flatMap((c) => {
    const out: { x: number; z: number; side: number }[] = []
    for (let z = c.z_min + 2; z <= c.z_max - 1; z += 4) {
      const inRoom = (x: number) => others.some((r) => Math.hypot(x - r.center[0], z - r.center[1]) < r.radius + 1.5)
      for (const side of [-1, 1]) {
        const x = side * (c.x_half + 0.9)
        if (!inRoom(x) && Math.hypot(x, z) > 16.5) out.push({ x, z, side })
      }
    }
    return out
  }), [others, corridors])
  return (
    <group>
      {tiles.map(([x, z]) => <Clone key={`${x},${z}`} object={P.floor_tile_large} position={[x, -0.12, z]} receiveShadow />)}
      {roomWalls.map((w) => (
        <group key={`${w.x.toFixed(1)},${w.z.toFixed(1)}`} position={[w.x, 0, w.z]} rotation={[0, w.a + Math.PI, 0]} scale={[0.95, 0.95, 1]}>
          <Clone object={w.k % 3 === 0 ? P.wall_arched : P.wall} />
          {w.k % 3 === 0 && (
            <group position={[0, 1.5, 0.5]}>
              <Clone object={P.torch_mounted} />
              <mesh position={[0, 0.75, 0.32]} scale={0.9}>
                <planeGeometry />
                <meshBasicMaterial map={softCircleTexture()} color={[3, 1.6, 0.6]} transparent depthWrite={false} toneMapped={false} />
              </mesh>
              {w.k % 6 === 0 && <pointLight position={[0, 0.8, 0.6]} color="#ffae5c" intensity={5} distance={9} decay={1.6} />}
            </group>
          )}
        </group>
      ))}
      {corridorWalls.map((w) => (
        <group key={`${w.x},${w.z}`} position={[w.x, 0, w.z]} rotation={[0, w.side > 0 ? -Math.PI / 2 : Math.PI / 2, 0]} scale={[1, 0.55, 1]}>
          <Clone object={P.wall} />
        </group>
      ))}
      {others.map((r) => (
        <group key={r.id}>
          {[-1, 1].map((s) => (
            <group key={s} position={[r.center[0] + s * (r.radius - 1.2), 0, r.center[1]]} scale={1.2}>
              <Clone object={P.pillar_decorated} />
            </group>
          ))}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[r.center[0], 0.015, r.center[1]]}>
            <ringGeometry args={[r.radius - 1.1, r.radius - 0.95, 64]} />
            <meshBasicMaterial color={[0.6, 0.4, 1.6]} toneMapped={false} transparent opacity={0.35} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Dormant skeleton warriors in "inactive" pose, turned to stone. */
function Sentinels() {
  const gltf = useGLTF(CHARACTER_URL.Skeleton_Warrior) as unknown as GLTF
  const shield = useGLTF(SHIELD_URL) as unknown as GLTF
  const clips = useClipLibrary()
  const spots = useMemo(() => [-0.75, -0.42, 0.42, 0.75, 2.3, -2.3].map((a) => a + Math.PI), [])
  const statues = useMemo(() => spots.map(() => {
    const root = cloneSkinned(gltf.scene)
    toonify(root, { tint: '#8a85a3' })
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && /Eyes/i.test(o.name)) m.material = glow('#a07bff', 3)
    })
    const s = shield.scene.clone(true)
    toonify(s, { tint: '#8a85a3' })
    findBone(root, 'handslot.l')?.add(s)
    const clip = clips.get('Skeletons_Inactive_Standing_Pose') ?? clips.get('Idle_A')
    if (clip) {
      const mixer = new THREE.AnimationMixer(root)
      mixer.clipAction(clip).play()
      mixer.update(0)
    }
    return root
  }), [gltf, shield, clips, spots])
  return (
    <>
      {spots.map((a, k) => (
        <group key={k} {...ring(a, R + 5)}>
          <mesh position={[0, 0.3, 0]}>
            <boxGeometry args={[1.6, 0.6, 1.6]} />
            <meshToonMaterial color="#3a3552" />
          </mesh>
          <primitive object={statues[k]} position={[0, 0.6, 0]} scale={1.15} />
        </group>
      ))}
    </>
  )
}

useGLTF.preload(URLS)
