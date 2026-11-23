// Charts drawn as plain SVG: few marks, muted grid, mono numbers, and a direct
// label on every series. Axes zoom to the data (every score here sits between
// about 20 and 55, so a 0-100 axis would flatten the differences that matter).
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { modelName } from '../content/display'
import {
  costPerRun, fmtScore, fmtUsd, headlineTier, modelColor, tierName, type CI, type Results,
} from './results'

const GRID = 'rgba(255,255,255,0.07)'
const AXIS = '#8b8b93'
const LABEL = '#d4d4d8'
const SURFACE = '#111113'
/** A halo in the surface color behind chart labels, so lines never cut through text. */
const HALO = { stroke: SURFACE, strokeWidth: 5, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const }
const MONO = 'IBM Plex Mono'

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
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

/** Spreads label y positions so none are closer than `gap`, keeping their order. */
function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y)
  for (let k = 1; k < order.length; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + gap)
  const over = order.length ? order[order.length - 1].y - hi : 0
  if (over > 0) for (const o of order) o.y -= over
  for (let k = order.length - 2; k >= 0; k--) order[k].y = Math.min(order[k].y, order[k + 1].y - gap)
  for (const o of order) o.y = Math.max(lo, o.y)
  const out = new Array<number>(ys.length)
  for (const o of order) out[o.i] = o.y
  return out
}

/** A score axis that fits the data: multiples of `step`, with some room either side. */
export function scoreDomain(values: number[], step = 10, pad = 3): [number, number] {
  const v = values.filter((x) => Number.isFinite(x))
  if (!v.length) return [0, 100]
  const lo = Math.max(0, Math.floor((Math.min(...v) - pad) / step) * step)
  const hi = Math.min(100, Math.ceil((Math.max(...v) + pad) / step) * step)
  return [lo, hi > lo ? hi : lo + step]
}
const ticks = (lo: number, hi: number, step = 10) => Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step)
const textW = (s: string, px = 13) => s.length * px * 0.56

// ---------------------------------------------------------------------------
// A 95% CI as a bar on a score track, with a dot per group
// ---------------------------------------------------------------------------
export function CIBar({ mean, ci, accent = false, width = 160, dots = [], lo = 0, hi = 100, color }: {
  mean: number | null; ci?: CI; accent?: boolean; width?: number; dots?: number[]; lo?: number; hi?: number; color?: string
}) {
  if (mean == null) return <span className="text-fg-faint">–</span>
  const H = 18
  const x = (v: number) => (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (width - 8) + 4
  const [a, b] = ci ?? [mean, mean]
  const ink = color ?? (accent ? '#e6d3a3' : '#ededef')
  return (
    <svg width={width} height={H} className="block shrink-0" aria-hidden>
      <rect x={4} y={H / 2 - 1} width={width - 8} height={2} rx={1} fill="rgba(255,255,255,0.08)" />
      <rect x={x(a)} y={H / 2 - 3} width={Math.max(2, x(b) - x(a))} height={6} rx={3} fill={ink} opacity={0.28} />
      {dots.map((d, i) => <circle key={i} cx={x(d)} cy={H / 2} r={2.6} fill={ink} opacity={0.75} />)}
      <rect x={x(mean) - 1.5} y={1} width={3} height={H - 2} rx={1.5} fill="#ededef" />
    </svg>
  )
}

/** Tick labels for a CIBar track, to sit in a table header above it. */
export function CIAxis({ width = 160, lo, hi, step = 10 }: { width?: number; lo: number; hi: number; step?: number }) {
  const x = (v: number) => (v - lo) / (hi - lo) * (width - 8) + 4
  return (
    <svg width={width} height={12} className="block" aria-hidden>
      {ticks(lo, hi, step).map((v) => (
        <text key={v} x={x(v)} y={10} textAnchor="middle" fill={AXIS} fontSize={10} fontFamily={MONO}>{v}</text>
      ))}
    </svg>
  )
}

function Tooltip({ x, y, w, width = 260, children }: { x: number; y: number; w: number; width?: number; children: ReactNode }) {
  const left = x + 16 + width > w ? Math.max(8, x - 16 - width) : x + 16
  return (
    <div className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface-raised px-3 py-2 text-[13px] leading-5 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
      style={{ left, top: Math.max(0, y - 8), width }}>
      {children}
    </div>
  )
}

function Legend({ items }: { items: { key: string; label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-fg-muted">
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-2">
          <svg width={18} height={8} aria-hidden>
            <line x1={0} x2={18} y1={4} y2={4} stroke={it.color} strokeWidth={2.5} strokeDasharray={it.dashed ? '4 3' : undefined} />
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Learning curves: mean score at each pull
// ---------------------------------------------------------------------------
interface Series { key: string; label: string; short: string; color: string; values: number[]; dashed?: boolean }

/**
 * view "models": each ranked model over its six leaderboard groups.
 * view "memory": the two models with a memory-off control, memory on and off
 * over the same (paired) groups.
 */
export function LearningCurves({ results, tier, view = 'models' }: { results: Results; tier: string; view?: 'models' | 'memory' }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const pulls = results.protocol.max_pulls
  const series: Series[] = useMemo(() => {
    if (view === 'memory') {
      return results.controls.filter((c) => c.tier === tier && c.curve_mean?.length && c.paired_on_curve_mean?.length).flatMap((c) => {
        const name = modelName(c.model)
        const color = modelColor(results, c.model)
        return [
          { key: `${c.model}:on`, label: `${name}, memory on`, short: `${name}, on`, color, values: c.paired_on_curve_mean! },
          { key: `${c.model}:off`, label: `${name}, memory off`, short: `${name}, off`, color, values: c.curve_mean!, dashed: true },
        ]
      })
    }
    return results.leaderboard.flatMap((row) => {
      const c = row.tiers[tier]?.curve_mean
      const name = modelName(row.model)
      return c?.length ? [{ key: row.model, label: name, short: name, color: modelColor(results, row.model), values: c }] : []
    })
  }, [results, tier, view])

  const [lo, hi] = scoreDomain(series.flatMap((s) => s.values))
  const narrow = w < 620
  const labelW = Math.max(0, ...series.map((s) => textW(`${s.short}  00.0`))) + 20
  const H = narrow ? 280 : 340
  const m = { l: 40, r: narrow ? 16 : labelW, t: 16, b: 36 }
  const iw = Math.max(1, w - m.l - m.r)
  const ih = H - m.t - m.b
  const x = (k: number) => m.l + (pulls === 1 ? iw / 2 : ((k - 1) / (pulls - 1)) * iw)
  const y = (v: number) => m.t + ih - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * ih
  const ends = spread(series.map((s) => y(s.values[s.values.length - 1])), 18, m.t + 6, m.t + ih)
  const dim = (k: string) => (hover && hover !== k ? 0.18 : 1)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
    const k = pulls === 1 ? 1 : Math.round(((e.clientX - r.left - m.l) / iw) * (pulls - 1)) + 1
    setAt(Math.max(1, Math.min(pulls, k)))
  }

  return (
    <figure className="m-0">
      <figcaption className="sr-only">Mean score at each pull on {tierName(results, tier)}</figcaption>
      {narrow && <Legend items={series} />}
      <div ref={ref} className="relative">
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label={`Mean score at each pull on ${tierName(results, tier)}`}>
            {ticks(lo, hi).map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke={GRID} />
                <text x={m.l - 10} y={y(v)} dy="0.32em" textAnchor="end" fill={AXIS} fontSize={11} fontFamily={MONO}>{v}</text>
              </g>
            ))}
            {Array.from({ length: pulls }, (_, i) => i + 1).map((k) => (
              <text key={k} x={x(k)} y={H - 12} textAnchor={narrow ? 'middle' : k === 1 ? 'start' : k === pulls ? 'end' : 'middle'} fill={AXIS} fontSize={11} fontFamily={MONO}>{narrow ? (k === 1 ? 'Pull 1' : k) : `Pull ${k}`}</text>
            ))}
            {at !== null && <line x1={x(at)} x2={x(at)} y1={m.t} y2={m.t + ih} stroke="rgba(255,255,255,0.18)" />}
            {series.map((s, i) => {
              const d = s.values.map((v, k) => `${k ? 'L' : 'M'}${x(k + 1)},${y(v)}`).join('')
              const last = s.values[s.values.length - 1]
              return (
                <g key={s.key} opacity={dim(s.key)} onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '6 5' : undefined} />
                  {s.values.map((v, k) => <circle key={k} cx={x(k + 1)} cy={y(v)} r={3.5} fill={s.dashed ? SURFACE : s.color} stroke={s.color} strokeWidth={2} />)}
                  {!narrow && (
                    <text x={m.l + iw + 14} y={ends[i]} dy="0.32em" fontSize={13} {...HALO}>
                      <tspan fill={LABEL}>{s.short}</tspan>
                      <tspan fill={AXIS} fontFamily={MONO} fontSize={12} dx={8}>{fmtScore(last)}</tspan>
                    </text>
                  )}
                </g>
              )
            })}
            <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setAt(null)} />
          </svg>
        )}
        {at !== null && (
          <Tooltip x={x(at)} y={m.t} w={w}>
            <div className="mb-1 text-fg">Pull {at}</div>
            {[...series].sort((a, b) => b.values[at - 1] - a.values[at - 1]).map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3 text-fg-muted">
                <span className="flex items-center gap-2">
                  <svg width={14} height={8} aria-hidden><line x1={0} x2={14} y1={4} y2={4} stroke={s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? '3 2' : undefined} /></svg>
                  {s.label}
                </span>
                <span className="num font-mono text-fg">{fmtScore(s.values[at - 1])}</span>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Cost vs score
// ---------------------------------------------------------------------------
interface Box { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export function CostScatter({ results }: { results: Results }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const pts = results.leaderboard
    .filter((r) => r.mythicbench_score != null)
    .map((r) => ({ key: r.model, label: modelName(r.model), color: modelColor(results, r.model), cost: costPerRun(r, results) ?? 0, score: r.mythicbench_score!, ci: r.mythicbench_score_ci95 ?? null }))
  const paid = pts.map((p) => p.cost).filter((c) => c > 0)
  const cLo = paid.length ? Math.min(...paid) / 2 : 0.01
  const cHi = paid.length ? Math.max(...paid) * 2 : 100
  const xticks: number[] = []
  for (let e = Math.floor(Math.log10(cLo)); e <= Math.ceil(Math.log10(cHi)); e++) {
    for (const f of [1, 3]) { const v = f * 10 ** e; if (v >= cLo && v <= cHi) xticks.push(v) }
  }
  const [lo, hi] = scoreDomain(pts.flatMap((p) => p.ci ? [p.ci[0], p.ci[1]] : [p.score]), 10, 1)
  const narrow = w < 520
  const H = narrow ? 300 : 340
  const m = { l: 40, r: 20, t: 16, b: 36 }
  const iw = Math.max(1, w - m.l - m.r)
  const ih = H - m.t - m.b
  const x = (c: number) => m.l + ((Math.log10(Math.max(c, cLo)) - Math.log10(cLo)) / (Math.log10(cHi) - Math.log10(cLo))) * iw
  const y = (v: number) => m.t + ih - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * ih
  const tick = (d: number) => '$' + (d < 1 ? d.toFixed(d < 0.1 ? 2 : 1) : d.toLocaleString('en-US'))

  // Each label beside its own dot: right, else left, else above, else below,
  // whichever overlaps no other dot and no label already placed.
  const placed: (Box & { anchor: 'start' | 'end' })[] = []
  const dots: Box[] = pts.map((p) => ({ x: x(p.cost) - 7, y: y(p.score) - 7, w: 14, h: 14 }))
  for (const [i, p] of pts.entries()) {
    const cx = x(p.cost), cy = y(p.score)
    const bw = Math.max(textW(p.label), textW(`${fmtScore(p.score)}  ${fmtUsd(p.cost)}`, 12)) + 4
    const bh = 32
    const tries: (Box & { anchor: 'start' | 'end' })[] = [
      { x: cx + 12, y: cy - bh / 2, w: bw, h: bh, anchor: 'start' },
      { x: cx - 12 - bw, y: cy - bh / 2, w: bw, h: bh, anchor: 'end' },
      { x: cx - bw / 2, y: cy - 12 - bh, w: bw, h: bh, anchor: 'start' },
      { x: cx - bw / 2, y: cy + 12, w: bw, h: bh, anchor: 'start' },
    ]
    const fits = (b: Box) => b.x >= m.l && b.x + b.w <= w - 4 && b.y >= 0 && b.y + b.h <= m.t + ih
      && !dots.some((d, j) => j !== i && overlaps(b, d)) && !placed.some((q) => overlaps(b, q))
    placed.push(tries.find(fits) ?? tries[0])
  }

  return (
    <figure className="m-0">
      <figcaption className="sr-only">MythicBench score against the cost of one +10 group, by model</figcaption>
      <div ref={ref} className="relative">
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label="Score against cost per group">
            {ticks(lo, hi).map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke={GRID} />
                <text x={m.l - 10} y={y(v)} dy="0.32em" textAnchor="end" fill={AXIS} fontSize={11} fontFamily={MONO}>{v}</text>
              </g>
            ))}
            {xticks.map((d) => (
              <g key={d}>
                <line x1={x(d)} x2={x(d)} y1={m.t} y2={m.t + ih} stroke={GRID} />
                <text x={x(d)} y={H - 12} textAnchor="middle" fill={AXIS} fontSize={11} fontFamily={MONO}>{tick(d)}</text>
              </g>
            ))}
            {pts.map((p, i) => {
              const b = placed[i]
              const tx = b.anchor === 'start' ? b.x : b.x + b.w
              return (
                <g key={p.key} opacity={hover && hover !== p.key ? 0.25 : 1} onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)}>
                  {p.ci && <line x1={x(p.cost)} x2={x(p.cost)} y1={y(p.ci[0])} y2={y(p.ci[1])} stroke={p.color} strokeWidth={2} opacity={0.45} strokeLinecap="round" />}
                  <circle cx={x(p.cost)} cy={y(p.score)} r={14} fill="transparent" />
                  <circle cx={x(p.cost)} cy={y(p.score)} r={6} fill={p.color} stroke={SURFACE} strokeWidth={2} />
                  <text x={tx} y={b.y + 12} textAnchor={b.anchor} fill={LABEL} fontSize={13} {...HALO}>{p.label}</text>
                  <text x={tx} y={b.y + 28} textAnchor={b.anchor} fill={AXIS} fontSize={12} fontFamily={MONO} {...HALO}>{fmtScore(p.score)}  {fmtUsd(p.cost)}</text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Every group's score, by model: the raw data behind the leaderboard
// ---------------------------------------------------------------------------
export function GroupScores({ results }: { results: Results }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const head = headlineTier(results)
  const rows = results.leaderboard.filter((r) => r.mythicbench_score != null).map((r) => ({
    key: r.model, label: modelName(r.model), color: modelColor(results, r.model), mean: r.mythicbench_score!,
    ci: r.mythicbench_score_ci95 ?? null, groups: r.tiers[head]?.episode_scores ?? [],
  }))
  const [lo, hi] = scoreDomain(rows.flatMap((r) => [...r.groups, ...(r.ci ?? [])]))
  const narrow = w < 560
  const rowH = 40
  const m = { l: Math.max(...rows.map((r) => textW(r.label)), 60) + 22, r: narrow ? 12 : 132, t: 8, b: 30 }
  const H = m.t + rows.length * rowH + m.b
  const iw = Math.max(1, w - m.l - m.r)
  const x = (v: number) => m.l + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * iw
  return (
    <figure className="m-0">
      <figcaption className="sr-only">Each group's score on {tierName(results, head)}, with each model's mean and 95% interval</figcaption>
      <div ref={ref}>
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label="Group scores by model">
            {ticks(lo, hi).map((v) => (
              <g key={v}>
                <line x1={x(v)} x2={x(v)} y1={m.t} y2={H - m.b} stroke={GRID} />
                <text x={x(v)} y={H - 10} textAnchor="middle" fill={AXIS} fontSize={11} fontFamily={MONO}>{v}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cy = m.t + i * rowH + rowH / 2
              return (
                <g key={r.key}>
                  <text x={m.l - 14} y={cy} dy="0.32em" textAnchor="end" fill={LABEL} fontSize={13}>{r.label}</text>
                  {r.ci && <rect x={x(r.ci[0])} y={cy - 5} width={Math.max(2, x(r.ci[1]) - x(r.ci[0]))} height={10} rx={5} fill={r.color} opacity={0.22} />}
                  {r.groups.map((g, k) => <circle key={k} cx={x(g)} cy={cy} r={4} fill={r.color} opacity={0.8} stroke={SURFACE} strokeWidth={1} />)}
                  <rect x={x(r.mean) - 1.5} y={cy - 12} width={3} height={24} rx={1.5} fill="#ededef" />
                  {!narrow && (
                    <text x={w - 8} y={cy} dy="0.32em" textAnchor="end" fontSize={12} fontFamily={MONO}>
                      <tspan fill="#ededef">{fmtScore(r.mean)}</tspan>
                      <tspan fill={AXIS}>{r.ci ? `  ${fmtScore(r.ci[0])}–${fmtScore(r.ci[1])}` : ''}</tspan>
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </figure>
  )
}
