import { useFrame } from '@react-three/fiber'
import { Suspense, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BOSS_CAST_COLORS, BOSS_CAST_DEFAULT, CLASS_COLORS, SCHOOL_COLORS } from '../content/display'
import { posAt, bossOf } from '../replay/engine'
import { frameState, usePlayback } from '../replay/store'
import {
  BossModel, Bubble, CLASS_STYLE, ChibiModel, SkeletonModel, animateBoss, animateHumanoid,
  animateSkeleton, useRig,
} from './avatars'
import { runeCircleTexture, softCircleTexture } from './materials'
import { BEAM_MS, HEAL_KINDS } from './Effects'
import { AssetBoundary, USE_KAYKIT } from './ErrorBoundary'
import { KayKitAvatar } from './kaykit/KayKitAvatar'
import { poseOf, walkAt } from './pose'

/** Mount one actor per unit that exists at the current time. */
export function Units() {
  // Re-render only when the roster changes (an add spawns or we scrub before it).
  const ids = usePlayback((p) => (p.engine ? p.engine.stateAt(p.t).order.join(',') : ''))
  const engine = usePlayback((p) => p.engine)
  if (!engine || !ids) return null
  return (
    <>
      {ids.split(',').map((id) => (
        <UnitActor key={`${engine.replay.meta.policy}:${id}`} id={id} />
      ))}
    </>
  )
}

function dampAngle(cur: number, target: number, lambda: number, dt: number) {
  let d = target - cur
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return cur + d * (1 - Math.exp(-lambda * dt))
}

function UnitActor({ id }: { id: string }) {
  const engine = usePlayback((p) => p.engine)!
  const info = useMemo(() => engine.stateAt(usePlayback.getState().t).units[id].info, [engine, id])
  const root = useRef<THREE.Group>(null)
  const turn = useRef<THREE.Group>(null)
  const circle = useRef<THREE.Mesh>(null)
  const auraRefs = {
    ironhide: useRef<THREE.Group>(null),
    lumen_ward: useRef<THREE.Group>(null),
    bloomward: useRef<THREE.Group>(null),
    wild_roar: useRef<THREE.Group>(null),
    rent_soul: useRef<THREE.Group>(null),
    haunted: useRef<THREE.Group>(null),
    hollow_fury: useRef<THREE.Group>(null),
    grave_mark: useRef<THREE.Group>(null),
  }
  const rig = useRig()
  const yaw = useRef(info.kind === 'player' ? Math.PI : 0)
  const isBoss = info.kind === 'boss'
  const isAdd = info.kind === 'add'
  const scale = isBoss ? 2.6 : isAdd ? 1.3 : 1.35
  const circleMat = useMemo(() => new THREE.MeshBasicMaterial({
    map: runeCircleTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9,
  }), [])
  const ringColor = CLASS_COLORS[info.class] ?? '#ffffff'

  useFrame((_, dt) => {
    const f = frameState()
    if (!f || !root.current || !turn.current) return
    const { s, t } = f
    const u = s.units[id]
    if (!u) return
    const p = posAt(u, t)
    root.current.position.set(p[0], 0, p[1])

    // Facing: walk direction, else current target. Shuffles (tiny repositioning
    // moves) slide the unit without turning it away from its target.
    let desired = yaw.current
    const m = u.move
    const walking = !!m && !!walkAt(u, t, engine.replay)
    if (walking && m && Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]) > 1e-3) {
      desired = Math.atan2(m.to[0] - m.from[0], m.to[1] - m.from[1])
    } else if (u.alive && !walking) {
      // Casting on someone (a heal on an ally included), or a heal that just
      // landed (its beam is still showing): face them, so the beam leaves her front.
      const la = u.lastAction
      const healKind = la ? engine.replay.abilities[la.ability]?.kind : undefined
      const healing = la && la.target && la.target !== id && t - la.t < BEAM_MS && HEAL_KINDS.has(healKind ?? '')
      // The heal that just landed wins until its beam fades, then the next cast's target.
      const tid = (healing ? la!.target : null) ?? u.cast?.target ?? u.target
      const tgt = tid ? s.units[tid] : undefined
      // Otherwise a player whose target is an ally (or nobody) watches the boss.
      const aimed = !!u.cast?.target || !!healing
      const enemyFacing = info.kind === 'player' && !aimed && (!tgt || tgt.info.kind === 'player') && bossOf(s)
      const look = enemyFacing ? bossOf(s) : tgt
      if (look && look !== u) {
        const tp = posAt(look, t)
        desired = Math.atan2(tp[0] - p[0], tp[1] - p[1])
      }
    }
    yaw.current = dampAngle(yaw.current, desired, 9, Math.min(dt, 0.1))
    turn.current.rotation.y = yaw.current

    const pose = poseOf(u, t, engine.replay)
    if (isBoss) {
      animateBoss(rig, pose)
      const orb = rig.fx.current
      if (orb && u.cast) {
        const c = BOSS_CAST_COLORS[u.cast.ability] ?? BOSS_CAST_DEFAULT
        const m = orb.children[0] as THREE.Mesh
        ;(m.material as THREE.MeshBasicMaterial).color.set(c).multiplyScalar(4)
        ;(orb.children[1] as THREE.PointLight).color.set(c)
      }
    } else if (isAdd) animateSkeleton(rig, pose)
    else animateHumanoid(rig, pose, CLASS_STYLE[info.class] ?? 'melee')

    // Spell circle at the caster's feet
    if (circle.current) {
      const casting = !!u.cast && u.alive
      circle.current.visible = casting
      if (casting) {
        const ab = engine.replay.abilities[u.cast!.ability]
        const col = isBoss ? BOSS_CAST_COLORS[u.cast!.ability] ?? BOSS_CAST_DEFAULT : SCHOOL_COLORS[ab?.school ?? 'holy']
        circleMat.color.set(col).multiplyScalar(2.2)
        const base = isBoss ? 4.4 : 1.5
        circle.current.scale.setScalar(base * (0.75 + 0.25 * Math.min(1, pose.k * 3)))
        circle.current.rotation.z = t / 1000 * (isBoss ? 0.6 : 1.5)
      }
    }
    // Aura visuals
    for (const [aid, ref] of Object.entries(auraRefs)) {
      const g = ref.current
      if (!g) continue
      const on = u.alive && (aid === 'lumen_ward' ? u.absorb > 0 : !!u.auras[aid])
      g.visible = on
      if (on && aid === 'grave_mark') {
        // The blast radius, tightening as the detonation nears.
        const a = u.auras.grave_mark
        const left = Math.max(0, a.t0 + a.dur - t) / a.dur
        g.scale.setScalar(1)
        g.children.forEach((c, i) => {
          const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial
          m.opacity = i === 0 ? 0.12 + 0.18 * (1 - left) : 0.55 + 0.4 * Math.abs(Math.sin(t / (120 + 280 * left)))
        })
      } else if (on) {
        g.rotation.y = t / 1000 * 1.2
        const pulse = 1 + Math.sin(t / 160) * 0.03
        g.scale.setScalar(pulse)
      }
    }
  })

  const procedural = (
    <group scale={scale}>
      {isBoss ? <BossModel rig={rig} />
        : isAdd ? <SkeletonModel rig={rig} />
          : <ChibiModel cls={info.class} rig={rig} />}
    </group>
  )

  return (
    <group ref={root}>
      {/* soft blob shadow + class ring for readability */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} scale={info.radius * 2.6 * (isBoss ? 1.2 : 1)}>
        <planeGeometry />
        <meshBasicMaterial map={softCircleTexture()} color="#000" transparent opacity={0.45} depthWrite={false} />
      </mesh>
      {info.kind === 'player' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[0.62, 0.7, 32]} />
          <meshBasicMaterial color={ringColor} transparent opacity={0.55} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <mesh ref={circle} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} material={circleMat} visible={false}>
        <planeGeometry />
      </mesh>
      <group ref={turn}>
        {USE_KAYKIT ? (
          // Real KayKit models; procedural art shows while loading or if assets are missing.
          <AssetBoundary fallback={procedural}>
            <Suspense fallback={procedural}>
              <KayKitAvatar id={id} info={info} />
            </Suspense>
          </AssetBoundary>
        ) : procedural}
      </group>
      {/* aura effects (don't rotate with the body) */}
      <group ref={auraRefs.ironhide} visible={false} position={[0, 0.8, 0]}>
        <Bubble color="#ffd36b" radius={1.0} opacity={0.16} />
        <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.95, 0.03, 6, 32]} /><meshBasicMaterial color={[3, 2.4, 0.8]} toneMapped={false} /></mesh>
      </group>
      <group ref={auraRefs.lumen_ward} visible={false} position={[0, 0.8, 0]}>
        <Bubble color="#fff6c8" radius={0.88} opacity={0.22} />
      </group>
      <group ref={auraRefs.bloomward} visible={false} position={[0, 0.08, 0]}>
        {Array.from({ length: 5 }, (_, k) => {
          const a = (k / 5) * Math.PI * 2
          return (
            <mesh key={k} position={[Math.cos(a) * 0.62, 0.1 + (k % 2) * 0.12, Math.sin(a) * 0.62]}>
              <octahedronGeometry args={[0.06, 0]} /><meshBasicMaterial color={[0.8, 3, 0.8]} toneMapped={false} />
            </mesh>
          )
        })}
      </group>
      <group ref={auraRefs.wild_roar} visible={false} position={[0, 0.05, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.66, 0.74, 32]} /><meshBasicMaterial color={[3, 1.4, 0.4]} toneMapped={false} transparent opacity={0.8} /></mesh>
      </group>
      <group ref={auraRefs.rent_soul} visible={false} position={[0, 1.0, 0]}>
        <mesh><sphereGeometry args={[0.75, 16, 12]} /><meshBasicMaterial color="#ff2850" transparent opacity={0.12} depthWrite={false} /></mesh>
      </group>
      <group ref={auraRefs.haunted} visible={false} position={[0, 1.7, 0]}>
        {[0, 1, 2].map((k) => (
          <mesh key={k} position={[Math.cos(k * 2.1) * 0.45, k * 0.08, Math.sin(k * 2.1) * 0.45]}>
            <sphereGeometry args={[0.07, 8, 6]} /><meshBasicMaterial color={[1.8, 0.9, 3]} toneMapped={false} />
          </mesh>
        ))}
      </group>
      <group ref={auraRefs.grave_mark} visible={false} position={[0, 0.07, 0]}>
        {/* Grave Mark: everyone inside this 6 m circle is hit when it detonates. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[6, 64]} /><meshBasicMaterial color="#ff2850" transparent opacity={0.15} depthWrite={false} toneMapped={false} /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[5.8, 6, 64]} /><meshBasicMaterial color={[3.2, 0.4, 0.6]} transparent opacity={0.8} depthWrite={false} toneMapped={false} /></mesh>
      </group>
      <group ref={auraRefs.hollow_fury} visible={false} position={[0, 0.1, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.2, 2.6, 48]} /><meshBasicMaterial color={[3.5, 0.5, 0.6]} toneMapped={false} transparent opacity={0.8} /></mesh>
      </group>
    </group>
  )
}
