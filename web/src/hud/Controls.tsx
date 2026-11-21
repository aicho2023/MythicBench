import { Pause, Play, RotateCcw, SkipBack, SkipForward, Trophy, Skull } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { CLASS_COLORS, fmtNum, fmtTime } from '../content/display'
import { usePlayback, useHud } from '../replay/store'

const SPEEDS = [0.5, 1, 2, 4]

export function ReplayControls() {
  const engine = usePlayback((p) => p.engine)
  const playing = usePlayback((p) => p.playing)
  const speed = usePlayback((p) => p.speed)
  const { toggle, seek, setSpeed } = usePlayback.getState()
  const h = useHud()
  const track = useRef<HTMLDivElement>(null)
  const markers = useMemo(() => engine?.markers() ?? [], [engine])

  // Keyboard: space = play/pause, arrows = +-5s, 1-4 = speed
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = usePlayback.getState()
      if (e.code === 'Space') { e.preventDefault(); p.toggle() }
      else if (e.code === 'ArrowLeft') p.seek(p.t - 5000)
      else if (e.code === 'ArrowRight') p.seek(p.t + 5000)
      else if (/^Digit[1-4]$/.test(e.code)) p.setSpeed(SPEEDS[Number(e.code.slice(5)) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!engine || !h) return null
  const dur = engine.duration
  const t = h.t
  const scrubTo = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    seek(((clientX - r.left) / r.width) * dur)
  }
  return (
    <div className="panel pointer-events-auto flex w-[620px] items-center gap-3 px-3 py-2">
      <button onClick={() => seek(t - 10000)} className="ctl" title="Back 10s (←)"><SkipBack size={16} /></button>
      <button onClick={toggle} className="ctl h-10 w-10 bg-gold-500/20 ring-1 ring-gold-500/70" title="Play/Pause (space)">
        {playing ? <Pause size={18} /> : t >= dur ? <RotateCcw size={18} /> : <Play size={18} className="translate-x-px" />}
      </button>
      <button onClick={() => seek(t + 10000)} className="ctl" title="Forward 10s (→)"><SkipForward size={16} /></button>
      <span className="w-[86px] text-center font-body text-xs font-bold tabular-nums text-white/80">{fmtTime(t)} / {fmtTime(dur)}</span>
      <div
        ref={track}
        className="relative h-6 flex-1 cursor-pointer"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); scrubTo(e.clientX) }}
        onPointerMove={(e) => { if (e.buttons & 1) scrubTo(e.clientX) }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-black/70 ring-1 ring-white/10" />
        <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-gold-700 to-gold-400" style={{ width: `${(t / dur) * 100}%` }} />
        {markers.map((m, k) => (
          <div
            key={k}
            title={`${fmtTime(m.t)} — ${m.label}`}
            className={`absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm ${m.kind === 'death' ? 'bg-red-500' : m.kind === 'raise' ? 'bg-lime-400' : m.kind === 'missed' ? 'bg-orange-400' : 'bg-white'}`}
            style={{ left: `${(m.t / dur) * 100}%` }}
          />
        ))}
        <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold-300 shadow-[0_0_8px_#e9c46a]" style={{ left: `${(t / dur) * 100}%` }} />
      </div>
      <div className="flex gap-0.5">
        {SPEEDS.map((sp) => (
          <button key={sp} onClick={() => setSpeed(sp)}
            className={`rounded px-1.5 py-0.5 font-body text-[11px] font-bold ${sp === speed ? 'bg-gold-500/30 text-gold-300 ring-1 ring-gold-500/60' : 'text-white/50 hover:text-white'}`}>
            {sp}×
          </button>
        ))}
      </div>
    </div>
  )
}

export function ReplayPicker() {
  const index = usePlayback((p) => p.index)
  const current = usePlayback((p) => p.currentId)
  const load = usePlayback((p) => p.load)
  return (
    <div className="panel pointer-events-auto w-[268px] p-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-xl font-black tracking-wide text-gold-300 [text-shadow:0_2px_0_#3b2a08]">MythicBench</span>
        <span className="font-body text-[10px] uppercase tracking-widest text-white/40">replay viewer</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {index.map((r) => (
          <button
            key={r.id}
            onClick={() => load(r.id)}
            title={r.blurb}
            className={`rounded-md px-2 py-1.5 text-left transition ${r.id === current ? 'bg-gold-500/20 ring-1 ring-gold-400/70' : 'bg-white/5 hover:bg-white/10'}`}
          >
            <div className="font-display text-[12px] font-bold text-white">{r.label}</div>
            <div className={`flex items-center gap-1 font-body text-[10px] font-bold ${r.outcome === 'victory' ? 'text-emerald-300' : 'text-red-300'}`}>
              {r.outcome === 'victory' ? <Trophy size={10} /> : <Skull size={10} />}
              {r.outcome === 'victory' ? 'Kill' : 'Wipe'} · {fmtTime(r.duration_s * 1000)}
            </div>
          </button>
        ))}
      </div>
      <div className="mt-1.5 font-body text-[10.5px] leading-snug text-white/50">
        {index.find((r) => r.id === current)?.blurb}
      </div>
    </div>
  )
}

export function EndBanner() {
  const h = useHud()
  const index = usePlayback((p) => p.index)
  const current = usePlayback((p) => p.currentId)
  const { load, seek, setPlaying } = usePlayback.getState()
  if (!h || !h.s.ended || h.t < h.s.ended.t + 1500) return null
  const m = h.engine.replay.meta.metrics
  const win = h.s.ended.outcome === 'victory'
  const other = index.find((r) => r.id !== current)
  const players = h.engine.replay.units.filter((u) => u.kind === 'player')
  const top = players.map((u) => ({ u, v: h.s.damageDone[u.id] ?? 0 })).sort((a, b) => b.v - a.v)[0]
  return (
    <div className="pointer-events-auto animate-[fadein_0.6s_ease-out] text-center">
      <div className={`font-display text-6xl font-black tracking-wider ${win ? 'text-gold-300 [text-shadow:0_3px_0_#6b4a10,0_0_30px_#e9c46a88]' : 'text-red-400 [text-shadow:0_3px_0_#4a0a14,0_0_30px_#ff4d6d66]'}`}>
        {win ? 'Victory!' : 'Party Defeated'}
      </div>
      <div className="mt-1 font-body text-lg text-white/80">
        {win ? 'Mortisar, the Hollow King has fallen.' : `Mortisar survives with ${m?.boss_hp_pct_remaining}% health.`}
      </div>
      {m && (
        <div className="panel mx-auto mt-4 grid w-[520px] grid-cols-4 gap-2 p-3 font-body">
          <Stat label="Time" value={fmtTime(m.duration_s * 1000)} />
          <Stat label="Deaths" value={`${m.deaths.length}`} bad={m.deaths.length > 0} />
          <Stat label="Interrupts" value={`${m.interrupts.interrupted}/${m.interrupts.interruptible_casts}`} bad={m.interrupts.interrupted < m.interrupts.interruptible_casts} />
          <Stat label="Avoidable dmg" value={fmtNum(Object.values(m.avoidable_damage_taken).reduce((a, b) => a + b, 0))} bad={Object.values(m.avoidable_damage_taken).some((v) => v > 0)} />
          {top && (
            <div className="col-span-4 border-t border-white/10 pt-2 text-xs text-white/60">
              Top damage: <b style={{ color: CLASS_COLORS[top.u.class] }}>{top.u.name}</b> — {fmtNum(top.v)}
            </div>
          )}
        </div>
      )}
      <div className="mt-4 flex justify-center gap-2">
        <button onClick={() => { seek(0); setPlaying(true) }} className="btn">Watch again</button>
        {other && <button onClick={() => load(other.id)} className="btn btn-gold">Compare: {other.label}</button>}
      </div>
    </div>
  )
}

function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/45">{label}</div>
      <div className={`font-display text-xl font-bold ${bad ? 'text-red-300' : 'text-emerald-300'}`}>{value}</div>
    </div>
  )
}
