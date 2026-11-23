// The live 3D replay in the home hero. Lazy-loaded (it pulls in three.js), not
// interactive (so it never steals the page's scroll), paused when off screen.
import { useEffect, useRef } from 'react'
import { usePlayback } from '../replay/store'
import { AssetBoundary } from '../scene/ErrorBoundary'
import { Scene } from '../scene/Scene'
import { HERO_WINDOW_S, TEASER_REPLAY, TEASER_START_S } from './config'
import { fetchResults, topPullId } from './results'

export default function Teaser() {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const p = usePlayback.getState()
    // The top model's best pull once there are results; the configured showcase before that.
    let startMs = TEASER_START_S * 1000
    let endMs = Infinity
    let gone = false // left the page before the clip loaded: don't replace what the viewer opened
    Promise.all([p.ensureIndex(), fetchResults().then(topPullId, () => null)])
      .then(async ([, top]) => {
        if (gone) return
        await p.load(top ?? TEASER_REPLAY, { quiet: true, startMs: top ? HERO_WINDOW_S[0] * 1000 : startMs })
        if (top) { startMs = HERO_WINDOW_S[0] * 1000; endMs = HERO_WINDOW_S[1] * 1000 }
      })
    let visible = true
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; usePlayback.getState().setPlaying(visible) })
    if (box.current) io.observe(box.current)
    // Loop: at the end of the window (or the replay), go back to the start point.
    const off = usePlayback.subscribe((s) => {
      if (visible && s.engine && (s.t >= endMs || (!s.playing && s.t >= s.engine.duration))) {
        s.seek(startMs)
        s.setPlaying(true)
      }
    })
    return () => { gone = true; io.disconnect(); off(); usePlayback.getState().setPlaying(false) }
  }, [])
  return (
    <div ref={box} className="pointer-events-none absolute inset-0" aria-hidden>
      <AssetBoundary fallback={null}><Scene /></AssetBoundary>
    </div>
  )
}
