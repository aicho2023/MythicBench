// Every Bone Pyre in the ranked +10 groups, one square each: a block per model,
// a line per group, a column per pull, the Pyres in the order they went off.
// The colour says how many players stood inside: nobody, one (not enough), or
// two or more (soaked). Click a square to watch that Pyre.
// Data: web/public/insights/v1.json (scripts/build_insights.py).
import { X } from 'lucide-react'
import { useState } from 'react'
import { fmtTime, modelName } from '../content/display'
import { heat, useInsights } from './PullGrid'
import { modelColor, type Results } from './results'
import { navigate } from './router'
import { Tip } from './Tooltip'
import { useWidth } from './useWidth'
import { COLOR } from './tokens'

const KINDS = [
  { key: 'none', label: 'nobody inside', color: heat(0.06) },
  { key: 'one', label: 'one player: not enough', color: heat(0.45) },
  { key: 'soak', label: 'two or more inside: blast split', color: heat(0.93) },
] as const
const kindOf = (inside: number) => (inside >= 2 ? KINDS[2] : inside === 1 ? KINDS[1] : KINDS[0])

/** Seconds before the blast to start the replay: the circle appears 6 s before it goes off. */
const LEAD_S = 8

interface Hover { model: string; group: number; pull: number; k: number; n: number; inside: number; t: number | null; x: number; y: number; path: string }

export function PyreGrid({ results }: { results: Results }) {
  const data = useInsights()
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<Hover | null>(null)
  // Touch screens: the squares are a few pixels wide, too small to aim a tap at one Pyre. A tap
  // shows that square's details with a link to watch it, so a near miss costs nothing.
  const [touch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
  const pulls = results.protocol.max_pulls
  const rows = results.leaderboard
    .map((r) => ({ row: r, groups: (data?.models[r.model] ?? []).filter((g) => g.ranked) }))
    .filter((r) => r.groups.length)
  const perPull = Math.max(1, ...rows.flatMap((r) => r.groups.flatMap((g) => g.pulls.map((p) => p.pyre_inside?.length ?? 0))))

  const narrow = w < 640
  const labelW = narrow ? 0 : 184
  const minGap = narrow ? 8 : 16
  const gap = narrow ? 1.5 : 2
  const cell = Math.max(5, Math.min(16, Math.floor(((w - labelW - minGap * (pulls - 1)) / pulls - gap * (perPull - 1)) / perPull)))
  const colW = perPull * cell + (perPull - 1) * gap
  // Spread the pull columns across the full width rather than leaving it empty on the right.
  const colGap = pulls > 1 ? Math.max(minGap, Math.min(96, Math.floor((w - labelW - pulls * colW) / (pulls - 1)))) : minGap

  if (!data) return <div ref={ref} className="h-[420px]" />
  return (
    <div ref={ref} className="relative" onPointerLeave={touch ? undefined : () => setHover(null)}>
      {/* The key, before the grid it explains */}
      <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-fg-muted">
        {KINDS.map((k) => (
          <span key={k.key} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-[2px]" style={{ background: k.color }} aria-hidden />{k.label}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <span className="h-[2px] w-3 rounded-full bg-white/[0.08]" aria-hidden />never reached Oruth
        </span>
      </div>
      {/* Pull headings, aligned with the columns below */}
      <div className="flex text-[11px] text-fg-faint" style={{ paddingLeft: labelW }}>
        {Array.from({ length: pulls }, (_, k) => (
          <div key={k} style={{ width: colW, marginRight: k < pulls - 1 ? colGap : 0 }} className="truncate">
            {`Pull ${k + 1}`}
          </div>
        ))}
      </div>

      <div className="mt-2 space-y-4">
        {rows.map(({ row, groups }) => (
          <div key={row.model} className={narrow ? '' : 'flex items-start'}>
            <div className={`flex items-baseline gap-2 ${narrow ? 'mb-1.5' : 'shrink-0 pr-4 pt-0.5'}`} style={narrow ? undefined : { width: labelW }}>
              <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: modelColor(results, row.model) }} aria-hidden />
              <span className="truncate text-[14px] text-fg">{modelName(row.model)}</span>
            </div>
            <div role="list" aria-label={`${modelName(row.model)}: every Bone Pyre, by group and pull`} style={{ display: 'grid', rowGap: gap + 1 }}>
              {groups.map((g) => (
                <div key={g.episode} className="flex" role="listitem" aria-label={`Group ${g.episode + 1}`}>
                  {Array.from({ length: pulls }, (_, k) => {
                    const p = g.pulls.find((x) => x.pull === k + 1)
                    const ins = p?.pyre_inside ?? []
                    return (
                      <div key={k} className="flex" style={{ width: colW, gap, marginRight: k < pulls - 1 ? colGap : 0 }}>
                        {ins.length === 0 && (
                          <span className="self-center rounded-full bg-white/[0.08]" style={{ width: cell, height: 2 }}
                            title={p ? 'No Bone Pyre: this pull never reached Oruth' : undefined} />
                        )}
                        {ins.map((n, i) => {
                          const t = p?.pyre_t?.[i] ?? null
                          const kind = kindOf(n)
                          const on = hover?.model === row.model && hover.group === g.episode && hover.pull === k + 1 && hover.k === i
                          const path = `/watch/${encodeURIComponent(row.model)}/${data.tier}/${g.episode}/${k + 1}${t != null ? `?t=${Math.max(0, Math.round(t - LEAD_S))}` : ''}`
                          const show = (el: HTMLElement) => {
                            const box = ref.current!.getBoundingClientRect()
                            const c = el.getBoundingClientRect()
                            setHover({ model: row.model, group: g.episode, pull: k + 1, k: i, n: ins.length, inside: n, t, x: c.left - box.left + c.width / 2, y: c.top - box.top, path })
                          }
                          return (
                            <a key={i} href={path}
                              aria-label={`Group ${g.episode + 1}, pull ${k + 1}, Pyre ${i + 1}: ${kind.label}`}
                              onClick={(e) => {
                                if (e.metaKey || e.ctrlKey) return
                                e.preventDefault()
                                if (touch) show(e.currentTarget)
                                else navigate(path)
                              }}
                              onPointerEnter={touch ? undefined : (e) => show(e.currentTarget)}
                              className="block shrink-0 rounded-[2px] transition-transform duration-150 hover:z-10 hover:scale-150 focus-visible:z-10 focus-visible:scale-150"
                              style={{ width: cell, height: cell, background: kind.color, boxShadow: on ? `0 0 0 1.5px ${COLOR.fg}` : undefined }} />
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>


      {hover && (
        <Tip x={hover.x} y={hover.y} w={w} interactive={touch}>
          {touch && (
            <button onClick={() => setHover(null)} className="absolute right-1 top-1 grid h-8 w-8 place-items-center text-fg-faint" aria-label="Close"><X size={14} /></button>
          )}
          <div className="text-fg">{modelName(hover.model)}</div>
          <div className="text-[12px] text-fg-faint">
            Group {hover.group + 1}, pull {hover.pull}, Pyre {hover.k + 1} of {hover.n}{hover.t != null ? `, at ${fmtTime(hover.t * 1000)}` : ''}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-fg-muted">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: kindOf(hover.inside).color }} aria-hidden />
            {hover.inside === 0 ? 'Nobody inside: it hit the whole party'
              : hover.inside === 1 ? 'One player inside: not enough, it hit everyone'
                : `${hover.inside} players inside: blast split`}
          </div>
          {touch && (
            <a href={hover.path} onClick={(e) => { e.preventDefault(); navigate(hover.path) }}
              className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] text-fg">
              Watch this Pyre
            </a>
          )}
        </Tip>
      )}
    </div>
  )
}
