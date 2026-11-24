// In the 3D scene on /play: a tap on the floor sets where the player's next
// move goes, and a ring marks it. Does nothing anywhere else.
import type { ThreeEvent } from '@react-three/fiber'
import { usePlay } from './store'

export function PickLayer() {
  const active = usePlay((s) => s.phase === 'playing' && !!s.ask && !s.busy)
  const marker = usePlay((s) => s.marker)
  const setMarker = usePlay((s) => s.setMarker)
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return // a camera drag, not a tap
    e.stopPropagation()
    setMarker([Math.round(e.point.x * 10) / 10, Math.round(e.point.z * 10) / 10])
  }
  return (
    <>
      {active && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 30]} onClick={onClick}>
          <planeGeometry args={[160, 160]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {marker && (
        <group position={[marker[0], 0.07, marker[1]]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.45, 0.62, 40]} />
            <meshBasicMaterial color="#7ee08a" transparent opacity={0.95} toneMapped={false} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.14, 20]} />
            <meshBasicMaterial color="#7ee08a" toneMapped={false} />
          </mesh>
        </group>
      )}
    </>
  )
}
