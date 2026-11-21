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

/** Soft golden halo for the healer (same idea as the boss crown, gentler). */
function makeHalo(): THREE.Group {
  const g = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 40), glow('#ffd76a', 2.2))
  ring.rotation.x = Math.PI / 2
  const haze = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.11, 8, 40), glow('#ffe9a8', 1.2, 0.18))
  haze.rotation.x = Math.PI / 2
  g.add(ring, haze)
  return g
}

/**
 * KayKit characters share one palette-atlas texture per model. To turn the
 * Mage into a priestess we repaint that atlas: the violet/indigo robe swatches
 * become ivory, the magenta trims become gold. Everything else (skin, hair,
 * leather) is untouched, so the model keeps its detail.
 */
const priestCache = new WeakMap<THREE.Texture, THREE.Texture>()
function priestTexture(src: THREE.Texture): THREE.Texture {
  const hit = priestCache.get(src)
  if (hit) return hit
  const img = src.image as CanvasImageSource & { width: number; height: number }
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  const c = new THREE.Color()
  const hsl = { h: 0, s: 0, l: 0 }
  for (let i = 0; i < px.length; i += 4) {
    c.setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255)
    c.getHSL(hsl)
    const deg = hsl.h * 360
    if (hsl.s < 0.15) continue
    if (deg >= 215 && deg < 300) c.setHSL(45 / 360, 0.35, 0.72 + hsl.l * 0.28) // robe -> ivory
    else if (deg >= 300 || deg < 5) c.setHSL(42 / 360, 0.85, 0.42 + hsl.l * 0.3) // trim -> gold
    else continue
    px[i] = c.r * 255
    px[i + 1] = c.g * 255
    px[i + 2] = c.b * 255
  }
  ctx.putImageData(data, 0, 0)
  const out = src.clone()
  out.image = canvas
  out.needsUpdate = true
  priestCache.set(src, out)
  return out
}

const BOSS_CAST_COLORS: Record<string, string> = {
  requiem_of_bones: '#c77dff', soul_rend: '#ff4d6d', raise_dead: '#9dff6b',
}

// ---------------------------------------------------------------------------
// the avatar
// ---------------------------------------------------------------------------

const FADE_MS = 150

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
      return w
    }
    attach(load.right, 'handslot.r')
    const offHand = attach(load.left, 'handslot.l')

    if (info.role === 'healer') {
      root.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshToonMaterial
        if (!src.map) return
        m.material = new THREE.MeshToonMaterial({ map: priestTexture(src.map), gradientMap: toonGradient() })
      })
      // The pointed wizard hat is what makes the Mage read as a mage.
      root.traverse((o) => { if (/Hat/i.test(o.name)) o.visible = false })
      // A prayer book held open in the palm (the raw asset is shield-sized).
      if (offHand) {
        offHand.scale.setScalar(0.55)
        offHand.rotation.set(-Math.PI / 2, 0, 0)
      }
      const halo = makeHalo()
      halo.position.set(0, 1.0, 0)
      findBone(root, 'head')?.add(halo)
    }

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
  }, [gltf, gearList, info.model, info.role, isBoss, isAdd])

  const actions = useRef(new Map<string, THREE.AnimationAction>())
  // cur/prev are action slots: "<clip>#0" or "<clip>#1". Two slots per clip
  // let a swing cross-fade into the next swing of the same clip.
  const blend = useRef({ cur: '', curKey: '', prev: '', curTime: 0, prevTime: 0, fadeStart: 0, fadeT: 0 })
  const flinch = useRef<THREE.Group>(null)

  const action = (slot: string) => {
    let a = actions.current.get(slot)
    if (!a) {
      const [name, n] = slot.split('#')
      const clip = clips.get(name)
      if (!clip) return undefined
      // The mixer caches one action per clip object, so slot 1 needs its own copy.
      a = rig.mixer.clipAction(n === '1' ? clip.clone() : clip)
      actions.current.set(slot, a)
    }
    return a
  }

  useFrame(() => {
    const f = frameState()
    const u = f?.s.units[id]
    if (!f || !u) return
    const pose = poseOf(u, f.t, f.engine.replay)
    let choice = chooseClip(info.class, group, pose, (n) => clips.get(n)?.duration)
    if (!clips.has(choice.name)) choice = { name: 'Idle_A', time: (d) => (f.t / 1000) % d, key: 'fallback' }

    // Cross-fade between clips (cosmetic smoothing, like the facing damping).
    const b = blend.current
    const now = performance.now()
    if (b.curKey !== choice.key) {
      const sameClip = b.cur.startsWith(`${choice.name}#`)
      const next = `${choice.name}#${sameClip && b.cur.endsWith('#0') ? 1 : 0}`
      if (b.prev && b.prev !== b.cur) action(b.prev)?.stop()
      b.prev = b.cur === next ? '' : b.cur
      b.prevTime = b.curTime
      b.cur = next
      b.curKey = choice.key
      b.fadeStart = now
      b.fadeT = f.t
    }
    const cur = action(b.cur)
    if (!cur) return
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
        // The outgoing clip keeps moving (with replay time) while it fades,
        // instead of freezing mid-pose.
        const d = prev.getClip().duration
        prev.play()
        prev.time = Math.min(d - 1e-3, b.prevTime + Math.max(0, f.t - b.fadeT) / 1000)
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
