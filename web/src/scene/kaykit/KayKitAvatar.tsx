import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { frameState } from '../../replay/store'
import type { UnitInfo } from '../../replay/types'
import { glow, toonGradient } from '../materials'
import { poseOf } from '../pose'
import { ALL_GEAR_URLS, ANIMATION_URLS, CHARACTER_URL, LOADOUT, MODEL_SCALE } from './assets'
import { chooseClip } from './clips'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const toonCache = new WeakMap<THREE.Material, THREE.Material>()
/** Swap KayKit's PBR materials for cel-shaded toon ones (keeps the art style consistent). */
export function toonify(root: THREE.Object3D, opts: { tint?: string } = {}) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const conv = (m: THREE.Material) => {
      if (opts.tint) {
        const src = m as THREE.MeshStandardMaterial
        return new THREE.MeshToonMaterial({ map: src.map, color: opts.tint, gradientMap: toonGradient() })
      }
      let out = toonCache.get(m)
      if (!out) {
        const src = m as THREE.MeshStandardMaterial
        out = new THREE.MeshToonMaterial({
          map: src.map ?? null, color: src.color ?? new THREE.Color('#fff'), gradientMap: toonGradient(),
          transparent: src.transparent, alphaTest: src.alphaTest,
        })
        toonCache.set(m, out)
      }
      return out
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material)
  })
}

/** GLTFLoader strips '.' from node names ("handslot.r" -> "handslotr"). */
export function findBone(root: THREE.Object3D, name: string): THREE.Object3D | undefined {
  const want = name.replace(/[.\s]/g, '').toLowerCase()
  let found: THREE.Object3D | undefined
  root.traverse((o) => {
    if (!found && o.name.replace(/[.\s]/g, '').toLowerCase() === want) found = o
  })
  return found
}

/** All animation clips from the shared Rig_Medium libraries, by name. */
export function useClipLibrary(): Map<string, THREE.AnimationClip> {
  const libs = useGLTF(ANIMATION_URLS) as unknown as GLTF[]
  return useMemo(() => {
    const map = new Map<string, THREE.AnimationClip>()
    for (const lib of libs) for (const c of lib.animations) if (!map.has(c.name)) map.set(c.name, c)
    return map
  }, [libs])
}

function makeCrown(): THREE.Group {
  const g = new THREE.Group()
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 32), glow('#9fe8ff', 1.4))
  band.rotation.x = Math.PI / 2
  g.add(band)
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2
    const tall = k === 0 ? 0.55 : 0.32
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, tall, 6), glow(k === 0 ? '#d6f8ff' : '#9fe8ff', k === 0 ? 2.4 : 1.5))
    spike.position.set(Math.sin(a) * 0.42, tall / 2, Math.cos(a) * 0.42)
    g.add(spike)
  }
  return g
}

const BOSS_CAST_COLORS: Record<string, string> = {
  requiem_of_bones: '#c77dff', soul_rend: '#ff4d6d', raise_dead: '#9dff6b',
}

// ---------------------------------------------------------------------------
// the avatar
// ---------------------------------------------------------------------------

const FADE_MS = 120

export function KayKitAvatar({ id, info }: { id: string; info: UnitInfo }) {
  const gltf = useGLTF(CHARACTER_URL[info.model] ?? CHARACTER_URL.Knight) as unknown as GLTF
  const gearList = useGLTF(ALL_GEAR_URLS) as unknown as GLTF[]
  const clips = useClipLibrary()
  const isBoss = info.kind === 'boss'
  const isAdd = info.kind === 'add'
  const group = isBoss ? 'boss' : isAdd ? 'add' : 'hero'

  const rig = useMemo(() => {
    const root = cloneSkinned(gltf.scene) as THREE.Group
    toonify(root)
    const gearByUrl = Object.fromEntries(ALL_GEAR_URLS.map((u, i) => [u, gearList[i]]))
    const load = LOADOUT[info.model] ?? {}
    const attach = (url: string | undefined, bone: string) => {
      if (!url || !gearByUrl[url]) return
      const w = gearByUrl[url].scene.clone(true)
      toonify(w)
      findBone(root, bone)?.add(w)
    }
    attach(load.right, 'handslot.r')
    attach(load.left, 'handslot.l')

    let orb: THREE.Group | null = null
    if (isBoss || isAdd) {
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (isBoss && /Helmet/i.test(o.name)) o.visible = false
        if (m.isMesh && /Eyes/i.test(o.name)) m.material = glow(isBoss ? '#7ff3ff' : '#9dff6b', 3.5)
        if (isBoss && m.isMesh && /Cloak/i.test(o.name)) {
          const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshToonMaterial
          m.material = new THREE.MeshToonMaterial({ map: src.map, color: '#8c6fd6', gradientMap: toonGradient() })
        }
      })
    }
    if (isBoss) {
      const crown = makeCrown()
      crown.position.set(0, 0.95, 0)
      findBone(root, 'head')?.add(crown)
      orb = new THREE.Group()
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), new THREE.MeshBasicMaterial({ toneMapped: false }))
      const light = new THREE.PointLight('#c77dff', 6, 10)
      orb.add(ball, light)
      orb.visible = false
      findBone(root, 'handslot.l')?.add(orb)
    }
    return { root, mixer: new THREE.AnimationMixer(root), orb }
  }, [gltf, gearList, info.model, isBoss, isAdd])

  const actions = useRef(new Map<string, THREE.AnimationAction>())
  const blend = useRef({ cur: '', prev: '', curTime: 0, prevTime: 0, fadeStart: 0 })
  const flinch = useRef<THREE.Group>(null)

  const action = (name: string) => {
    let a = actions.current.get(name)
    if (!a) {
      const clip = clips.get(name)
      if (!clip) return undefined
      a = rig.mixer.clipAction(clip)
      actions.current.set(name, a)
    }
    return a
  }

  useFrame(() => {
    const f = frameState()
    const u = f?.s.units[id]
    if (!f || !u) return
    const pose = poseOf(u, f.t, f.engine.replay)
    let choice = chooseClip(info.class, group, pose)
    if (!clips.has(choice.name)) choice = { name: 'Idle_A', time: (d) => (f.t / 1000) % d }
    const cur = action(choice.name)
    if (!cur) return

    // Cross-fade between clips (cosmetic smoothing, like the facing damping).
    const b = blend.current
    const now = performance.now()
    if (b.cur !== choice.name) {
      if (b.prev && b.prev !== choice.name) action(b.prev)?.stop()
      b.prev = b.cur
      b.prevTime = b.curTime
      b.cur = choice.name
      b.fadeStart = now
    }
    const w = Math.min(1, (now - b.fadeStart) / FADE_MS)
    b.curTime = choice.time(cur.getClip().duration)
    cur.play()
    cur.time = b.curTime
    cur.setEffectiveWeight(b.prev ? w : 1)
    const prev = b.prev ? action(b.prev) : undefined
    if (prev) {
      if (w >= 1) {
        prev.stop()
        b.prev = ''
      } else {
        prev.play()
        prev.time = b.prevTime
        prev.setEffectiveWeight(1 - w)
      }
    }
    rig.mixer.update(0)

    if (flinch.current) flinch.current.rotation.x = pose.mode === 'dead' ? 0 : -pose.hit * 0.15
    if (rig.orb) {
      rig.orb.visible = !!u.cast
      if (u.cast) {
        const col = BOSS_CAST_COLORS[u.cast.ability] ?? '#8fe8ff'
        ;((rig.orb.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(col).multiplyScalar(4)
        ;(rig.orb.children[1] as THREE.PointLight).color.set(col)
        rig.orb.scale.setScalar(0.7 + pose.k * 0.8 + Math.sin(f.t / 55) * 0.05)
      }
    }
  })

  const scale = MODEL_SCALE[info.kind]
  return (
    <group ref={flinch}>
      <primitive object={rig.root} scale={scale} />
    </group>
  )
}

// Start downloading everything as soon as the module loads.
useGLTF.preload(ANIMATION_URLS)
useGLTF.preload(ALL_GEAR_URLS)
Object.values(CHARACTER_URL).forEach((u) => useGLTF.preload(u))
