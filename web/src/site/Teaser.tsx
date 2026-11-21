// The live 3D replay in the home hero. Lazy-loaded (it pulls in three.js), not
// interactive (so it never steals the page's scroll), paused when off screen.
import { useEffect, useRef } from 'react'
import { usePlayback } from '../replay/store'
import { AssetBoundary } from '../scene/ErrorBoundary'
import { Scene } from '../scene/Scene'
import { TEASER_REPLAY, TEASER_START_S } from './config'

export default function Teaser() {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const p = usePlayback.getState()
    p.ensureIndex().then(() => p.load(TEASER_REPLAY, { quiet: true, startMs: TEASER_START_S * 1000 }))
    let visible = true
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; usePlayback.getState().setPlaying(visible) })
    if (box.current) io.observe(box.current)
    // Loop: at the end of the replay, go back to the start point.
    const off = usePlayback.subscribe((s) => {
      if (visible && s.engine && !s.playing && s.t >= s.engine.duration) {
        s.seek(TEASER_START_S * 1000)
        s.setPlaying(true)
      }
    })
    return () => { io.disconnect(); off(); usePlayback.getState().setPlaying(false) }
  }, [])
  return (
    <div ref={box} className="pointer-events-none absolute inset-0" aria-hidden>
      <AssetBoundary fallback={null}><Scene /></AssetBoundary>
    </div>
  )
}
