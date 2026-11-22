import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { SCHOOL_COLORS } from '../content/display'
import type { ReplayState } from '../replay/engine'
import { posAt } from '../replay/engine'
import { frameState, usePlayback } from '../replay/store'
import { muzzleOffset } from './anchors'
import { softCircleTexture, swirlTexture } from './materials'

export function Effects() {
  return (
    <>
      <GroundPools />
      <Projectiles />
      <Bursts />
      <HealBeams />
    </>
  )
}

// ---------------------------------------------------------------------------
// Desecrate pools: telegraph ring while arming, then a swirling void pool.
// ---------------------------------------------------------------------------

function GroundPools() {
  const ids = usePlayback((p) => (p.engine ? Object.keys(p.engine.stateAt(p.t).ground).join(',') : ''))
  if (!ids) return null
  return <>{ids.split(',').map((id) => <Pool key={id} id={id} />)}</>
}

const POOL_COLORS: Record<string, { fill: string; swirl: string; edge: string }> = {
  desecrate: { fill: '#3fbf6a', swirl: '#5fd08a', edge: '#a8f0a0' },
  grave: { fill: '#8f7ad6', swirl: '#b7a6f0', edge: '#e6dcff' },
}

function Pool({ id }: { id: string }) {
  const group = useRef<THREE.Group>(null)
  const fill = useRef<THREE.Mesh>(null)
  const swirl = useRef<THREE.Mesh>(null)
  const edge = useRef<THREE.Mesh>(null)
  const kind = usePlayback((p) => p.engine?.stateAt(p.t).ground[id]?.kind)
  const mats = useMemo(() => {
    // Desecrate: sickly green. Restless Grave (+10 affix): pale bone-violet.
    const c = POOL_COLORS[kind ?? 'desecrate'] ?? POOL_COLORS.desecrate
    return {
      fill: new THREE.MeshBasicMaterial({ color: new THREE.Color(c.fill).multiplyScalar(0.6), transparent: true, opacity: 0.25, depthWrite: false, toneMapped: false }),
      swirl: new THREE.MeshBasicMaterial({ map: swirlTexture(), color: new THREE.Color(c.swirl).multiplyScalar(0.6), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9 }),
      edge: new THREE.MeshBasicMaterial({ color: new THREE.Color(c.edge).multiplyScalar(1.15), transparent: true, depthWrite: false, toneMapped: false }),
      void: new THREE.MeshBasicMaterial({ color: '#12081f', transparent: true, opacity: 0.85, depthWrite: false }),
    }
  }, [kind])
  useFrame(() => {
    const f = frameState()
    const g = f?.s.ground[id]
    if (!f || !g || !group.current || !fill.current || !swirl.current || !edge.current) return
    group.current.position.set(g.pos[0], 0, g.pos[1])
    const age = f.t - g.t0
    const armed = age >= g.armMs
    const left = g.t0 + g.durMs - f.t
    const fade = Math.max(0, Math.min(1, left / 1000))
    if (!armed) {
      const k = age / g.armMs
      fill.current.scale.setScalar(g.radius * k)
      mats.fill.opacity = 0.35
      swirl.current.visible = false
      edge.current.scale.setScalar(g.radius)
      mats.edge.opacity = 0.6 + 0.4 * Math.sin(age / 60)
    } else {
      fill.current.scale.setScalar(g.radius)
      mats.fill.opacity = 0.3 * fade
      swirl.current.visible = true
      swirl.current.scale.setScalar(g.radius * (1 + Math.sin(f.t / 300) * 0.02))
      swirl.current.rotation.z = f.t / 700
      mats.swirl.opacity = 0.7 * fade
      edge.current.scale.setScalar(g.radius)
      mats.edge.opacity = 0.8 * fade
    }
  })
  return (
    <group ref={group}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={mats.void} scale={1}>
        <circleGeometry args={[0.98, 40]} />
      </mesh>
      <mesh ref={fill} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={mats.fill}>
        <circleGeometry args={[1, 40]} />
      </mesh>
      <mesh ref={swirl} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} material={mats.swirl}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      <mesh ref={edge} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} material={mats.edge}>
        <ringGeometry args={[0.93, 1, 48]} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Projectiles (arrows, Sunspark) — positions are a pure function of t.
// ---------------------------------------------------------------------------

const MAX_PROJ = 16
const TRAIL = 5

function chestHeight(s: ReplayState, id: string) {
  const k = s.units[id]?.info.kind
  return k === 'boss' ? 3.2 : k === 'add' ? 0.9 : 0.85
}

function Projectiles() {
  const refs = useRef<(THREE.Group | null)[]>([])
  const mats = useMemo(() => Array.from({ length: MAX_PROJ }, () => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true })), [])
  const tmpA = new THREE.Vector3()
  const tmpB = new THREE.Vector3()
  useFrame(() => {
    const f = frameState()
    let n = 0
    if (f) {
      for (const { e } of f.engine.eventsBetween(f.t - 1000, f.t)) {
        if (e.type !== 'projectile' || n >= MAX_PROJ) continue
        const k = (f.t - e.t) / e.travel_ms
        if (k < 0 || k > 1) continue
        const src = f.s.units[e.source]
        const tgt = f.s.units[e.target]
        if (!src || !tgt) continue
        const a = posAt(src, e.t)
        const b = posAt(tgt, f.t)
        // Leave from the weapon (bow, staff tip), not the chest.
        const mz = muzzleOffset(e.source, posAt(src, f.t))
        if (mz) tmpA.set(a[0] + mz[0], mz[1], a[1] + mz[2])
        else tmpA.set(a[0], chestHeight(f.s, e.source), a[1])
        tmpB.set(b[0], chestHeight(f.s, e.target), b[1])
        const g = refs.current[n]
        if (!g) continue
        g.visible = true
        const school = f.engine.replay.abilities[e.ability]?.school ?? 'physical'
        const col = e.ability === 'silencing_arrow' ? '#7fd0ff' : e.ability === 'piercing_shot' ? '#b8ff7a' : SCHOOL_COLORS[school]
        mats[n].color.set(col).multiplyScalar(3)
        g.children.forEach((c, j) => {
          const kk = Math.max(0, k - j * 0.05)
          c.position.lerpVectors(tmpA, tmpB, kk)
          c.position.y += Math.sin(kk * Math.PI) * 0.6 // slight arc
          c.scale.setScalar(j === 0 ? 1 : 1 - j / (TRAIL + 1))
        })
        n++
      }
    }
    for (let i = n; i < MAX_PROJ; i++) if (refs.current[i]) refs.current[i]!.visible = false
  })
  return (
    <>
      {mats.map((m, i) => (
        <group key={i} ref={(g) => { refs.current[i] = g }} visible={false}>
          {Array.from({ length: TRAIL + 1 }, (_, j) => (
            <mesh key={j} material={m}><sphereGeometry args={[j === 0 ? 0.13 : 0.09, 8, 6]} /></mesh>
          ))}
        </group>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// One-shot bursts: shockwaves, heal pillars, impact sparks, death wisps.
// ---------------------------------------------------------------------------

type BurstKind = 'ring' | 'pillar' | 'spark' | 'wisp'
interface Burst { kind: BurstKind; pos: [number, number, number]; k: number; color: string; size: number }

const MELEE = new Set(['bulwark_slam', 'rampart_strike', 'ravage', 'savage_hew', 'twin_fang', 'venom_burst', 'hollow_strike', 'bone_claw'])
const POOL: Record<BurstKind, number> = { ring: 14, pillar: 10, spark: 16, wisp: 6 }

function collectBursts(): Burst[] {
  const f = frameState()
  if (!f) return []
  const out: Burst[] = []
  const at = (id: string | null | undefined, y = 0): [number, number, number] | null => {
    const u = id ? f.s.units[id] : undefined
    if (!u) return null
    const p = posAt(u, f.t)
    return [p[0], y, p[1]]
  }
  for (const { e } of f.engine.eventsBetween(f.t - 2200, f.t)) {
    const age = f.t - e.t
    if (e.type === 'cast_success') {
      if (e.ability === 'requiem_of_bones' && age < 1100) {
        const p = at(e.unit, 0.3)
        if (p) out.push({ kind: 'ring', pos: p, k: age / 1100, color: '#c77dff', size: 16 })
      } else if (e.ability === 'wild_roar' && age < 800) {
        for (const u of Object.values(f.s.units)) {
          if (u.info.kind !== 'player' || !u.alive) continue
          const p = at(u.info.id, 0.2)
          if (p) out.push({ kind: 'ring', pos: p, k: age / 800, color: '#ff9a3c', size: 2.2 })
        }
      } else if ((e.ability === 'cleaving_storm' || e.ability === 'fan_of_blades' || e.ability === 'challenging_roar') && age < 500) {
        const p = at(e.unit, 0.5)
        if (p) out.push({ kind: 'ring', pos: p, k: age / 500, color: e.ability === 'challenging_roar' ? '#6fa8ff' : '#ffe0b0', size: e.ability === 'challenging_roar' ? 6 : 7.5 })
      } else if (e.ability === 'soul_rend' && age < 600) {
        const p = at(e.target, 1)
        if (p) out.push({ kind: 'spark', pos: p, k: age / 600, color: '#ff3b5c', size: 2.6 })
      } else if (MELEE.has(e.ability) && age < 260 && e.target) {
        const p = at(e.target, f.s.units[e.target]?.info.kind === 'boss' ? 2.2 : 0.9)
        if (p) out.push({ kind: 'spark', pos: p, k: age / 260, color: e.ability === 'hollow_strike' ? '#8fe8ff' : '#fff2c4', size: e.ability === 'hollow_strike' ? 1.4 : 0.8 })
      }
    } else if (e.type === 'cast_interrupted' && e.reason === 'interrupt' && age < 600) {
      const p = at(e.unit, 4.2)
      if (p) {
        out.push({ kind: 'spark', pos: p, k: age / 600, color: '#7fd0ff', size: 3 })
        out.push({ kind: 'ring', pos: [p[0], 0.3, p[2]], k: age / 600, color: '#7fd0ff', size: 4 })
      }
    } else if (e.type === 'heal' && age < 650 && (e.ability === 'mending_light' || e.ability === 'radiant_hymn')) {
      const p = at(e.target, 0)
      if (p) out.push({ kind: 'pillar', pos: p, k: age / 650, color: e.ability === 'radiant_hymn' ? '#fff2a0' : '#ffe58a', size: 1 })
    } else if (e.type === 'spawn' && age < 900) {
      const p = e.unit.pos
      out.push({ kind: 'ring', pos: [p[0], 0.2, p[1]], k: age / 900, color: '#9dff6b', size: 3 })
      out.push({ kind: 'pillar', pos: [p[0], 0, p[1]], k: age / 900, color: '#9dff6b', size: 1.4 })
    } else if (e.type === 'death' && age < 2200 && f.s.units[e.unit]?.info.kind === 'player') {
      const p = at(e.unit, 0.5)
      if (p) out.push({ kind: 'wisp', pos: p, k: age / 2200, color: '#bfe8ff', size: 1 })
    }
  }
  return out
}

function Bursts() {
  const refs = useRef<Record<BurstKind, (THREE.Mesh | null)[]>>({ ring: [], pillar: [], spark: [], wisp: [] })
  const mats = useMemo(() => {
    const m: Record<BurstKind, THREE.MeshBasicMaterial[]> = { ring: [], pillar: [], spark: [], wisp: [] }
    for (const k of Object.keys(POOL) as BurstKind[]) {
      for (let i = 0; i < POOL[k]; i++) {
        m[k].push(new THREE.MeshBasicMaterial({
          toneMapped: false, transparent: true, depthWrite: false, side: THREE.DoubleSide,
          map: k === 'spark' || k === 'wisp' ? softCircleTexture() : null,
        }))
      }
    }
    return m
  }, [])
  useFrame(({ camera }) => {
    const used: Record<BurstKind, number> = { ring: 0, pillar: 0, spark: 0, wisp: 0 }
    for (const b of collectBursts()) {
      const i = used[b.kind]
      if (i >= POOL[b.kind]) continue
      const mesh = refs.current[b.kind][i]
      if (!mesh) continue
      used[b.kind]++
      mesh.visible = true
      const mat = mats[b.kind][i]
      mat.color.set(b.color).multiplyScalar(2.6)
      if (b.kind === 'ring') {
        mesh.position.set(...b.pos)
        mesh.scale.setScalar(0.3 + b.size * b.k)
        mat.opacity = 1 - b.k
      } else if (b.kind === 'pillar') {
        mesh.position.set(b.pos[0], 1.4 * b.size, b.pos[2])
        mesh.scale.set(b.size * (1 - b.k * 0.4), b.size, b.size * (1 - b.k * 0.4))
        mat.opacity = 0.55 * (1 - b.k)
      } else if (b.kind === 'spark') {
        mesh.position.set(...b.pos)
        mesh.quaternion.copy(camera.quaternion)
        mesh.scale.setScalar(b.size * (0.5 + b.k))
        mat.opacity = 1 - b.k
      } else {
        mesh.position.set(b.pos[0], b.pos[1] + b.k * 3, b.pos[2])
        mesh.quaternion.copy(camera.quaternion)
        mesh.scale.setScalar(0.9)
        mat.opacity = 0.8 * (1 - b.k)
      }
    }
    for (const k of Object.keys(POOL) as BurstKind[]) {
      for (let i = used[k]; i < POOL[k]; i++) if (refs.current[k][i]) refs.current[k][i]!.visible = false
    }
  })
  return (
    <>
      {mats.ring.map((m, i) => (
        <mesh key={`r${i}`} ref={(r) => { refs.current.ring[i] = r }} material={m} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[0.85, 1, 48]} />
        </mesh>
      ))}
      {mats.pillar.map((m, i) => (
        <mesh key={`p${i}`} ref={(r) => { refs.current.pillar[i] = r }} material={m} visible={false}>
          <cylinderGeometry args={[0.55, 0.7, 2.8, 20, 1, true]} />
        </mesh>
      ))}
      {mats.spark.map((m, i) => (
        <mesh key={`s${i}`} ref={(r) => { refs.current.spark[i] = r }} material={m} visible={false}>
          <planeGeometry />
        </mesh>
      ))}
      {mats.wisp.map((m, i) => (
        <mesh key={`w${i}`} ref={(r) => { refs.current.wisp[i] = r }} material={m} visible={false}>
          <planeGeometry />
        </mesh>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Heal beams: a green-gold ribbon of light from the healer to whoever she
// heals, plus small rising motes on heal-over-time ticks. Driven by
// cast_success (direct heals, HoT/shield applications) and heal events
// (raid heals hit everyone, so each target gets its own beam).
// ---------------------------------------------------------------------------

const BEAM_MS = 600
const MOTE_MS = 800
const MAX_BEAMS = 8
const MAX_MOTES = 12
const HEAL_KINDS = new Set(['heal', 'hot', 'absorb'])
const UP = new THREE.Vector3(0, 1, 0)

interface Beam { from: string; to: string; k: number; color: string }

function HealBeams() {
  const beams = useRef<(THREE.Group | null)[]>([])
  const motes = useRef<(THREE.Mesh | null)[]>([])
  const mats = useMemo(() => ({
    core: Array.from({ length: MAX_BEAMS }, () => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false })),
    haze: Array.from({ length: MAX_BEAMS }, () => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, side: THREE.DoubleSide })),
    mote: Array.from({ length: MAX_MOTES }, () => new THREE.MeshBasicMaterial({ map: softCircleTexture(), toneMapped: false, transparent: true, depthWrite: false })),
  }), [])
  const a = useMemo(() => new THREE.Vector3(), [])
  const b = useMemo(() => new THREE.Vector3(), [])
  const dir = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera }) => {
    const f = frameState()
    let nb = 0
    let nm = 0
    if (f) {
      const list: Beam[] = []
      const tick: { to: string; k: number; seed: number }[] = []
      for (const { e, i } of f.engine.eventsBetween(f.t - Math.max(BEAM_MS, MOTE_MS), f.t)) {
        const age = f.t - e.t
        if (e.type === 'cast_success' && e.target && age < BEAM_MS) {
          const kind = f.engine.replay.abilities[e.ability]?.kind
          if (HEAL_KINDS.has(kind ?? '') && f.s.units[e.target]?.info.kind === 'player') {
            list.push({ from: e.unit, to: e.target, k: age / BEAM_MS, color: kind === 'hot' ? '#9dff8a' : '#ffe58a' })
          }
        } else if (e.type === 'heal' && e.amount > 0) {
          const kind = f.engine.replay.abilities[e.ability]?.kind
          if (kind === 'raid_heal' && age < BEAM_MS) list.push({ from: e.source, to: e.target, k: age / BEAM_MS, color: '#fff2a0' })
          else if (kind !== 'heal' && age < MOTE_MS) tick.push({ to: e.target, k: age / MOTE_MS, seed: i })
        }
      }
      for (const bm of list) {
        if (nb >= MAX_BEAMS) break
        const src = f.s.units[bm.from]
        const tgt = f.s.units[bm.to]
        const g = beams.current[nb]
        if (!src || !tgt || !g || src === tgt) continue
        const p = posAt(src, f.t)
        const q = posAt(tgt, f.t)
        const mz = muzzleOffset(bm.from, p)
        if (mz) a.set(p[0] + mz[0], mz[1], p[1] + mz[2])
        else a.set(p[0], 1.15, p[1])
        b.set(q[0], 0.95, q[1])
        dir.subVectors(b, a)
        const len = dir.length()
        if (len < 0.05) continue
        nb++
        g.visible = true
        g.position.copy(a).add(b).multiplyScalar(0.5)
        g.quaternion.setFromUnitVectors(UP, dir.multiplyScalar(1 / len))
        // grow out from the healer, then fade
        const grow = Math.min(1, bm.k / 0.25)
        const fade = Math.max(0, 1 - bm.k)
        g.scale.set(1, len, 1)
        const core = g.children[0] as THREE.Mesh
        const haze = g.children[1] as THREE.Mesh
        core.scale.set(1, grow, 1)
        haze.scale.set(1 + bm.k * 0.6, grow, 1 + bm.k * 0.6)
        core.position.y = haze.position.y = (grow - 1) / 2
        mats.core[nb - 1].color.set(bm.color).multiplyScalar(2.4)
        mats.core[nb - 1].opacity = fade
        mats.haze[nb - 1].color.set(bm.color).multiplyScalar(1.4)
        mats.haze[nb - 1].opacity = 0.22 * fade
        // a few motes ride the beam toward the target
        for (let j = 0; j < 3; j++) {
          const m = g.children[2 + j] as THREE.Mesh
          const kk = (bm.k * 1.6 + j / 3) % 1
          m.position.set(0, (kk - 0.5) * grow, 0)
          m.scale.set(1, 1 / len, 1) // undo the group's length stretch (len >= 0.05)
          m.visible = kk < grow
        }
      }
      for (const tk of tick) {
        if (nm >= MAX_MOTES) break
        const tgt = f.s.units[tk.to]
        const m = motes.current[nm]
        if (!tgt || !m) continue
        nm++
        const q = posAt(tgt, f.t)
        const ang = ((tk.seed * 2654435761) >>> 0) % 628 / 100
        m.visible = true
        m.position.set(q[0] + Math.cos(ang) * 0.45, 0.4 + tk.k * 1.6, q[1] + Math.sin(ang) * 0.45)
        m.quaternion.copy(camera.quaternion)
        m.scale.setScalar(0.35 * (1 - tk.k * 0.5))
        mats.mote[nm - 1].color.set('#b8ff8a').multiplyScalar(2.2)
        mats.mote[nm - 1].opacity = Math.max(0, 1 - tk.k)
      }
    }
    for (let i = nb; i < MAX_BEAMS; i++) if (beams.current[i]) beams.current[i]!.visible = false
    for (let i = nm; i < MAX_MOTES; i++) if (motes.current[i]) motes.current[i]!.visible = false
  })

  return (
    <>
      {mats.core.map((m, i) => (
        <group key={`b${i}`} ref={(g) => { beams.current[i] = g }} visible={false}>
          <mesh material={m}><cylinderGeometry args={[0.045, 0.045, 1, 8, 1, true]} /></mesh>
          <mesh material={mats.haze[i]}><cylinderGeometry args={[0.11, 0.11, 1, 12, 1, true]} /></mesh>
          {[0, 1, 2].map((j) => (
            <mesh key={j} material={m}><sphereGeometry args={[0.07, 8, 6]} /></mesh>
          ))}
        </group>
      ))}
      {mats.mote.map((m, i) => (
        <mesh key={`m${i}`} ref={(r) => { motes.current[i] = r }} material={m} visible={false}>
          <planeGeometry />
        </mesh>
      ))}
    </>
  )
}
