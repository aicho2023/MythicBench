import { useMemo, useState } from 'react'
import { CLASS_COLORS, fmtNum } from '../content/display'
import { runItemId, usePlayback } from '../replay/store'
import type { CatalogItem } from '../replay/types'
import { Link } from '../site/router'

/** Models write their notes in light markdown: show **bold** as bold, not asterisks. */
function Md({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i} className="font-semibold text-fg">{part.slice(2, -2)}</strong>
      : part)}</>
}

const W = 240, PAD = 6

/** One small chart across the episode's pulls; the current pull is ringed. */
function Strip({ label, pulls, value, fmt, max, current, onPick, height = 24, killLine }: {
  label: string; pulls: CatalogItem[]; value: (p: CatalogItem) => number | null; fmt: (v: number) => string
  max: number; current: number | undefined; onPick: (p: CatalogItem) => void; height?: number; killLine?: number
}) {
  const vals = pulls.map(value)
  if (vals.every((v) => v === null)) return null
  const x = (k: number) => PAD + (pulls.length <= 1 ? (W - 2 * PAD) / 2 : (k / (pulls.length - 1)) * (W - 2 * PAD))
  const y = (v: number) => height - PAD - (Math.min(v, max) / (max || 1)) * (height - 2 * PAD)
  const pts = vals.map((v, k) => (v === null ? null : `${x(k)},${y(v)}`)).filter(Boolean).join(' ')
  return (
    <div className="mx-3 mt-1.5">
      <div className="flex justify-between text-meta leading-4 text-fg-faint">
        <span>{label}</span>
        <span className="num font-mono">{vals.map((v) => (v === null ? '-' : fmt(v))).join('  ')}</span>
      </div>
      <svg width={W} height={height} className="block" role="img" aria-label={`${label} per pull`}>
        {killLine !== undefined && <line x1={PAD} x2={W - PAD} y1={y(killLine)} y2={y(killLine)} stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />}
        <polyline fill="none" stroke="rgba(237,237,239,0.4)" strokeWidth={1.5} points={pts} />
        {pulls.map((p, k) => vals[k] === null ? null : (
          <g key={p.pull} onClick={() => onPick(p)} className="cursor-pointer">
            <circle cx={x(k)} cy={y(vals[k]!)} r={p.pull === current ? 4.5 : 3}
              fill={p.outcome === 'victory' && p.in_time !== false ? '#4ade80' : p.outcome === 'victory' ? '#fbbf24' : '#f87171'}
              stroke={p.pull === current ? '#ededef' : 'none'} strokeWidth={1.5} />
            <circle cx={x(k)} cy={y(vals[k]!)} r={10} fill="transparent" />
            <title>{`pull ${p.pull}: ${fmt(vals[k]!)}`}</title>
          </g>
        ))}
      </svg>
    </div>
  )
}

function notesOf(v: string | Record<string, string> | undefined, who: string): string {
  if (!v) return ''
  return typeof v === 'string' ? v : v[who] ?? ''
}

/**
 * Progression replays (learning over pulls): where this pull sits in its
 * episode, how the pulls went, what each agent knew going in, what the party
 * said afterwards, and what each agent wrote down (new lines marked).
 */
export function LearningPanel({ onShowMeter }: { onShowMeter: () => void }) {
  const engine = usePlayback((p) => p.engine)
  const catalog = usePlayback((p) => p.catalog)
  const index = usePlayback((p) => p.index)
  const current = usePlayback((p) => p.currentId)
  const load = usePlayback((p) => p.load)
  const prog = engine?.replay.meta.progress
  const runId = engine?.replay.meta.run?.run_id
  // The run on screen: by the item id (results dataset runs have their own ids), else by the replay's run id.
  const run = catalog?.runs.find((r) => current?.startsWith(`${r.run_id}/`)) ?? catalog?.runs.find((r) => r.run_id === runId)
  const pulls = useMemo(() => (run?.items ?? []).filter((i) => i.episode === prog?.episode)
    .sort((a, b) => (a.pull ?? 0) - (b.pull ?? 0)), [run, prog?.episode])
  const [tab, setTab] = useState<string>('talk')
  if (!prog) return null
  const perAgent = typeof prog.notes_before !== 'string'
  const party = (engine?.replay.units ?? []).filter((u) => u.kind === 'player')
  const pick = (p: CatalogItem) => { if (run) load(runItemId(run.run_id, p)) }
  const tabs = perAgent ? ['talk', ...party.map((u) => u.id)] : ['party']
  const active = tabs.includes(tab) ? tab : tabs[0]
  const who = (id: string) => party.find((u) => u.id === id)
  const first = run && pulls.length && prog.pull > 1 ? index.find((e) => e.id === runItemId(run.run_id, pulls[0])) : undefined
  const here = index.find((e) => e.id === current)

  const key = active === 'party' ? '' : active
  const shownBefore = notesOf(prog.notes_before, key)
  const shownAfter = notesOf(prog.notes_after, key)
  const beforeSet = new Set(shownBefore.split('\n').map((l) => l.trim()).filter(Boolean))

  return (
    <div className="card max-h-[calc(100vh-540px)] min-h-[200px] w-[272px] overflow-y-auto pb-3">
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="label">Learning</span>
        <button onClick={onShowMeter} className="text-meta text-fg-faint transition-colors hover:text-fg">Show meter</button>
      </div>
      <div className="mt-1 px-3 text-meta leading-5 text-fg-faint">
        Pull {prog.pull}{run?.max_pulls ? ` of ${run.max_pulls}` : ''} in episode {prog.episode}, {engine?.replay.meta.tier_name ?? `+${engine?.replay.meta.sigil_level}`}
        <br />
        {prog.knowledge === 'blind' ? 'Blind start' : 'Full boss guide'}, memory {prog.memory ? 'on' : 'off'}{perAgent ? ', one agent per character' : ''}
      </div>

      {pulls.length > 0 && <>
        <Strip label="Score" pulls={pulls} value={(p) => p.score} fmt={(v) => v.toFixed(0)} max={100} current={prog.pull} onPick={pick} height={40} killLine={70} />
        <Strip label="Deaths" pulls={pulls} value={(p) => p.deaths ?? null} fmt={(v) => `${v}`} max={Math.max(5, ...pulls.map((p) => p.deaths ?? 0))} current={prog.pull} onPick={pick} />
        <Strip label="Interrupts landed" pulls={pulls} value={(p) => (p.kicks && p.kicks[1] ? (100 * p.kicks[0]) / p.kicks[1] : null)} fmt={(v) => `${v.toFixed(0)}%`} max={100} current={prog.pull} onPick={pick} />
        <Strip label="Avoidable damage" pulls={pulls} value={(p) => p.avoidable ?? null} fmt={fmtNum} max={Math.max(1, ...pulls.map((p) => p.avoidable ?? 0))} current={prog.pull} onPick={pick} />
        {first && here && (
          <Link to={`/compare?a=${encodeURIComponent(first.id)}&b=${encodeURIComponent(here.id)}`}
            className="mx-3 mt-2 block text-meta text-fg-faint transition-colors hover:text-fg">Compare with pull 1 side by side</Link>
        )}
      </>}

      {perAgent && (
        <div className="mx-3 mt-3 flex flex-wrap gap-1" role="tablist" aria-label="Notes and talk">
          {tabs.map((id) => (
            <button key={id} role="tab" aria-selected={active === id} onClick={() => setTab(id)}
              className="rounded-md px-1.5 py-0.5 text-meta text-fg-faint transition-colors hover:text-fg aria-selected:bg-white/[0.08] aria-selected:text-fg">
              {id === 'talk' ? 'Party talk' : <span style={{ color: active === id ? CLASS_COLORS[who(id)?.class ?? ''] : undefined }}>{who(id)?.name ?? id}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 px-3">
        {active === 'talk' ? (
          prog.talk && prog.talk.some((x) => x.message) ? (
            <div className="text-[12px] leading-[18px]">
              <div className="text-label text-fg-faint">After this pull, the party said</div>
              {prog.talk.filter((x) => x.message).map((x, i) => (
                <p key={i} className="mt-1.5 text-fg-muted">
                  <span className="font-medium" style={{ color: CLASS_COLORS[who(x.agent)?.class ?? ''] }}>{who(x.agent)?.name ?? x.agent}</span>{' '}
                  <Md text={x.message} />
                </p>
              ))}
            </div>
          ) : (
            <p className="text-[12px] leading-[18px] text-fg-faint">
              {prog.memory ? 'No talk after this pull (it ended the episode).' : 'Memory off: no talk and no notes between pulls.'}
            </p>
          )
        ) : (
          <>
            <div className="text-label text-fg-faint">Going in, {active === 'party' ? 'it' : who(active)?.name} knew</div>
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-[18px] text-fg-muted">
              {shownBefore.trim() ? <Md text={shownBefore.trim()} /> : (prog.knowledge === 'blind' ? 'Nothing about the boss: first pull, blind.' : 'No notes yet.')}
            </p>
            {prog.memory && shownAfter !== shownBefore && shownAfter.trim() && (
              <>
                <div className="mt-3 text-label text-fg-faint">After this pull {active === 'party' ? 'it' : 'they'} wrote <span className="text-fg-faint">(new lines marked)</span></div>
                <div className="mt-1 text-[12px] leading-[18px]">
                  {shownAfter.split('\n').filter((l) => l.trim()).map((l, i) => (
                    <p key={i} className={beforeSet.has(l.trim()) ? 'pl-2 text-fg-muted' : 'border-l-2 border-accent/70 pl-1.5 text-fg'}><Md text={l} /></p>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
