// Dev only (/dev/portraits?id=rook, &k=2.4 for the boss): one party member, posed, on a flat
// magenta background, for taking the Party page's portrait pictures. The magenta
// is keyed out afterwards; the site itself never loads three.js for them.
import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect, useState } from 'react'
import { KayKitAvatar } from '../scene/kaykit/KayKitAvatar'
import type { Replay, UnitInfo } from '../replay/types'

export default function DevPortraits() {
  const id = new URLSearchParams(location.search).get('id') ?? 'rook'
  const clip = new URLSearchParams(location.search).get('clip') ?? 'Idle_A'
  const at = Number(new URLSearchParams(location.search).get('at') ?? 0.6)
  const k = Number(new URLSearchParams(location.search).get('k') ?? 1) // camera distance and height, for big units (the boss)
  const [info, setInfo] = useState<UnitInfo | null>(null)
  useEffect(() => {
    fetch('/replays/commander-plus10.json').then((r) => r.json()).then((rep: Replay) => setInfo(rep.units.find((u) => u.id === id) ?? null))
  }, [id])
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#ff00ff' }}>
      {info && (
        <Canvas gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [0.7 * k, 1.3 * k, 6.2 * k], fov: 26 }}
          onCreated={({ camera }) => camera.lookAt(0, 1.0 * k, 0)} style={{ background: '#ff00ff' }}>
          <ambientLight intensity={1.4} />
          <directionalLight position={[2, 4, 5]} intensity={2.2} />
          <directionalLight position={[-3, 2, -2]} intensity={0.8} />
          <Suspense fallback={null}>
            <group rotation={[0, 0.25, 0]}>
              <KayKitAvatar id={`portrait-${id}`} info={info} still={{ clip, at }} />
            </group>
          </Suspense>
        </Canvas>
      )}
    </div>
  )
}
