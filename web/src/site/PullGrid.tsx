// Every ranked pull on one screen: a row per model, a block of five cells per
// group, each cell colored by the pull's score and ringed where the party
// stood in Bone Pyre. Click a cell to open that pull in the viewer.
// Data: web/public/insights/v1.json (scripts/build_insights.py).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { modelName } from '../content/display'
import { fmtScore, modelColor, type Results } from './results'
import { navigate } from './router'

export interface PullFacts {
  pull: number; score: number; dur: number; boss: number | null; deaths: number
  pyres: number; soaked: number; first_soak_s: number | null; kicks: [number, number]; chat: number
}
export interface GroupFacts { episode: number; ranked: boolean; pulls: PullFacts[] }
export interface Insights { source: string; tier: string; models: Record<string, GroupFacts[]> }

let cache: Promise<Insights> | null = null
export function fetchInsights(): Promise<Insights> {
  cache ??= fetch(`${import.meta.env.BASE_URL}insights/v1.json`).then((r) => {
    if (!r.ok) throw new Error(String(r.status))
    return r.json()
  })
  return cache
}
export function useInsights(): Insights | null {
  const [d, setD] = useState<Insights | null>(null)
  useEffect(() => { fetchInsights().then(setD, () => setD(null)) }, [])
  return d
}

// A crypt-fire ramp: cold violet for a pull that died early, bone-white for one that nearly won.
const STOPS: [number, [number, number, number]][] = [
  [0, [38, 22, 64]], [0.3, [96, 38, 120]], [0.55, [176, 58, 110]], [0.75, [232, 110, 72]], [0.9, [246, 180, 90]], [1, [250, 232, 180]],
]
const LO = 20
const HI = 70
export function scoreColor(score: number): string {
  const f = Math.max(0, Math.min(1, (score - LO) / (HI - LO)))
  const k = STOPS.findIndex(([s]) => s >= f)
  if (k <= 0) return `rgb(${STOPS[0][1].join(',')})`
  const [s0, c0] = STOPS[k - 1]
  const [s1, c1] = STOPS[k]
  const u = (f - s0) / (s1 - s0)
  return `rgb(${c0.map((c, i) => Math.round(c + (c1[i] - c) * u)).join(',')})`
}

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

interface Hover { model: string; g: GroupFacts; p: PullFacts; x: number; y: number }

export function PullGrid({ results }: { results: Results }) {
  const data = useInsights()
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<Hover | null>(null)
  const rows = results.leaderboard
    .map((r) => ({ row: r, groups: (data?.models[r.model] ?? []).filter((g) => g.ranked) }))
    .filter((r) => r.groups.length)
  const pulls = results.protocol.max_pulls
  const groups = Math.max(1, ...rows.map((r) => r.groups.length))
  const narrow = w < 720
  const labelW = narrow ? 0 : 200
  const gap = narrow ? 5 : 12
  const cellGap = narrow ? 2 : 3
  const cell = Math.max(6, Math.min(30, Math.floor((w - labelW - gap * (groups - 1) - cellGap * (pulls - 1) * groups) / (pulls * groups))))
  const block = pulls * cell + (pulls - 1) * cellGap
  const gridW = groups * block + (groups - 1) * gap

  if (!data) return <div ref={ref} className="h-[260px]" />
  return (
    <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
      {/* Group headings */}
      <div className="flex text-[11px] text-fg-faint" style={{ paddingLeft: labelW }}>
        {Array.from({ length: groups }, (_, g) => (
          <div key={g} style={{ width: block, marginRight: g < groups - 1 ? gap : 0 }} className="truncate">
            {narrow ? `G${g + 1}` : `Group ${g + 1}`}
          </div>
        ))}
      </div>
      <div className="mt-2 space-y-3 sm:space-y-2">
        {rows.map(({ row, groups: gs }) => (
          <div key={row.model} className={narrow ? '' : 'flex items-center'}>
            <div className={`flex items-baseline gap-2 ${narrow ? 'mb-1.5' : 'shrink-0 pr-4'}`} style={narrow ? undefined : { width: labelW }}>
              <span className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: modelColor(results, row.model) }} aria-hidden />
              <span className="truncate text-[14px] text-fg">{modelName(row.model)}</span>
              <span className="ml-auto font-mono text-[12px] text-fg-faint">{fmtScore(row.mythicbench_score)}</span>
            </div>
            <div className="flex" style={{ width: gridW }}>
              {gs.map((g, gi) => (
                <div key={g.episode} className="flex" style={{ gap: cellGap, marginRight: gi < gs.length - 1 ? gap : 0 }}>
                  {g.pulls.map((p) => {
                    const on = hover?.model === row.model && hover.g === g && hover.p === p
                    const path = `/watch/${encodeURIComponent(row.model)}/${data.tier}/${g.episode}/${p.pull}`
                    return (
                      <a key={p.pull} href={path}
                        aria-label={`${modelName(row.model)}, group ${g.episode + 1}, pull ${p.pull}: score ${fmtScore(p.score)}${p.soaked ? ', stood in Bone Pyre' : ''}`}
                        onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(path) }}
                        onPointerEnter={(e) => {
                          const box = ref.current!.getBoundingClientRect()
                          const c = e.currentTarget.getBoundingClientRect()
                          setHover({ model: row.model, g, p, x: c.left - box.left + c.width / 2, y: c.top - box.top })
                        }}
                        className="relative grid place-items-center rounded-[3px] transition-transform duration-150 hover:z-10 hover:scale-125 focus-visible:z-10 focus-visible:scale-125"
                        style={{ width: cell, height: cell, background: scoreColor(p.score), boxShadow: on ? '0 0 0 2px #ededef' : undefined }}>
                        {p.soaked > 0 && (
                          <span aria-hidden className="rounded-full border-[1.5px] border-[#0a0a0c]/80"
                            style={{ width: Math.max(4, cell * 0.42), height: Math.max(4, cell * 0.42) }} />
                        )}
                      </a>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Legend: the ramp and the soak mark */}
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-fg-muted">
        <span className="flex items-center gap-2">
          <span className="font-mono text-fg-faint">{LO}</span>
          <span className="h-2.5 w-32 rounded-full" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((f) => scoreColor(LO + f * (HI - LO))).join(',')})` }} />
          <span className="font-mono text-fg-faint">{HI}</span>
          <span>pull score</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="grid h-3.5 w-3.5 place-items-center rounded-[3px]" style={{ background: scoreColor(45) }}>
            <span className="h-1.5 w-1.5 rounded-full border-[1.5px] border-[#0a0a0c]/80" />
          </span>
          the party stood in Bone Pyre
        </span>
        <span className="text-fg-faint">Click a square to watch that pull</span>
      </div>

      {hover && (
        <div className="pointer-events-none absolute z-20 w-[248px] rounded-lg border border-line bg-surface-raised px-3 py-2 text-[13px] leading-5 shadow-[0_6px_24px_rgba(0,0,0,0.5)]"
          style={{ left: Math.max(0, Math.min(w - 248, hover.x - 124)), top: hover.y - 8, transform: 'translateY(-100%)' }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-fg">{modelName(hover.model)}</span>
            <span className="font-mono text-[15px] text-fg">{fmtScore(hover.p.score)}</span>
          </div>
          <div className="text-[12px] text-fg-faint">Group {hover.g.episode + 1}, pull {hover.p.pull}</div>
          <BossBar left={hover.p.boss} />
          <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-x-3 text-[12px] text-fg-muted">
            <dt>Bone Pyres soaked</dt><dd className="text-right font-mono text-fg">{hover.p.soaked} of {hover.p.pyres}</dd>
            <dt>Casts interrupted</dt><dd className="text-right font-mono text-fg">{hover.p.kicks[0]} of {hover.p.kicks[1]}</dd>
            <dt>Deaths</dt><dd className="text-right font-mono text-fg">{hover.p.deaths} of 5</dd>
          </dl>
        </div>
      )}
    </div>
  )
}

/** Oruth's health when the pull ended, drawn like a boss frame. */
export function BossBar({ left, width }: { left: number | null; width?: number }) {
  if (left == null) return <div className="mt-2 text-[12px] text-fg-faint">Never reached Oruth</div>
  return (
    <div className="mt-2" style={{ width }}>
      <div className="flex justify-between text-[11px] text-fg-faint"><span>Oruth</span><span className="font-mono">{left.toFixed(left < 10 ? 1 : 0)}% left</span></div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full rounded-full bg-[#d0463b]" style={{ width: `${Math.max(1, left)}%` }} />
      </div>
    </div>
  )
}
