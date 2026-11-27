/**
 * Procedural characters built from primitives: the fallback art, shown while
 * the KayKit models load, when they are missing, and with ?art=procedural.
 *
 * Each rig exposes named joints (arms, legs, head...) and an `animate`
 * function that poses them from a `Pose`.
 */
import { Outlines } from '@react-three/drei'
import { useRef } from 'react'
import * as THREE from 'three'
import { SCHOOL_COLORS } from '../content/display'
import { glow, toon } from './materials'
import { easeOut, type Pose } from './pose'

const OUTLINE = '#120b1a'

type MeshProps = JSX.IntrinsicElements['mesh']
function Part({ mat, outline = 0.03, children, ...p }: MeshProps & { mat: THREE.Material; outline?: number | false }) {
  return (
    <mesh castShadow material={mat} {...p}>
      {children}
      {outline !== false && <Outlines thickness={outline} color={OUTLINE} />}
    </mesh>
  )
}

export interface RigRefs {
  bob: React.RefObject<THREE.Group>
  armL: React.RefObject<THREE.Group>
  armR: React.RefObject<THREE.Group>
  legL: React.RefObject<THREE.Group>
  legR: React.RefObject<THREE.Group>
  head: React.RefObject<THREE.Group>
  fx: React.RefObject<THREE.Group> // things that glow while casting
}

export function useRig(): RigRefs {
  return {
    bob: useRef<THREE.Group>(null), armL: useRef<THREE.Group>(null), armR: useRef<THREE.Group>(null),
    legL: useRef<THREE.Group>(null), legR: useRef<THREE.Group>(null), head: useRef<THREE.Group>(null),
    fx: useRef<THREE.Group>(null),
  }
}

const lerp = THREE.MathUtils.lerp

/** Pose a humanoid rig. `style` tweaks attacks per weapon type. */
export function animateHumanoid(r: RigRefs, p: Pose, style: 'melee' | 'caster' | 'archer' | 'dual') {
  const bob = r.bob.current, aL = r.armL.current, aR = r.armR.current
  const lL = r.legL.current, lR = r.legR.current, head = r.head.current
  if (!bob || !aL || !aR || !lL || !lR || !head) return
  const t = p.t / 1000
  // reset
  bob.position.set(0, 0, 0)
  bob.rotation.set(0, 0, 0)
  bob.scale.setScalar(1)
  aL.rotation.set(0, 0, 0.12)
  aR.rotation.set(0, 0, -0.12)
  lL.rotation.set(0, 0, 0)
  lR.rotation.set(0, 0, 0)
  head.rotation.set(0, 0, 0)
  const breathe = Math.sin(t * 2.4)
  switch (p.mode) {
    case 'idle':
      bob.position.y = breathe * 0.015
      bob.scale.y = 1 + breathe * 0.015
      aL.rotation.z = 0.14 + breathe * 0.04
      aR.rotation.z = -0.14 - breathe * 0.04
      head.rotation.z = Math.sin(t * 0.9) * 0.05
      if (style === 'melee' || style === 'dual') { aR.rotation.x = -0.5; aL.rotation.x = style === 'dual' ? -0.5 : -0.3 }
      break
    case 'walk': {
      const ph = t * 11
      lL.rotation.x = Math.sin(ph) * 0.75
      lR.rotation.x = -Math.sin(ph) * 0.75
      aL.rotation.x = -Math.sin(ph) * 0.6
      aR.rotation.x = Math.sin(ph) * 0.6 - 0.3
      bob.position.y = Math.abs(Math.sin(ph)) * 0.09
      bob.rotation.x = 0.08
      break
    }
    case 'attack': {
      const k = p.k
      // windup (0-0.3) -> strike (0.3-0.55) -> recover
      const swing = k < 0.3 ? lerp(-0.5, -2.7, easeOut(k / 0.3))
        : k < 0.55 ? lerp(-2.7, -0.2, easeOut((k - 0.3) / 0.25))
          : lerp(-0.2, -0.5, (k - 0.55) / 0.45)
      aR.rotation.x = swing
      if (style === 'dual') aL.rotation.x = k < 0.5 ? lerp(-0.5, -1.8, k * 2) : lerp(-1.8, -0.5, (k - 0.5) * 2)
      bob.rotation.x = k > 0.3 && k < 0.6 ? 0.18 : 0.04
      bob.position.z = k > 0.3 && k < 0.6 ? 0.12 : 0
      lL.rotation.x = -0.3
      lR.rotation.x = 0.3
      break
    }
    case 'shoot': {
      const k = p.k
      aL.rotation.x = -1.5
      aR.rotation.x = -1.5
      aR.rotation.y = k < 0.25 ? 0 : 0.4 // release
      bob.rotation.x = k < 0.25 ? -0.05 : 0.02
      break
    }
    case 'cast': {
      const k = p.k
      if (style === 'archer') {
        aL.rotation.x = -1.5
        aR.rotation.x = -1.45
        aR.rotation.y = -0.5 * k // drawing the string back
        bob.rotation.x = -0.04
      } else {
        const wob = Math.sin(t * 9) * 0.08
        aL.rotation.x = -2.1 + wob
        aR.rotation.x = -2.1 - wob
        aL.rotation.z = 0.5
        aR.rotation.z = -0.5
        bob.position.y = 0.05 + k * 0.06
        head.rotation.x = -0.2
      }
      break
    }
    case 'dead': {
      const k = easeOut(p.k)
      bob.rotation.x = -Math.PI / 2 * k
      bob.position.y = 0.32 * k
      bob.position.z = -0.4 * k
      aL.rotation.z = 1.2 * k
      aR.rotation.z = -1.2 * k
      break
    }
  }
  if (p.hit > 0 && p.mode !== 'dead') {
    bob.rotation.x -= p.hit * 0.18
    bob.position.z -= p.hit * 0.06
  }
}

// ---------------------------------------------------------------------------
// Party members
// ---------------------------------------------------------------------------

interface Look { skin: string; body: string; trim: string; hair: string; boots: string }
const LOOKS: Record<string, Look> = {
  guardian: { skin: '#ffd9b8', body: '#4a78d0', trim: '#ffd27a', hair: '#7a4a2a', boots: '#3a2a22' },
  lightweaver: { skin: '#ffe1c8', body: '#f5efff', trim: '#ffc94d', hair: '#ff9fd0', boots: '#c9a35a' },
  berserker: { skin: '#f0b28a', body: '#8c3a26', trim: '#d9a35a', hair: '#e0582c', boots: '#3a2416' },
  shadowblade: { skin: '#ecc6a8', body: '#3d2b61', trim: '#c68bff', hair: '#271c3d', boots: '#1b1426' },
  ranger: { skin: '#ffd5b0', body: '#3f7d48', trim: '#b2e48c', hair: '#6d4527', boots: '#43301e' },
}

function Face({ look }: { look: Look }) {
  const eye = toon('#1a1020')
  return (
    <group>
      <Part mat={toon(look.skin)} outline={0.025}><sphereGeometry args={[0.42, 28, 20]} /></Part>
      {[-1, 1].map((s) => (
        <group key={s} position={[0.15 * s, -0.02, 0.36]}>
          <mesh material={eye} scale={[1, 1.35, 0.55]}><sphereGeometry args={[0.065, 14, 10]} /></mesh>
          <mesh material={glow('#ffffff', 1.2)} position={[0.02, 0.035, 0.035]}><sphereGeometry args={[0.02, 8, 6]} /></mesh>
          <mesh material={toon('#ff9db0')} position={[0.1 * s, -0.12, -0.03]} scale={[1, 0.6, 0.3]}><sphereGeometry args={[0.06, 10, 8]} /></mesh>
        </group>
      ))}
      <mesh material={eye} position={[0, -0.14, 0.38]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.04, 0.012, 6, 12, Math.PI]} />
      </mesh>
    </group>
  )
}

function Headgear({ cls, look }: { cls: string; look: Look }) {
  const cap = (color: string, r = 0.455, cut = 0.56) => (
    <Part mat={toon(color)} outline={0.02}>
      <sphereGeometry args={[r, 28, 16, 0, Math.PI * 2, 0, Math.PI * cut]} />
    </Part>
  )
  switch (cls) {
    case 'guardian':
      return (
        <group>
          {cap('#b9c6dc', 0.47, 0.5)}
          <Part mat={toon(look.trim)} position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} outline={false}>
            <torusGeometry args={[0.455, 0.035, 8, 32]} />
          </Part>
          <Part mat={toon('#e2463e')} position={[0, 0.52, -0.06]} scale={[0.5, 1, 1.4]}><sphereGeometry args={[0.16, 14, 10]} /></Part>
        </group>
      )
    case 'lightweaver':
      return (
        <group>
          {cap(look.hair, 0.46, 0.62)}
          <Part mat={toon(look.hair)} position={[0, 0.15, -0.38]}><sphereGeometry args={[0.17, 14, 10]} /></Part>
          <mesh material={glow('#ffd86b', 3)} position={[0, 0.66, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.24, 0.025, 8, 32]} />
          </mesh>
        </group>
      )
    case 'berserker':
      return (
        <group>
          {cap('#6b5a4a', 0.46, 0.45)}
          {[-1, 1].map((s) => (
            <Part key={s} mat={toon('#f3ead2')} position={[0.4 * s, 0.32, 0]} rotation={[0, 0, -0.9 * s]}>
              <coneGeometry args={[0.08, 0.38, 10]} />
            </Part>
          ))}
          <Part mat={toon(look.hair)} position={[0, -0.3, 0.18]} scale={[1.1, 0.8, 0.8]}><sphereGeometry args={[0.28, 16, 12]} /></Part>
        </group>
      )
    case 'shadowblade':
      return (
        <group>
          {cap(look.body, 0.49, 0.64)}
          <Part mat={toon(look.body)} position={[0, 0.3, -0.35]} rotation={[-0.9, 0, 0]}><coneGeometry args={[0.18, 0.45, 12]} /></Part>
          <Part mat={toon('#1d1530')} position={[0, -0.24, 0.12]} scale={[1, 0.55, 0.9]} outline={0.015}><sphereGeometry args={[0.36, 18, 12]} /></Part>
        </group>
      )
    case 'ranger':
      return (
        <group>
          {cap(look.body, 0.48, 0.6)}
          <Part mat={toon(look.body)} position={[0, 0.25, -0.38]} rotation={[-1.1, 0, 0]}><coneGeometry args={[0.16, 0.4, 12]} /></Part>
          <Part mat={toon('#e8c547')} position={[0.32, 0.38, -0.05]} rotation={[0.2, 0, -0.6]} scale={[0.35, 1, 0.15]}><sphereGeometry args={[0.18, 10, 8]} /></Part>
        </group>
      )
    default:
      return null
  }
}

function Weapon({ cls, look }: { cls: string; look: Look }) {
  const steel = toon('#dfe7f2')
  const wood = toon('#8b5a33')
  switch (cls) {
    case 'guardian':
      return (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <Part mat={steel} position={[0, 0.42, 0]}><boxGeometry args={[0.08, 0.62, 0.03]} /></Part>
          <Part mat={toon(look.trim)} position={[0, 0.1, 0]}><boxGeometry args={[0.26, 0.05, 0.06]} /></Part>
          <Part mat={wood} position={[0, 0, 0]}><cylinderGeometry args={[0.03, 0.03, 0.16, 8]} /></Part>
        </group>
      )
    case 'lightweaver':
      return (
        <group>
          <Part mat={toon('#f4e4c1')} position={[0, 0.15, 0.04]}><cylinderGeometry args={[0.028, 0.032, 1.25, 8]} /></Part>
          <mesh material={glow(SCHOOL_COLORS.holy, 3.5)} position={[0, 0.82, 0.04]}><icosahedronGeometry args={[0.11, 1]} /></mesh>
          <Part mat={toon(look.trim)} position={[0, 0.72, 0.04]} rotation={[Math.PI / 2, 0, 0]} outline={false}><torusGeometry args={[0.1, 0.02, 6, 16]} /></Part>
        </group>
      )
    case 'berserker':
      return (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <Part mat={wood} position={[0, 0.25, 0]}><cylinderGeometry args={[0.035, 0.035, 0.8, 8]} /></Part>
          <Part mat={steel} position={[0.13, 0.55, 0]} scale={[1, 1, 0.25]}><cylinderGeometry args={[0.22, 0.22, 0.12, 16, 1, false, 0, Math.PI]} /></Part>
        </group>
      )
    case 'shadowblade':
      return (
        <group rotation={[Math.PI / 2, 0, 0]}>
          <Part mat={glow('#d9b8ff', 1.4)} position={[0, 0.2, 0]}><coneGeometry args={[0.045, 0.36, 4]} /></Part>
          <Part mat={toon('#2a1d3d')} position={[0, 0, 0]}><cylinderGeometry args={[0.025, 0.025, 0.1, 6]} /></Part>
        </group>
      )
    default:
      return null
  }
}

function OffHand({ cls }: { cls: string }) {
  switch (cls) {
    case 'guardian':
      return (
        <group position={[-0.06, 0, 0.12]} rotation={[0, 0, 0]}>
          <Part mat={toon('#3b64b8')} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.32, 0.32, 0.06, 24]} /></Part>
          <mesh material={toon('#ffd27a')} position={[0, 0, 0.035]}><torusGeometry args={[0.3, 0.03, 8, 28]} /></mesh>
          <mesh material={glow('#ffe7a0', 1.6)} position={[0, 0, 0.04]}><circleGeometry args={[0.1, 5]} /></mesh>
        </group>
      )
    case 'shadowblade':
      return <Weapon cls="shadowblade" look={LOOKS.shadowblade} />
    case 'ranger':
      return (
        <group position={[0, 0, 0.05]} rotation={[0, Math.PI / 2, 0]}>
          <Part mat={toon('#9a6a3c')} rotation={[0, 0, -Math.PI / 2]}><torusGeometry args={[0.45, 0.035, 8, 24, Math.PI]} /></Part>
          <mesh material={glow('#fff8e0', 1)} position={[0, 0, 0]}><boxGeometry args={[0.006, 0.9, 0.006]} /></mesh>
        </group>
      )
    default:
      return null
  }
}

export function ChibiModel({ cls, rig }: { cls: string; rig: RigRefs }) {
  const look = LOOKS[cls] ?? LOOKS.guardian
  const robe = cls === 'lightweaver'
  return (
    <group ref={rig.bob}>
      {/* legs */}
      {([[-1, rig.legL], [1, rig.legR]] as const).map(([s, ref]) => (
        <group key={s} ref={ref} position={[0.12 * s, 0.34, 0]}>
          <Part mat={toon(look.body)} position={[0, -0.12, 0]}><capsuleGeometry args={[0.085, 0.12, 4, 10]} /></Part>
          <Part mat={toon(look.boots)} position={[0, -0.27, 0.04]} scale={[1, 0.7, 1.3]}><sphereGeometry args={[0.1, 12, 8]} /></Part>
        </group>
      ))}
      {/* body */}
      {robe ? (
        <Part mat={toon(look.body)} position={[0, 0.42, 0]}><cylinderGeometry args={[0.2, 0.42, 0.7, 20]} /></Part>
      ) : (
        <Part mat={toon(look.body)} position={[0, 0.55, 0]}><cylinderGeometry args={[0.25, 0.31, 0.48, 20]} /></Part>
      )}
      <Part mat={toon(look.trim)} position={[0, robe ? 0.2 : 0.36, 0]} rotation={[Math.PI / 2, 0, 0]} outline={false}>
        <torusGeometry args={[robe ? 0.36 : 0.3, 0.04, 8, 24]} />
      </Part>
      {cls === 'ranger' && (
        <group position={[0.12, 0.72, -0.28]} rotation={[0.3, 0, -0.4]}>
          <Part mat={toon('#7b4f2c')}><cylinderGeometry args={[0.09, 0.08, 0.5, 10]} /></Part>
          {[-0.04, 0.04].map((x) => (
            <mesh key={x} material={toon('#f4f0e6')} position={[x, 0.3, 0]}><coneGeometry args={[0.03, 0.12, 4]} /></mesh>
          ))}
        </group>
      )}
      {/* arms */}
      <group ref={rig.armL} position={[-0.31, 0.74, 0]}>
        <Part mat={toon(look.body)} position={[0, -0.16, 0]}><capsuleGeometry args={[0.08, 0.18, 4, 10]} /></Part>
        <Part mat={toon(look.skin)} position={[0, -0.33, 0]}><sphereGeometry args={[0.085, 12, 8]} /></Part>
        <group position={[0, -0.34, 0]}><OffHand cls={cls} /></group>
      </group>
      <group ref={rig.armR} position={[0.31, 0.74, 0]}>
        <Part mat={toon(look.body)} position={[0, -0.16, 0]}><capsuleGeometry args={[0.08, 0.18, 4, 10]} /></Part>
        <Part mat={toon(look.skin)} position={[0, -0.33, 0]}><sphereGeometry args={[0.085, 12, 8]} /></Part>
        <group position={[0, -0.34, 0]}><Weapon cls={cls} look={look} /></group>
      </group>
      {/* head */}
      <group ref={rig.head} position={[0, 1.12, 0]}>
        <Face look={look} />
        <Headgear cls={cls} look={look} />
      </group>
    </group>
  )
}

export const CLASS_STYLE: Record<string, 'melee' | 'caster' | 'archer' | 'dual'> = {
  guardian: 'melee', lightweaver: 'caster', berserker: 'melee', shadowblade: 'dual', ranger: 'archer',
}

// ---------------------------------------------------------------------------
// Oruth the Unburied
// ---------------------------------------------------------------------------

/** The orb in Oruth's hand before his first cast recolours it (Units.tsx). */
const ORB = '#c77dff'

export function BossModel({ rig }: { rig: RigRefs }) {
  const armor = toon('#3a4562')
  const plate = toon('#56658a')
  const bone = toon('#ece5d0')
  const robe = toon('#1b2140')
  const ice = glow('#8fe8ff', 1.6)
  return (
    <group ref={rig.bob}>
      {/* ghostly base */}
      <Part mat={robe} position={[0, 0.55, 0]}><cylinderGeometry args={[0.36, 0.7, 1.1, 24, 1, true]} /></Part>
      <mesh material={ice} position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.69, 0.03, 8, 36]} /></mesh>
      <Part mat={toon('#3b1e4f')} position={[0, 0.95, -0.28]} rotation={[0.18, 0, 0]} scale={[1.25, 1, 0.35]}>
        <cylinderGeometry args={[0.4, 0.62, 1.4, 20, 1, true, Math.PI * 0.15, Math.PI * 0.7]} />
      </Part>
      {/* torso */}
      <Part mat={armor} position={[0, 1.15, 0]} scale={[1.1, 1, 0.85]}><sphereGeometry args={[0.38, 22, 16]} /></Part>
      <mesh material={ice} position={[0, 1.18, 0.31]}><octahedronGeometry args={[0.07, 0]} /></mesh>
      {/* pauldrons */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0.42 * s, 1.36, 0]}>
          <Part mat={plate}><sphereGeometry args={[0.22, 16, 12]} /></Part>
          {[0, 1, 2].map((k) => (
            <Part key={k} mat={bone} position={[0.05 * s, 0.16, (k - 1) * 0.12]} rotation={[0, 0, -0.4 * s]}>
              <coneGeometry args={[0.045, 0.26, 8]} />
            </Part>
          ))}
        </group>
      ))}
      {/* skull */}
      <group ref={rig.head} position={[0, 1.72, 0.02]}>
        <Part mat={bone}><sphereGeometry args={[0.3, 24, 18]} /></Part>
        <Part mat={bone} position={[0, -0.2, 0.08]} scale={[0.8, 0.5, 0.8]}><boxGeometry args={[0.36, 0.2, 0.3]} /></Part>
        {[-1, 1].map((s) => (
          <group key={s} position={[0.11 * s, 0.01, 0.24]}>
            <mesh material={toon('#0a0612')} scale={[1, 1.1, 0.6]}><sphereGeometry args={[0.075, 12, 10]} /></mesh>
            <mesh material={glow('#7ff3ff', 4)} position={[0, 0, 0.04]}><sphereGeometry args={[0.03, 8, 6]} /></mesh>
          </group>
        ))}
        {/* the Hollow Crown */}
        <group position={[0, 0.22, 0]}>
          <mesh material={toon('#7fb8d6', '#3fa8d8', 0.6)} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.25, 0.045, 8, 28]} /></mesh>
          {Array.from({ length: 7 }, (_, k) => {
            const a = (k / 7) * Math.PI * 2
            const tall = k === 0 ? 0.36 : 0.22
            return (
              <mesh key={k} material={k === 0 ? glow('#bdf3ff', 2) : toon('#a6dcf0', '#4fb6e0', 0.5)} position={[Math.sin(a) * 0.25, tall / 2, Math.cos(a) * 0.25]}>
                <coneGeometry args={[0.04, tall, 6]} />
              </mesh>
            )
          })}
        </group>
      </group>
      {/* right arm + runeblade */}
      <group ref={rig.armR} position={[0.55, 1.28, 0]}>
        <Part mat={armor} position={[0, -0.22, 0]}><capsuleGeometry args={[0.1, 0.3, 4, 10]} /></Part>
        <Part mat={plate} position={[0, -0.45, 0]}><sphereGeometry args={[0.13, 12, 8]} /></Part>
        <group position={[0, -0.47, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <Part mat={toon('#26304a')} position={[0, 0, 0]}><cylinderGeometry args={[0.035, 0.035, 0.3, 8]} /></Part>
          <Part mat={bone} position={[0, 0.17, 0]} scale={[1, 0.5, 0.6]}><sphereGeometry args={[0.12, 12, 8]} /></Part>
          <mesh material={glow('#8fe8ff', 1.25)} position={[0, 0.95, 0]}><boxGeometry args={[0.12, 1.45, 0.03]} /></mesh>
          <Part mat={toon('#c9f4ff')} position={[0, 0.95, 0]} outline={0.015}><boxGeometry args={[0.07, 1.4, 0.045]} /></Part>
        </group>
      </group>
      {/* left arm + casting orb */}
      <group ref={rig.armL} position={[-0.55, 1.28, 0]}>
        <Part mat={armor} position={[0, -0.22, 0]}><capsuleGeometry args={[0.1, 0.3, 4, 10]} /></Part>
        <Part mat={plate} position={[0, -0.45, 0]}><sphereGeometry args={[0.13, 12, 8]} /></Part>
        <group ref={rig.fx} position={[0, -0.7, 0]}>
          <mesh material={glow(ORB, 4)}><icosahedronGeometry args={[0.16, 1]} /></mesh>
          <pointLight color={ORB} intensity={6} distance={9} />
        </group>
      </group>
    </group>
  )
}

export function animateBoss(r: RigRefs, p: Pose) {
  const bob = r.bob.current, aL = r.armL.current, aR = r.armR.current, head = r.head.current
  if (!bob || !aL || !aR || !head) return
  const t = p.t / 1000
  bob.position.set(0, 0.25 + Math.sin(t * 1.6) * 0.06, 0)
  bob.rotation.set(0, 0, 0)
  aL.rotation.set(0, 0, 0.25)
  aR.rotation.set(-0.35, 0, -0.25)
  head.rotation.set(0, 0, 0)
  switch (p.mode) {
    case 'idle':
    case 'walk':
      aL.rotation.x = Math.sin(t * 1.6) * 0.06
      head.rotation.z = Math.sin(t * 0.7) * 0.06
      break
    case 'cast': {
      const both = p.ability === 'requiem_of_bones' || p.ability === 'raise_dead'
      aL.rotation.x = -2.4 - Math.sin(t * 8) * 0.06
      aL.rotation.z = 0.35
      if (both) { aR.rotation.x = -2.3; aR.rotation.z = -0.5 }
      head.rotation.x = -0.25
      bob.position.y += p.k * 0.25
      break
    }
    case 'attack': {
      const k = p.k
      aR.rotation.x = k < 0.35 ? lerp(-0.35, -2.8, easeOut(k / 0.35)) : lerp(-2.8, -0.1, easeOut(Math.min(1, (k - 0.35) / 0.3)))
      bob.rotation.x = k > 0.35 && k < 0.7 ? 0.12 : 0
      break
    }
    case 'dead': {
      const k = easeOut(p.k)
      bob.position.y = 0.25 * (1 - k) - 0.2 * k
      bob.rotation.x = -0.9 * k
      bob.rotation.z = 0.25 * k
      aL.rotation.z = 0.25 + k
      aR.rotation.z = -0.25 - k
      head.rotation.x = 0.5 * k
      break
    }
  }
  const fx = r.fx.current
  if (fx) {
    fx.visible = p.mode === 'cast'
    fx.scale.setScalar(0.6 + p.k * 0.9 + Math.sin(t * 18) * 0.06)
  }
}

// ---------------------------------------------------------------------------
// Bonewalker (add) — also reused as dormant statue NPCs around the crypt
// ---------------------------------------------------------------------------

const RIBS = [0.62, 0.72, 0.82]

export function SkeletonModel({ rig, stone = false }: { rig: RigRefs; stone?: boolean }) {
  const bone = toon(stone ? '#6f6a80' : '#efe8d4')
  const dark = toon(stone ? '#4b4660' : '#4a3b2e')
  const eyes = glow(stone ? '#a07bff' : '#9dff6b', 3.5)
  return (
    <group ref={rig.bob}>
      {([[-1, rig.legL], [1, rig.legR]] as const).map(([s, ref]) => (
        <group key={s} ref={ref} position={[0.11 * s, 0.4, 0]}>
          <Part mat={bone} position={[0, -0.18, 0]} outline={0.02}><cylinderGeometry args={[0.035, 0.035, 0.36, 6]} /></Part>
          <Part mat={bone} position={[0, -0.38, 0.05]} scale={[1, 0.6, 1.5]} outline={0.02}><sphereGeometry args={[0.06, 8, 6]} /></Part>
        </group>
      ))}
      <Part mat={bone} position={[0, 0.44, 0]} scale={[1.4, 0.6, 1]} outline={0.02}><sphereGeometry args={[0.11, 10, 8]} /></Part>
      <Part mat={bone} position={[0, 0.7, -0.02]} outline={false}><cylinderGeometry args={[0.03, 0.03, 0.5, 6]} /></Part>
      {RIBS.map((y, k) => (
        <Part key={y} mat={bone} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1 - k * 0.08, 0.8, 1]} outline={0.015}>
          <torusGeometry args={[0.17, 0.028, 6, 16]} />
        </Part>
      ))}
      <Part mat={dark} position={[0, 0.55, 0]} rotation={[0.15, 0, 0]} outline={0.02}><cylinderGeometry args={[0.2, 0.24, 0.16, 12, 1, true]} /></Part>
      {([[-1, rig.armL], [1, rig.armR]] as const).map(([s, ref]) => (
        <group key={s} ref={ref} position={[0.22 * s, 0.86, 0]}>
          <Part mat={bone} position={[0, -0.2, 0]} outline={0.02}><cylinderGeometry args={[0.03, 0.03, 0.4, 6]} /></Part>
          {[-1, 0, 1].map((f) => (
            <mesh key={f} material={bone} position={[f * 0.03, -0.44, 0.02]} rotation={[0.3, 0, 0]}><coneGeometry args={[0.015, 0.1, 4]} /></mesh>
          ))}
        </group>
      ))}
      <group ref={rig.head} position={[0, 1.13, 0.04]}>
        <Part mat={bone} outline={0.025}><sphereGeometry args={[0.25, 18, 14]} /></Part>
        <Part mat={bone} position={[0, -0.17, 0.07]} scale={[0.75, 0.5, 0.7]} outline={0.02}><boxGeometry args={[0.3, 0.16, 0.26]} /></Part>
        {[-1, 1].map((s) => (
          <group key={s} position={[0.09 * s, 0.0, 0.2]}>
            <mesh material={toon('#140c18')} scale={[1, 1.15, 0.6]}><sphereGeometry args={[0.065, 10, 8]} /></mesh>
            <mesh material={eyes} position={[0, 0, 0.035]}><sphereGeometry args={[0.026, 8, 6]} /></mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

export function animateSkeleton(r: RigRefs, p: Pose) {
  const bob = r.bob.current, aL = r.armL.current, aR = r.armR.current
  const lL = r.legL.current, lR = r.legR.current, head = r.head.current
  if (!bob || !aL || !aR || !lL || !lR || !head) return
  const t = p.t / 1000
  bob.position.set(0, 0, 0)
  bob.rotation.set(0.12, 0, 0) // hunched
  bob.scale.set(1, 1, 1)
  aL.rotation.set(-0.7, 0, 0.1)
  aR.rotation.set(-0.7, 0, -0.1)
  lL.rotation.set(0, 0, 0)
  lR.rotation.set(0, 0, 0)
  head.rotation.set(0, 0, Math.sin(t * 2.2) * 0.12)
  if (p.mode === 'walk') {
    const ph = t * 9
    lL.rotation.x = Math.sin(ph) * 0.7
    lR.rotation.x = -Math.sin(ph) * 0.7
    aL.rotation.x = -1.1 - Math.sin(ph) * 0.3
    aR.rotation.x = -1.1 + Math.sin(ph) * 0.3
    bob.position.y = Math.abs(Math.sin(ph)) * 0.07
  } else if (p.mode === 'attack') {
    const k = p.k
    aR.rotation.x = k < 0.4 ? lerp(-0.7, -2.4, k / 0.4) : lerp(-2.4, -0.4, Math.min(1, (k - 0.4) / 0.3))
    aL.rotation.x = k < 0.5 ? -0.7 : lerp(-0.7, -2.0, (k - 0.5) * 2)
  } else if (p.mode === 'dead') {
    // collapse into a sad little bone pile
    const k = easeOut(p.k)
    bob.scale.y = 1 - 0.75 * k
    bob.rotation.x = 0.12 + 0.5 * k
    head.position.y = 1.13 - 0.25 * k
  }
  if (p.mode !== 'dead') head.position.y = 1.13
  if (p.hit > 0 && p.mode !== 'dead') bob.rotation.x -= p.hit * 0.25
}

export function Bubble({ color, radius, opacity }: { color: string; radius: number; opacity: number }) {
  return (
    <mesh>
      <sphereGeometry args={[radius, 24, 16]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}
