import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { posAt } from '../replay/engine'
import { frameState, usePlayback } from '../replay/store'
import { Arena } from './Arena'
import { Effects } from './Effects'
import { Units } from './Units'
import { PickLayer } from '../play/PickLayer'
import { picking } from './picking'

/** Lets DOM overlays (floating numbers, nameplates) project 3D -> screen. */
export const sceneBridge: { camera: THREE.Camera | null; scene: THREE.Scene | null; size: { width: number; height: number } } = {
  camera: null, scene: null, size: { width: 1, height: 1 },
}

function Bridge() {
  const { camera, size, scene } = useThree()
  useEffect(() => {
    sceneBridge.scene = scene
    if (import.meta.env.DEV) (window as unknown as { __bridge: typeof sceneBridge }).__bridge = sceneBridge
    sceneBridge.camera = camera
    sceneBridge.size = size
  }, [camera, size, scene])
  return null
}

/** Advances replay time once per rendered frame. */
function PlaybackDriver() {
  const advance = usePlayback((p) => p.advance)
  useFrame((_, dt) => advance(Math.min(dt, 0.1) * 1000))
  return null
}

const QUERY = new URLSearchParams(location.search)
const NO_FX = QUERY.get('nofx') === '1'
/** ?follow=0 keeps the camera where ?cam/?look put it (close-up shots, debugging). */
const FOLLOW = QUERY.get('follow') !== '0'
/** Optional camera override: ?cam=x,y,z&look=x,y,z (debugging and shareable shots). */
const vec = (k: string, d: [number, number, number]) => {
  const v = QUERY.get(k)?.split(',').map(Number)
  return v && v.length === 3 && v.every(Number.isFinite) ? (v as [number, number, number]) : d
}
const CAM_POS = vec('cam', [15, 18, 23])
const CAM_LOOK = vec('look', [0, 0.5, 1.2])

/**
 * Dungeon runs: keep the camera on the party as it walks the crypt. Boss-only
 * fights look at the throne room (and a switch from a dungeon run snaps back
 * there, instead of staring down an empty corridor). The orbit
 * angle and zoom stay the user's; only the point being looked at glides to the
 * party's centre (cosmetic smoothing, like facing damping). The sun follows so
 * shadows keep working away from the throne room.
 */
function FollowParty() {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  const { camera, scene } = useThree()
  const snapped = useRef<string | null>(null)
  useFrame((_, dt) => {
    const f = frameState()
    if (!f || !controls || !FOLLOW) return
    let want: THREE.Vector3
    if (f.engine.replay.arena.rooms) {
      const own = picking.follow ? f.s.units[picking.follow] : null
      const alive = own?.alive ? [own] : f.s.order.map((id) => f.s.units[id]).filter((u) => u.info.kind === 'player' && u.alive)
      const pts = (alive.length ? alive : f.s.order.map((id) => f.s.units[id]).filter((u) => u.info.kind === 'player'))
        .map((u) => posAt(u, f.t))
      if (!pts.length) return
      want = new THREE.Vector3(pts.reduce((a, p) => a + p[0], 0) / pts.length, 0.6, pts.reduce((a, p) => a + p[1], 0) / pts.length)
      if (own?.alive) {
        // /play: look a little in front of your character, so it sits above the orders panel.
        const toward = new THREE.Vector3(camera.position.x - controls.target.x, 0, camera.position.z - controls.target.z)
        if (toward.lengthSq() > 1e-6) want.add(toward.normalize().multiplyScalar(4))
      }
    } else {
      want = new THREE.Vector3(...CAM_LOOK)
    }
    const key = f.engine.replay.meta.seed + f.engine.replay.meta.policy
    const k = snapped.current === key ? 1 - Math.exp(-Math.min(dt, 0.1) * 3) : 1 // snap on a new replay
    snapped.current = key
    const delta = want.sub(controls.target).multiplyScalar(k)
    controls.target.add(delta)
    camera.position.add(delta)
    controls.update()
    const sun = scene.getObjectByName('sun') as THREE.DirectionalLight | undefined
    if (sun) {
      sun.position.set(controls.target.x + 8, 22, controls.target.z + 10)
      sun.target.position.copy(controls.target)
      sun.target.updateMatrixWorld()
    }
  })
  return null
}

export function Scene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: CAM_POS, fov: 40, near: 0.5, far: 200 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#0d0a18']} />
      <fog attach="fog" args={['#140d24', 26, 62]} />
      <Bridge />
      <PlaybackDriver />
      {/* Moonlight from above + cool/warm fill. */}
      <hemisphereLight args={['#9d8cff', '#2a1838', 0.9]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        name="sun"
        castShadow
        position={[8, 22, 10]}
        intensity={1.6}
        color="#dcd6ff"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-bias={-0.0005}
      />
      <pointLight position={[0, 7, 3]} color="#8fe8ff" intensity={6} distance={14} />
      <Arena />
      <Units />
      <Effects />
      <PickLayer />
      <FollowParty />
      <OrbitControls
        makeDefault
        target={CAM_LOOK}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={42}
        minPolarAngle={0.45}
        maxPolarAngle={1.15}
        rotateSpeed={0.6}
      />
      {!NO_FX && <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.2} intensity={0.9} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>}
    </Canvas>
  )
}
