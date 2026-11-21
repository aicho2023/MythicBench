import { useCallback, useEffect, useState } from 'react'
import { BossFrame } from './hud/BossFrame'
import { AboutPanel, EndBanner, ReplayControls, TimelineLegend, TopBar } from './hud/Controls'
import { DamageMeter, DecisionLog, RaidWarnings, Scorecard } from './hud/Panels'
import { PartyFrames } from './hud/PartyFrames'
import { LearningPanel } from './hud/LearningPanel'
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
  const [meter, setMeter] = useState(false)
  const learning = usePlayback((p) => !!p.engine?.replay.meta.progress)
  const closeRuns = useCallback(() => setRuns(false), [])
  useEffect(() => { loadIndex() }, [loadIndex])

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <Scene />
      <WorldOverlay />
      {/* HUD: pointer-events-none so the camera can still be dragged through gaps */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0"><TopBar onAbout={() => setAbout(true)} onRuns={() => setRuns(true)} /></div>

        {/* Top row: party | boss (+ adds, callouts) | scorecard. See .hud-top in index.css. */}
        <div className="hud-top absolute inset-x-4 top-16">
          <div className="hud-s justify-self-start [grid-area:party]"><PartyFrames /></div>
          <div className="hud-s relative justify-self-center [grid-area:boss]">
            <BossFrame />
            <div className="absolute left-1/2 top-full mt-14 -translate-x-1/2"><RaidWarnings /></div>
          </div>
          <div className="hud-s flex flex-col gap-2 justify-self-end [grid-area:side]">
            <Scorecard />
            <div className="pointer-events-auto">
              {learning && !meter ? <LearningPanel onShowMeter={() => setMeter(true)} /> : <DamageMeter />}
              {learning && meter && (
                <button onClick={() => setMeter(false)} className="mt-1 w-full text-right text-meta text-fg-faint transition-colors hover:text-fg">Show learning</button>
              )}
            </div>
          </div>
        </div>

        {/* Bottom row: decision log | transport. See .hud-bottom in index.css. */}
        <div className="hud-bottom absolute inset-x-4 bottom-4">
          <div className="hud-s pointer-events-auto justify-self-start [grid-area:log]"><DecisionLog /></div>
          <div className="flex w-full flex-col items-center gap-2 [grid-area:transport]"><TimelineLegend /><ReplayControls /></div>
        </div>
        <div className="absolute left-1/2 top-[28%] z-10 -translate-x-1/2"><div className="hud-s"><EndBanner /></div></div>
        {about && <AboutPanel onClose={closeAbout} />}
        {runs && <RunBrowser onClose={closeRuns} />}
      </div>
      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center text-[13px] text-fg-faint">Loading replay…</div>
      )}
      {error && <div className="absolute inset-0 grid place-items-center text-[13px] text-bad">{error}</div>}
    </div>
  )
}
