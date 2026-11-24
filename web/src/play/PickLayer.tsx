// In the 3D scene on /play:
// - a tap on the floor sets where the player's next move goes;
// - a dotted line shows where you're about to walk (green), or are walking (grey);
// - a ring marks the unit you're pointing at, in the panel or the scene (yellow),
//   and your first target (red).
// Does nothing anywhere else.
import { Line } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useRef } from 'react'
import type * as THREE from 'three'
import { posAt } from '../replay/engine'
import { frameState, usePlayback } from '../replay/store'
import type { Vec2 } from '../replay/types'
import { usePlay } from './store'

const GO = '#7ee08a'
const AIM = '#fbbf24'
const TARGET = '#f87171'

/** Where "next" walks: the first route waypoint ahead (as LLMPolicy.next_waypoint). */
function nextWaypoint(route: Vec2[] | undefined, here: Vec2): Vec2 | null {
  if (!route?.length) return null
  return route.find((w) => w[1] < here[1] - 0.8) ?? route[route.length - 1]
}

/** A ring on the floor that follows a unit. */
function UnitRing({ id, color, size = 1, pulse = false }: { id: string; color: string; size?: number; pulse?: boolean }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    const f = frameState()
    const g = ref.current
    const u = f?.s.units[id]
    if (!g || !u || !u.alive) { if (g) g.visible = false; return }
    const p = posAt(u, f.t)
    g.visible = true
    g.position.set(p[0], 0.06, p[1])
    const r = u.info.radius * (u.info.kind === 'boss' ? 1.25 : 1.6) * size
    g.scale.setScalar(pulse ? r * (1 + Math.sin(performance.now() / 140) * 0.06) : r)
  })
  return (
    <group ref={ref} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.7, 1, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

export function PickLayer() {
  const playing = usePlay((s) => s.phase === 'playing')
  const active = usePlay((s) => s.phase === 'playing' && !!s.ask && !s.busy)
  const seat = usePlay((s) => s.seat)
  const move = usePlay((s) => s.move)
  const setMove = usePlay((s) => s.setMove)
  const hover = usePlay((s) => s.hover)
  const first = usePlay((s) => s.ask?.orders?.priority?.[0]?.[1] ?? null)
  // Re-render ten times a second for the path lines (the rings move every frame on their own).
  usePlayback((p) => Math.floor(p.t / 100))
  if (!playing) return null

  const f = frameState()
  const me = f?.s.units[seat]
  const here = me && f ? posAt(me, f.t) : null
  const dest: Vec2 | null = Array.isArray(move) ? move
    : move === 'next' && here ? nextWaypoint(f?.engine.replay.arena.route, here) : null
  const walking = me?.move && f && f.t < me.move.t0 + me.move.dur ? me.move.to : null

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return // a camera drag, not a tap
    e.stopPropagation()
    setMove([Math.round(e.point.x * 10) / 10, Math.round(e.point.z * 10) / 10])
  }
  const y = 0.08
  return (
    <>
      {active && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 30]} onClick={onClick}>
          <planeGeometry args={[160, 160]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {here && walking && !dest && (
        <Line points={[[here[0], y, here[1]], [walking[0], y, walking[1]]]} color="#c4c4ca" lineWidth={1.5} dashed dashSize={0.35} gapSize={0.3} transparent opacity={0.6} />
      )}
      {here && dest && (
        <>
          <Line points={[[here[0], y, here[1]], [dest[0], y, dest[1]]]} color={GO} lineWidth={2.5} dashed dashSize={0.45} gapSize={0.3} toneMapped={false} />
          <group position={[dest[0], 0.07, dest[1]]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.45, 0.62, 40]} />
              <meshBasicMaterial color={GO} transparent opacity={0.95} toneMapped={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.14, 20]} />
              <meshBasicMaterial color={GO} toneMapped={false} />
            </mesh>
          </group>
        </>
      )}
      {first && first !== seat && first !== hover && <UnitRing id={first} color={TARGET} />}
      {hover && <UnitRing id={hover} color={AIM} size={1.12} pulse />}
    </>
  )
}
