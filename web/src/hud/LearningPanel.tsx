import { useMemo } from 'react'
import { runItemId, usePlayback } from '../replay/store'

/**
 * Shown for progression replays (learning over pulls): where this pull sits in
 * its episode, the score curve across pulls, what the model knew going in,
 * and what it wrote down afterwards (new lines highlighted).
 */
export function LearningPanel({ onShowMeter }: { onShowMeter: () => void }) {
  const engine = usePlayback((p) => p.engine)
  const catalog = usePlayback((p) => p.catalog)
  const current = usePlayback((p) => p.currentId)
  const load = usePlayback((p) => p.load)
  const prog = engine?.replay.meta.progress
  const runId = engine?.replay.meta.run?.run_id
  const run = catalog?.runs.find((r) => r.run_id === runId)
  const pulls = useMemo(() => (run?.items ?? []).filter((i) => i.episode === prog?.episode)
    .sort((a, b) => (a.pull ?? 0) - (b.pull ?? 0)), [run, prog?.episode])
  if (!prog) return null

  const before = new Set(prog.notes_before.split('\n').map((l) => l.trim()).filter(Boolean))
  const after = prog.notes_after.split('\n').filter((l) => l.trim())
  const maxScore = 100
  const W = 240, H = 56, pad = 6
  const x = (k: number) => pad + (pulls.length <= 1 ? 0 : (k / (pulls.length - 1)) * (W - 2 * pad))
  const y = (s: number) => H - pad - (s / maxScore) * (H - 2 * pad)

  return (
    <div className="card w-[272px] pb-2.5">
      <div className="flex items-center justify-between px-3.5 pb-1 pt-2">
        <span className="label">Learning · ep {prog.episode} · pull {prog.pull}{run?.max_pulls ? ` / ${run.max_pulls}` : ''} · {engine?.replay.meta.tier_name ?? `+${engine?.replay.meta.sigil_level}`}</span>
        <button onClick={onShowMeter} className="font-mono text-[10px] text-fg-faint hover:text-fg">meter</button>
      </div>
      <div className="px-3.5 font-mono text-[10px] text-fg-faint">
        {prog.knowledge} knowledge · memory {prog.memory ? 'on' : 'off'}
      </div>

      {pulls.length > 0 && (
        <svg width={W} height={H} className="mx-3.5 mt-1.5 block" role="img" aria-label="Score per pull">
          {/* 70 = the line between a wipe and a kill */}
          <line x1={pad} x2={W - pad} y1={y(70)} y2={y(70)} stroke="rgba(74,222,128,0.25)" strokeDasharray="3 3" />
          <polyline fill="none" stroke="rgba(237,237,239,0.5)" strokeWidth={1.5}
            points={pulls.map((p, k) => `${x(k)},${y(p.score)}`).join(' ')} />
          {pulls.map((p, k) => {
            const id = run ? runItemId(run.run_id, p) : ''
            const on = id === current
            return (
              <g key={p.pull} onClick={() => id && load(id)} className="cursor-pointer">
                <circle cx={x(k)} cy={y(p.score)} r={on ? 5 : 3.5}
                  fill={p.outcome === 'victory' ? '#4ade80' : '#f87171'} stroke={on ? '#ededef' : 'none'} strokeWidth={1.5} />
                <title>{`pull ${p.pull}: ${p.outcome === 'victory' ? 'kill' : 'wipe'}, score ${p.score}`}</title>
              </g>
            )
          })}
        </svg>
      )}

      <div className="mt-2 max-h-[300px] overflow-y-auto px-3.5">
        <div className="label !text-fg-faint">Going in, it knew</div>
        <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-[17px] text-fg-muted">
          {prog.notes_before.trim() || (prog.knowledge === 'blind' ? 'Nothing about the boss: first pull, blind.' : 'No notes yet.')}
        </p>
        {prog.memory && prog.notes_after !== prog.notes_before && (
          <>
            <div className="label mt-3 !text-fg-faint">After this pull it wrote</div>
            <div className="mt-1 text-[11.5px] leading-[17px]">
              {after.map((l, i) => (
                <p key={i} className={before.has(l.trim()) ? 'text-fg-muted' : 'rounded-[3px] bg-accent/10 px-1 text-fg'}>{l}</p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
