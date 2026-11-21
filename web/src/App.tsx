import { useCallback, useEffect, useState } from 'react'
import { BossFrame } from './hud/BossFrame'
import { AboutPanel, EndBanner, ReplayControls, TimelineLegend, TopBar } from './hud/Controls'
import { DamageMeter, DecisionLog, RaidWarnings, Scorecard } from './hud/Panels'
import { PartyFrames } from './hud/PartyFrames'
import { RunBrowser } from './hud/RunBrowser'
import { WorldOverlay } from './hud/WorldOverlay'
import { usePlayback } from './replay/store'
import { Scene } from './scene/Scene'

export default function App() {
  const loadIndex = usePlayback((p) => p.loadIndex)
  const error = usePlayback((p) => p.error)
  const ready = usePlayback((p) => !!p.engine)
  const [about, setAbout] = useState(false)
  const closeAbout = useCallback(() => setAbout(false), [])
  const [runs, setRuns] = useState(false)
  const closeRuns = useCallback(() => setRuns(false), [])
  useEffect(() => { loadIndex() }, [loadIndex])

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <Scene />
      <WorldOverlay />
      {/* HUD: pointer-events-none so the camera can still be dragged through gaps */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0"><TopBar onAbout={() => setAbout(true)} onRuns={() => setRuns(true)} /></div>

        <div className="hud-s absolute left-4 top-16 origin-top-left"><PartyFrames /></div>
        <div className="absolute left-1/2 top-16 -translate-x-1/2"><div className="hud-s origin-top"><BossFrame /></div></div>
        <div className="absolute left-1/2 top-[178px] -translate-x-1/2"><div className="hud-s origin-top"><RaidWarnings /></div></div>
        <div className="hud-s absolute right-4 top-16 flex origin-top-right flex-col gap-2">
          <Scorecard />
          <div className="pointer-events-auto"><DamageMeter /></div>
        </div>

        <div className="hud-s pointer-events-auto absolute bottom-4 left-4 origin-bottom-left"><DecisionLog /></div>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="hud-s flex origin-bottom flex-col gap-1.5"><TimelineLegend /><ReplayControls /></div>
        </div>
        <div className="absolute left-1/2 top-[28%] -translate-x-1/2"><div className="hud-s origin-top"><EndBanner /></div></div>
        {about && <AboutPanel onClose={closeAbout} />}
        {runs && <RunBrowser onClose={closeRuns} />}
      </div>
      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[12px] text-fg-faint">Loading replay…</div>
      )}
      {error && <div className="absolute inset-0 grid place-items-center text-[13px] text-bad">{error}</div>}
    </div>
  )
}
