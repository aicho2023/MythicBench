import { useEffect } from 'react'
import { BossFrame } from './hud/BossFrame'
import { EndBanner, ReplayControls, ReplayPicker } from './hud/Controls'
import { DamageMeter, DecisionLog, DungeonTimer, RaidWarnings } from './hud/Panels'
import { PartyFrames } from './hud/PartyFrames'
import { WorldOverlay } from './hud/WorldOverlay'
import { usePlayback } from './replay/store'
import { Scene } from './scene/Scene'

export default function App() {
  const loadIndex = usePlayback((p) => p.loadIndex)
  const error = usePlayback((p) => p.error)
  const ready = usePlayback((p) => !!p.engine)
  useEffect(() => { loadIndex() }, [loadIndex])

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900">
      <Scene />
      <WorldOverlay />
      {/* HUD: pointer-events-none so the camera can still be dragged through gaps */}
      <div className="hud pointer-events-none absolute inset-0">
        <div className="hud-s absolute left-4 top-4 flex origin-top-left flex-col gap-3">
          <ReplayPicker />
          <PartyFrames />
        </div>
        <div className="absolute left-1/2 top-4 -translate-x-1/2"><div className="hud-s origin-top"><BossFrame /></div></div>
        <div className="absolute left-1/2 top-[150px] -translate-x-1/2"><div className="hud-s origin-top"><RaidWarnings /></div></div>
        <div className="hud-s absolute right-4 top-4 origin-top-right"><DungeonTimer /></div>
        <div className="hud-s pointer-events-auto absolute bottom-4 right-4 origin-bottom-right"><DamageMeter /></div>
        <div className="hud-s pointer-events-auto absolute bottom-4 left-4 origin-bottom-left"><DecisionLog /></div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2"><div className="hud-s origin-bottom"><ReplayControls /></div></div>
        <div className="absolute left-1/2 top-[30%] -translate-x-1/2"><div className="hud-s origin-top"><EndBanner /></div></div>
      </div>
      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center font-display text-2xl text-gold-300">Opening the crypt…</div>
      )}
      {error && <div className="absolute inset-0 grid place-items-center font-body text-red-300">{error}</div>}
    </div>
  )
}
