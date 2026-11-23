import { useCallback, useEffect, useState } from 'react'
import { TipLayer } from './hud/AbilityTip'
import { AboutPanel, EndBanner, ReplayControls, TimelineLegend, TopBar } from './hud/Controls'
import { DamageMeter, DecisionLog, RaidWarnings, Scorecard } from './hud/Panels'
import { PartyFrames } from './hud/PartyFrames'
import { LearningPanel } from './hud/LearningPanel'
import { CompactParty, MomentBar } from './hud/MobileMoment'
import { CallInspector } from './hud/CallInspector'
import { RunBrowser } from './hud/RunBrowser'
import { WorldOverlay } from './hud/WorldOverlay'
import { usePlayback } from './replay/store'
import { Scene } from './scene/Scene'
import { modelName } from './content/display'
import { parseWatchPath } from './site/results'
import { useSearch } from './site/router'

/**
 * The replay viewer, full screen. `path` is the /watch address: /watch/<model>
 * opens that model's runs in the run list, /watch/<model>/<tier>/<episode>/<pull>
 * one pull. ?replay= and ?run= deep links work as before.
 */
export default function App({ path = '/watch' }: { path?: string }) {
  const ensureIndex = usePlayback((p) => p.ensureIndex)
  const openFromUrl = usePlayback((p) => p.openFromUrl)
  const indexed = usePlayback((p) => p.index.length > 0)
  const error = usePlayback((p) => p.error)
  const ready = usePlayback((p) => !!p.engine)
  const [about, setAbout] = useState(false)
  const closeAbout = useCallback(() => setAbout(false), [])
  const search = useSearch() // a new ?t= on the same pull seeks
  const target = parseWatchPath(path)
  const modelOnly = target && target.tier === undefined ? target.model : null
  const [runs, setRuns] = useState(!!modelOnly)
  const [meter, setMeter] = useState(false)
  const learning = usePlayback((p) => !!p.engine?.replay.meta.progress)
  const closeRuns = useCallback(() => setRuns(false), [])
  useEffect(() => { ensureIndex() }, [ensureIndex])
  // Open what the address names, on arrival and on client-side navigation to another /watch address.
  useEffect(() => {
    if (!indexed) return
    openFromUrl({ fallback: true })
    if (modelOnly) setRuns(true)
  }, [path, search, indexed, openFromUrl, modelOnly])

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <Scene />
      <WorldOverlay />
      {/* HUD: pointer-events-none so the camera can still be dragged through gaps */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0"><TopBar onAbout={() => setAbout(true)} onRuns={() => setRuns(true)} /></div>

        {/* Top row: party | boss (+ adds, callouts) | scorecard. See .hud-top in index.css. */}
        <div className="hud-top absolute inset-x-4 top-[72px]">
          <div className="hud-s no-phone justify-self-start [grid-area:party]"><PartyFrames /></div>
          <div className="phone-only [grid-area:party]"><CompactParty /></div>
          <div className="hud-s relative justify-self-center [grid-area:boss]">
            <RaidWarnings />
          </div>
          <div className="hud-s hud-side flex flex-col gap-2 justify-self-end [grid-area:side]">
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
          <div className="hud-s hud-log pointer-events-auto justify-self-start [grid-area:log]"><DecisionLog /></div>
          <div className="flex w-full flex-col items-center gap-2 [grid-area:transport]"><div className="no-phone"><TimelineLegend /></div><div className="phone-only w-full"><MomentBar /></div><ReplayControls /></div>
        </div>
        <div className="absolute left-1/2 top-[28%] z-10 -translate-x-1/2"><div className="hud-s"><EndBanner /></div></div>
        {about && <AboutPanel onClose={closeAbout} />}
        <CallInspector />
        <TipLayer />
        {runs && <RunBrowser onClose={closeRuns} initialQuery={modelOnly ? modelName(modelOnly) : ''} />}
      </div>
      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center text-[13px] text-fg-faint">Loading replay…</div>
      )}
      {error && <div className="absolute inset-0 grid place-items-center text-[13px] text-bad">{error}</div>}
    </div>
  )
}
