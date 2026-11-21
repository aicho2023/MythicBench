import { Outlines } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { frameState } from '../replay/store'
import { SkeletonModel, useRig } from './avatars'
import { brickTexture, flagstoneTexture, glow, runeCircleTexture, softCircleTexture, toon } from './materials'

const R = 15

export function Arena() {
  const floorMat = useMemo(() => new THREE.MeshToonMaterial({ map: flagstoneTexture(), color: '#b9b2d6' }), [])
  const wallMat = useMemo(() => new THREE.MeshToonMaterial({ map: brickTexture(), color: '#8a82b0', side: THREE.BackSide }), [])
  const stone = toon('#4a4566')
  const pillars = useMemo(() => Array.from({ length: 12 }, (_, k) => (k / 12) * Math.PI * 2 + Math.PI / 12), [])
  return (
    <group>
      {/* floor */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} material={floorMat}>
        <circleGeometry args={[R + 0.6, 72]} />
      </mesh>
      <mesh position={[0, -0.26, 0]} material={stone}>
        <cylinderGeometry args={[R + 0.9, R + 1.4, 0.5, 72]} />
      </mesh>
      {/* outer pit beyond the platform */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]}>
        <ringGeometry args={[R + 1.2, 34, 72]} />
        <meshToonMaterial color="#0c0a14" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <ringGeometry args={[R + 1.3, R + 4, 72]} />
        <meshBasicMaterial color={[0.25, 0.5, 0.7]} transparent opacity={0.35} toneMapped={false} />
      </mesh>
      {/* glowing rune rings in the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <ringGeometry args={[R - 0.35, R - 0.15, 96]} />
        <meshBasicMaterial color={[0.9, 0.6, 2.4]} toneMapped={false} transparent opacity={0.7} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[9.6, 9.75, 96]} />
        <meshBasicMaterial color={[0.6, 0.4, 1.6]} toneMapped={false} transparent opacity={0.4} />
      </mesh>
      <BossDais />
      <Throne />
      {/* walls */}
      <mesh position={[0, 4, 0]} material={wallMat}>
        <cylinderGeometry args={[23, 23, 10, 64, 1, true]} />
      </mesh>
      {pillars.map((a, k) => <Pillar key={k} angle={a} />)}
      {pillars.filter((_, k) => k % 2 === 0).map((a, k) => (
        <Banner key={k} angle={a + Math.PI / 12} />
      ))}
      <Braziers />
      <CryptDoors />
      <Sentinels />
      <LostSouls />
      <Candles />
      <Motes count={90} spread={[30, 7, 30]} center={[0, 3.5, 0]} color="#b18cff" size={0.22} seed={1} />
      <Motes count={30} spread={[6, 4, 6]} center={[0, 2.5, -2]} color="#8fe8ff" size={0.18} seed={2} />
    </group>
  )
}

function BossDais() {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    map: runeCircleTexture(), color: new THREE.Color('#7b5cff').multiplyScalar(1.6),
    transparent: true, depthWrite: false, toneMapped: false, opacity: 0.75,
  }), [])
  useFrame(() => {
    const f = frameState()
    if (ref.current && f) ref.current.rotation.z = -f.t / 9000
  })
  return (
    <group position={[0, 0, -2]}>
      <mesh receiveShadow position={[0, 0.06, 0]} material={toon('#3d3858')}>
        <cylinderGeometry args={[3.4, 3.7, 0.12, 48]} />
        <Outlines thickness={0.03} color="#120b1a" />
      </mesh>
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.13, 0]} material={mat}>
        <circleGeometry args={[3.3, 48]} />
      </mesh>
    </group>
  )
}

function Throne() {
  const s = toon('#3a3452')
  const bone = toon('#d9d0b8')
  return (
    <group position={[0, 0, -11.5]}>
      {[0, 1, 2].map((k) => (
        <mesh key={k} receiveShadow castShadow position={[0, 0.2 + k * 0.4, 1.4 - k * 0.7]} material={toon('#433d5e')}>
          <boxGeometry args={[6 - k * 0.8, 0.4, 1.4]} />
          <Outlines thickness={0.03} color="#120b1a" />
        </mesh>
      ))}
      <mesh castShadow position={[0, 2.4, -0.6]} material={s}>
        <boxGeometry args={[3, 3.6, 0.8]} />
        <Outlines thickness={0.04} color="#120b1a" />
      </mesh>
      <mesh castShadow position={[0, 4.9, -0.6]} material={s}>
        <coneGeometry args={[1.5, 2.2, 4]} />
      </mesh>
      {[-1, 1].map((x) => (
        <group key={x}>
          <mesh castShadow position={[1.7 * x, 2, -0.3]} material={s}><boxGeometry args={[0.5, 2.4, 1.4]} /></mesh>
          {[0, 1, 2].map((k) => (
            <mesh key={k} position={[1.7 * x, 3.4 + k * 0.5, -0.3]} rotation={[0, 0, -0.35 * x]} material={bone}>
              <coneGeometry args={[0.12, 0.7, 6]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* skull ornament */}
      <mesh position={[0, 3.6, -0.15]} material={bone}><sphereGeometry args={[0.45, 16, 12]} /></mesh>
      {[-1, 1].map((x) => (
        <mesh key={x} position={[0.16 * x, 3.62, 0.25]} material={glow('#8fe8ff', 3)}><sphereGeometry args={[0.08, 8, 6]} /></mesh>
      ))}
      <pointLight position={[0, 4, 1.5]} color="#7fd6ff" intensity={6} distance={10} />
    </group>
  )
}

function Pillar({ angle }: { angle: number }) {
  const r = R + 2.6
  const s = toon('#4b4567')
  return (
    <group position={[Math.sin(angle) * r, 0, Math.cos(angle) * r]}>
      <mesh castShadow receiveShadow position={[0, 0.3, 0]} material={toon('#3a3552')}>
        <boxGeometry args={[1.8, 0.6, 1.8]} />
        <Outlines thickness={0.04} color="#120b1a" />
      </mesh>
      <mesh castShadow receiveShadow position={[0, 4, 0]} material={s}>
        <cylinderGeometry args={[0.6, 0.7, 7, 10]} />
        <Outlines thickness={0.04} color="#120b1a" />
      </mesh>
      <mesh position={[0, 7.6, 0]} material={toon('#3a3552')}>
        <boxGeometry args={[1.7, 0.5, 1.7]} />
      </mesh>
      <mesh position={[0, 2.6, 0]} material={glow('#8a6bff', 1.6)} rotation={[0, angle, 0]}>
        <torusGeometry args={[0.66, 0.04, 6, 20]} />
      </mesh>
    </group>
  )
}

function Banner({ angle }: { angle: number }) {
  const r = 22.4
  return (
    <group position={[Math.sin(angle) * r, 5.4, Math.cos(angle) * r]} rotation={[0, angle + Math.PI, 0]}>
      <mesh material={toon('#4b2470')}><planeGeometry args={[2, 4.5]} /></mesh>
      <mesh position={[0, -2.6, 0.01]} rotation={[0, 0, Math.PI]} material={toon('#4b2470')}><circleGeometry args={[1, 3]} /></mesh>
      <mesh position={[0, 0.5, 0.02]} material={glow('#c9a24a', 1.3)}><ringGeometry args={[0.45, 0.58, 24]} /></mesh>
      <mesh position={[0, 0.5, 0.02]} material={glow('#c9a24a', 1.3)}><circleGeometry args={[0.22, 3]} /></mesh>
    </group>
  )
}

const BRAZIERS = [0.35, 1.9, 2.8, 3.5, 4.4, 5.95].map((a) => [Math.sin(a) * (R - 0.9), Math.cos(a) * (R - 0.9)] as const)

function Braziers() {
  const flames = useRef<(THREE.Group | null)[]>([])
  useFrame(() => {
    const f = frameState()
    const t = (f?.t ?? 0) / 1000
    flames.current.forEach((g, k) => {
      if (!g) return
      const fl = 1 + Math.sin(t * 13 + k * 2) * 0.12 + Math.sin(t * 7.3 + k) * 0.08
      g.scale.set(1, fl, 1)
      const light = g.children.find((c) => (c as THREE.PointLight).isPointLight) as THREE.PointLight | undefined
      if (light) light.intensity = 10 * fl
    })
  })
  return (
    <>
      {BRAZIERS.map(([x, z], k) => (
        <group key={k} position={[x, 0, z]}>
          <mesh castShadow position={[0, 0.5, 0]} material={toon('#2e2a40')}>
            <cylinderGeometry args={[0.18, 0.35, 1, 8]} />
            <Outlines thickness={0.03} color="#120b1a" />
          </mesh>
          <mesh position={[0, 1.08, 0]} material={toon('#5b4f7a')}>
            <cylinderGeometry args={[0.55, 0.3, 0.3, 12]} />
            <Outlines thickness={0.03} color="#120b1a" />
          </mesh>
          <group ref={(g) => { flames.current[k] = g }} position={[0, 1.25, 0]}>
            <mesh position={[0, 0.35, 0]} material={glow('#7c5cff', 2.6)}><coneGeometry args={[0.38, 0.9, 10]} /></mesh>
            <mesh position={[0, 0.3, 0]} material={glow('#d6c4ff', 3.5)}><coneGeometry args={[0.2, 0.55, 10]} /></mesh>
            {k % 2 === 0 && <pointLight position={[0, 0.6, 0]} color="#9b7bff" intensity={10} distance={10} decay={1.6} />}
          </group>
        </group>
      ))}
    </>
  )
}

const DOORS: [number, number][] = [[-12.5, -4.0], [12.5, -4.0], [-9.0, 10.0]]

function CryptDoors() {
  return (
    <>
      {DOORS.map(([x, z], k) => {
        const a = Math.atan2(x, z)
        const r = R + 0.4
        return (
          <group key={k} position={[Math.sin(a) * r, 0, Math.cos(a) * r]} rotation={[0, a + Math.PI, 0]}>
            {[-1, 1].map((s) => (
              <mesh key={s} castShadow position={[1.2 * s, 1.5, 0]} material={toon('#3d3756')}>
                <boxGeometry args={[0.5, 3, 0.6]} />
                <Outlines thickness={0.03} color="#120b1a" />
              </mesh>
            ))}
            <mesh position={[0, 3.1, 0]} material={toon('#3d3756')}>
              <boxGeometry args={[3, 0.5, 0.7]} />
              <Outlines thickness={0.03} color="#120b1a" />
            </mesh>
            <mesh position={[0, 1.45, -0.05]}>
              <planeGeometry args={[1.9, 2.9]} />
              <meshBasicMaterial color="#07140b" />
            </mesh>
            <mesh position={[0, 0.9, 0.02]}>
              <planeGeometry args={[1.9, 1.8]} />
              <meshBasicMaterial map={softCircleTexture()} color={[0.3, 1.4, 0.4]} toneMapped={false} transparent opacity={0.5} depthWrite={false} />
            </mesh>
            <mesh position={[0, 3.1, 0.38]} material={toon('#d9d0b8')}><sphereGeometry args={[0.22, 12, 10]} /></mesh>
          </group>
        )
      })}
    </>
  )
}

/** Dormant skeleton statues watching from alcoves — decorative NPCs. */
function Sentinels() {
  const spots = useMemo(() => [-0.75, -0.42, 0.42, 0.75, 2.3, -2.3].map((a) => a + Math.PI), [])
  return (
    <>
      {spots.map((a, k) => <Sentinel key={k} angle={a} />)}
    </>
  )
}

function Sentinel({ angle }: { angle: number }) {
  const rig = useRig()
  const r = R + 3.2
  return (
    <group position={[Math.sin(angle) * r, 0.6, Math.cos(angle) * r]} rotation={[0, angle + Math.PI, 0]}>
      <mesh position={[0, -0.3, 0]} material={toon('#3a3552')}><boxGeometry args={[1.4, 0.6, 1.4]} /></mesh>
      <group scale={1.6}><SkeletonModel rig={rig} stone /></group>
    </group>
  )
}

/** Cute little ghosts drifting around the edge of the crypt. */
function LostSouls() {
  const refs = useRef<(THREE.Group | null)[]>([])
  const souls = useMemo(() => [0, 1, 2, 3, 4].map((k) => ({ phase: k * 1.3, r: 18 + (k % 2) * 1.5, h: 2.5 + (k % 3) * 0.8, speed: 0.08 + k * 0.015 })), [])
  useFrame(() => {
    const t = (frameState()?.t ?? 0) / 1000
    souls.forEach((s, k) => {
      const g = refs.current[k]
      if (!g) return
      const a = s.phase + t * s.speed
      g.position.set(Math.sin(a) * s.r, s.h + Math.sin(t * 1.5 + k) * 0.3, Math.cos(a) * s.r)
      g.rotation.y = a + Math.PI / 2
    })
  })
  const body = useMemo(() => new THREE.MeshBasicMaterial({ color: '#c9f2ff', transparent: true, opacity: 0.55, depthWrite: false }), [])
  return (
    <>
      {souls.map((_, k) => (
        <group key={k} ref={(g) => { refs.current[k] = g }}>
          <mesh material={body}><sphereGeometry args={[0.4, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55]} /></mesh>
          <mesh material={body} position={[0, -0.35, 0]}><coneGeometry args={[0.4, 0.8, 16, 1, true]} /></mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.13 * s, 0.05, 0.34]}><sphereGeometry args={[0.05, 8, 6]} /><meshBasicMaterial color="#1b2a44" /></mesh>
          ))}
          <mesh position={[0, 0, 0]} scale={2}>
            <planeGeometry />
            <meshBasicMaterial map={softCircleTexture()} color={[0.6, 1.4, 2]} transparent opacity={0.25} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  )
}

function Candles() {
  const spots = useMemo(() => {
    const out: [number, number][] = []
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + 0.2
      out.push([Math.sin(a) * (R - 0.55), Math.cos(a) * (R - 0.55)])
    }
    return out
  }, [])
  return (
    <>
      {spots.map(([x, z], k) => (
        <group key={k} position={[x, 0, z]}>
          {[0, 1, 2].map((c) => (
            <group key={c} position={[(c - 1) * 0.18, 0, (c % 2) * 0.15]}>
              <mesh position={[0, 0.12 + c * 0.04, 0]} material={toon('#efe6cf')}><cylinderGeometry args={[0.05, 0.05, 0.24 + c * 0.08, 8]} /></mesh>
              <mesh position={[0, 0.3 + c * 0.08, 0]} material={glow('#ffd27a', 3)}><sphereGeometry args={[0.035, 6, 6]} /></mesh>
            </group>
          ))}
        </group>
      ))}
    </>
  )
}

/**
 * Floating magical dust. (We avoid drei's <Sparkles>: its shader divides by
 * the distance to the sprite centre, which can produce Infinity and, through
 * the bloom blur, black out the whole frame.)  Driven by replay time, so it
 * is deterministic like everything else.
 */
function Motes({ count, spread, center, color, size, seed }: {
  count: number; spread: [number, number, number]; center: [number, number, number]; color: string; size: number; seed: number
}) {
  const ref = useRef<THREE.Points>(null)
  const { geo, base } = useMemo(() => {
    let s = seed * 9301
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const base = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) {
      base[i * 4] = (rnd() - 0.5) * spread[0]
      base[i * 4 + 1] = (rnd() - 0.5) * spread[1]
      base[i * 4 + 2] = (rnd() - 0.5) * spread[2]
      base[i * 4 + 3] = rnd() * Math.PI * 2
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    return { geo, base }
  }, [count, spread, seed])
  const mat = useMemo(() => new THREE.PointsMaterial({
    map: softCircleTexture(), color: new THREE.Color(color).multiplyScalar(2), size, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), [color, size])
  useFrame(() => {
    const t = (frameState()?.t ?? 0) / 1000
    const pos = geo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < count; i++) {
      const ph = base[i * 4 + 3]
      const y = ((base[i * 4 + 1] / spread[1] + 0.5 + t * 0.03 + ph) % 1) - 0.5
      pos.setXYZ(i, center[0] + base[i * 4] + Math.sin(t * 0.5 + ph) * 0.4, center[1] + y * spread[1], center[2] + base[i * 4 + 2] + Math.cos(t * 0.4 + ph) * 0.4)
    }
    pos.needsUpdate = true
  })
  return <points ref={ref} geometry={geo} material={mat} />
}
