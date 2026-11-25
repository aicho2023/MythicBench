// Charts drawn as plain SVG: few marks, muted grid, mono numbers, and a direct
// label on every series. Axes zoom to the data (every score here sits between
// about 20 and 55, so a 0-100 axis would flatten the differences that matter).
import { useMemo, useState } from 'react'
import { modelName } from '../content/display'
import {
  botRow, clearLeaders, costPerRun, fmtScore, fmtUsd, headlineTier, modelColor, tierName, type CI, type Results,
} from './results'
import { Tip } from './Tooltip'
import { useWidth } from './useWidth'
import { COLOR } from './tokens'

const GRID = 'rgba(255,255,255,0.07)'
const AXIS = COLOR.fgFaint
const LABEL = COLOR.fg
const SURFACE = COLOR.surface
/** A halo in the surface color behind chart labels, so lines never cut through text. */
const HALO = { stroke: SURFACE, strokeWidth: 5, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const }
const MONO = 'IBM Plex Mono'


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
const textW = (s: string, px = 13) => s.length * px * 0.6

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
  const ink = color ?? (accent ? COLOR.accent : COLOR.fg)
  return (
    <svg width={width} height={H} className="block shrink-0" aria-hidden>
      <rect x={4} y={H / 2 - 1} width={width - 8} height={2} rx={1} fill="rgba(255,255,255,0.08)" />
      <rect x={x(a)} y={H / 2 - 3} width={Math.max(2, x(b) - x(a))} height={6} rx={3} fill={ink} opacity={0.28} />
      {dots.map((d, i) => <circle key={i} cx={x(d)} cy={H / 2} r={2.6} fill={ink} opacity={0.75} />)}
      <rect x={x(mean) - 1.5} y={1} width={3} height={H - 2} rx={1.5} fill={COLOR.fg} />
    </svg>
  )
}

/** Tick labels for a CIBar track, to sit in a table header above it. */
export function CIAxis({ width = 160, lo, hi, step = 10 }: { width?: number; lo: number; hi: number; step?: number }) {
  const x = (v: number) => (v - lo) / (hi - lo) * (width - 8) + 4
  return (
    <svg width={width} height={12} className="block overflow-visible" aria-hidden>
      {ticks(lo, hi, step).map((v) => (
        <text key={v} x={x(v)} y={10} textAnchor="middle" fill={AXIS} fontSize={10} fontFamily={MONO}>{v}</text>
      ))}
    </svg>
  )
}

/** Axis titles: y above its tick column (read horizontally), x centred under its ticks. */
function AxisTitles({ y, x, ml, iw, H }: { y?: string; x?: string; ml: number; iw: number; H: number }) {
  return (
    <g aria-hidden>
      {y && <text x={0} y={11} fill={AXIS} fontSize={12}>{y}</text>}
      {x && <text x={ml + iw / 2} y={H - 4} textAnchor="middle" fill={AXIS} fontSize={12}>{x}</text>}
    </g>
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
interface Series { key: string; label: string; short: string; color: string; values: number[]; dashed?: boolean; muted?: boolean }
/** Lines for models that aren't the point of a chart: one grey, so the few in colour read at a glance. */
const MUTED = COLOR.off

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
    // Colour only the models a paired test separates from the rest; the others share one grey
    // (hover or the tooltip still names each). With no clear leaders, every model keeps its colour.
    const leaders = clearLeaders(results)
    const muteRest = leaders.size > 0 && leaders.size < results.leaderboard.length
    const models: Series[] = results.leaderboard.flatMap((row) => {
      const c = row.tiers[tier]?.curve_mean
      const name = modelName(row.model)
      const muted = muteRest && !leaders.has(row.model)
      return c?.length ? [{ key: row.model, label: name, short: name, color: modelColor(results, row.model), values: c, muted }] : []
    })
    // The scripted bot, drawn first so it sits behind: the level a model that doesn't learn stays at.
    const bot = botRow(results)?.tiers[tier]?.curve_mean
    return bot?.length ? [{ key: 'bot', label: 'Scripted bot', short: 'Scripted bot', color: AXIS, values: bot, dashed: true }, ...models] : models
  }, [results, tier, view])
  const ink = (s: Series) => (s.muted && hover !== s.key ? MUTED : s.color)
  const legend = useMemo(() => {
    const muted = series.filter((s) => s.muted)
    if (!muted.length) return series
    const rest = { key: 'rest', label: `The other ${muted.length} models`, color: MUTED }
    return [...series.filter((s) => !s.muted && !s.dashed), rest, ...series.filter((s) => s.dashed)]
  }, [series])

  const [lo, hi] = scoreDomain(series.flatMap((s) => s.values))
  const narrow = w < 620
  const labelW = Math.max(0, ...series.map((s) => textW(`${s.short}  00.0`))) + 20
  const H = narrow ? 304 : 364
  const m = { l: 40, r: narrow ? 16 : labelW, t: 30, b: 54 }
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
      {narrow && <Legend items={legend} />}
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
              <text key={k} x={x(k)} y={m.t + ih + 20} textAnchor="middle" fill={AXIS} fontSize={11} fontFamily={MONO}>{k}</text>
            ))}
            <AxisTitles y={view === 'memory' ? 'Mean score, same seeds' : 'Mean score'} x="Pull" ml={m.l} iw={iw} H={H} />
            {view === 'models' && pulls > 1 && (
              <g aria-hidden>
                <rect x={x(1)} y={m.t} width={x(2) - x(1)} height={ih} fill="rgba(230,211,163,0.05)" />
                <text x={(x(1) + x(2)) / 2} y={m.t + 14} textAnchor="middle" fill={COLOR.accent} fillOpacity={0.75} fontSize={11} fontFamily={MONO}>
                  {narrow ? 'debrief' : 'the first debrief'}
                </text>
              </g>
            )}
            {at !== null && <line x1={x(at)} x2={x(at)} y1={m.t} y2={m.t + ih} stroke="rgba(255,255,255,0.18)" />}
            {series.map((s, i) => {
              const d = s.values.map((v, k) => `${k ? 'L' : 'M'}${x(k + 1)},${y(v)}`).join('')
              const last = s.values[s.values.length - 1]
              return (
                <g key={s.key} opacity={dim(s.key)} onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}>
                  <path d={d} fill="none" stroke={ink(s)} strokeWidth={s.dashed ? 1.5 : 2.5} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '6 5' : undefined} />
                  {!s.dashed && s.values.map((v, k) => <circle key={k} cx={x(k + 1)} cy={y(v)} r={3.5} fill={ink(s)} stroke={ink(s)} strokeWidth={2} />)}
                  {!narrow && (
                    <text x={m.l + iw + 14} y={ends[i]} dy="0.32em" fontSize={13} {...HALO}>
                      <tspan fill={s.muted || s.dashed ? AXIS : LABEL}>{s.short}</tspan>
                      <tspan fill={AXIS} fontFamily={MONO} fontSize={12} dx={8}>{fmtScore(last)}</tspan>
                    </text>
                  )}
                </g>
              )
            })}
            {/* pointerdown too: a tap on a touch screen fires no move, and should show that pull's values */}
            <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setAt(null)} />
          </svg>
        )}
        {at !== null && (
          <Tip x={x(at)} y={m.t} w={w} place="side">
            <div className="mb-1 text-fg">Pull {at}</div>
            {[...series].sort((a, b) => b.values[at - 1] - a.values[at - 1]).map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3 text-fg-muted">
                <span className="flex items-center gap-2">
                  <svg width={14} height={8} aria-hidden><line x1={0} x2={14} y1={4} y2={4} stroke={s.muted ? MUTED : s.color} strokeWidth={2.5} strokeDasharray={s.dashed ? '3 2' : undefined} /></svg>
                  {s.label}
                </span>
                <span className="num font-mono text-fg">{fmtScore(s.values[at - 1])}</span>
              </div>
            ))}
          </Tip>
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
  // The scripted bot: what fixed rules score, the level the models that didn't learn sit at.
  const bot = results.bot_score ?? (results.baselines ?? []).find((b) => b.mythicbench_score != null)?.mythicbench_score ?? null
  const paid = pts.map((p) => p.cost).filter((c) => c > 0)
  const cLo = paid.length ? Math.min(...paid) / 2 : 0.01
  const cHi = paid.length ? Math.max(...paid) * 2 : 100
  const xticks: number[] = []
  for (let e = Math.floor(Math.log10(cLo)); e <= Math.ceil(Math.log10(cHi)); e++) {
    for (const f of [1, 3]) { const v = f * 10 ** e; if (v >= cLo && v <= cHi) xticks.push(v) }
  }
  const [lo, hi] = scoreDomain([...pts.flatMap((p) => p.ci ? [p.ci[0], p.ci[1]] : [p.score]), ...(bot != null ? [bot] : [])], 10, 1)
  const narrow = w < 520
  const H = narrow ? 300 : 380
  const m = { l: 40, r: 20, t: 20, b: 54 }
  const iw = Math.max(1, w - m.l - m.r)
  const ih = H - m.t - m.b
  const x = (c: number) => m.l + ((Math.log10(Math.max(c, cLo)) - Math.log10(cLo)) / (Math.log10(cHi) - Math.log10(cLo))) * iw
  const y = (v: number) => m.t + ih - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * ih
  const tick = (d: number) => '$' + (d < 1 ? d.toFixed(d < 0.1 ? 2 : 1) : d.toLocaleString('en-US'))

  // The two leaders, when they can't be told apart on score but differ a lot in cost: say so on the chart.
  const [a, b] = [...pts].sort((p, q) => q.score - p.score)
  const pair = a && b ? (results.pairwise ?? []).find((q) => (q.a === a.key && q.b === b.key) || (q.a === b.key && q.b === a.key)) : undefined
  const [cheap, dear] = a && b ? (a.cost <= b.cost ? [a, b] : [b, a]) : []
  const ratio = cheap && dear && cheap.cost > 0 ? dear.cost / cheap.cost : 0
  const note = !narrow && cheap && dear && pair && !pair.claim && ratio >= 2
    ? { x1: x(cheap.cost), x2: x(dear.cost), y: y(Math.max(cheap.ci?.[1] ?? cheap.score, dear.ci?.[1] ?? dear.score)) - 10,
        text: `${Math.round(ratio)}× the cost, no clear difference in score` }
    : null

  // Each name beside its own dot: right, else left, else above, else below,
  // whichever overlaps no other dot, label or the note.
  const placed: (Box & { anchor: 'start' | 'end' })[] = []
  const dots: Box[] = pts.map((p) => ({ x: x(p.cost) - 7, y: y(p.score) - 7, w: 14, h: 14 }))
  const blocked: Box[] = note ? [{ x: Math.min(note.x1, note.x2), y: note.y - 22, w: Math.abs(note.x2 - note.x1), h: 26 }] : []
  for (const [i, p] of pts.entries()) {
    const cx = x(p.cost), cy = y(p.score)
    const bw = textW(p.label) + 4
    const bh = 18
    const tries: (Box & { anchor: 'start' | 'end' })[] = [
      { x: cx + 11, y: cy - bh / 2, w: bw, h: bh, anchor: 'start' },
      { x: cx - 11 - bw, y: cy - bh / 2, w: bw, h: bh, anchor: 'end' },
      { x: cx - bw / 2, y: cy - 10 - bh, w: bw, h: bh, anchor: 'start' },
      { x: cx - bw / 2, y: cy + 10, w: bw, h: bh, anchor: 'start' },
    ]
    const fits = (q: Box) => q.x >= m.l && q.x + q.w <= w - 4 && q.y >= 0 && q.y + q.h <= m.t + ih
      && !dots.some((d, j) => j !== i && overlaps(q, d)) && !placed.some((o) => overlaps(q, o)) && !blocked.some((o) => overlaps(q, o))
    const inside = (q: Box) => q.x >= 0 && q.x + q.w <= w - 2 && q.y >= 0 && q.y + q.h <= m.t + ih
    placed.push(tries.find(fits) ?? tries.find(inside) ?? tries[0])
  }
  const tip = pts.find((p) => p.key === hover)

  return (
    <figure className="m-0">
      <figcaption className="sr-only">MythicBench score against the cost of one +10 group, by model</figcaption>
      {narrow && (
        <ul className="mb-3 grid gap-1 text-[13px] text-fg-muted">
          {[...pts].sort((p, q) => q.score - p.score).map((p) => (
            <li key={p.key} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
              <span className="text-fg">{p.label}</span>
              <span className="ml-auto font-mono text-[12px]">{fmtScore(p.score)}<span className="ml-3 text-fg-faint">{fmtUsd(p.cost)}</span></span>
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label="Score against cost per group">
            {ticks(lo, hi).map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke={GRID} />
                <text x={m.l - 10} y={y(v)} dy="0.32em" textAnchor="end" fill={AXIS} fontSize={11} fontFamily={MONO}>{v}</text>
              </g>
            ))}
            {xticks.map((d) => (
              <text key={d} x={x(d)} y={m.t + ih + 20} textAnchor="middle" fill={AXIS} fontSize={11} fontFamily={MONO}>{tick(d)}</text>
            ))}
            <AxisTitles y="MythicBench score" x={narrow ? 'Cost per group (log scale)' : 'Cost per group of up to five pulls, list prices (log scale)'} ml={m.l} iw={iw} H={H} />
            {bot != null && (
              <g>
                <line x1={m.l} x2={m.l + iw} y1={y(bot)} y2={y(bot)} stroke={AXIS} strokeDasharray="4 4" opacity={0.6} />
                {/* Right end, under the line: the cheap models crowd the left end at this level. */}
                <text x={m.l + iw - 4} y={y(bot) + 15} textAnchor="end" fill={AXIS} fontSize={12} {...HALO}>{narrow ? 'Bot' : 'Scripted bot'}, {fmtScore(bot)}</text>
              </g>
            )}
            {note && (
              <g>
                <line x1={note.x1} x2={note.x2} y1={note.y} y2={note.y} stroke={AXIS} strokeWidth={1} />
                <line x1={note.x1} x2={note.x1} y1={note.y - 4} y2={note.y + 4} stroke={AXIS} />
                <line x1={note.x2} x2={note.x2} y1={note.y - 4} y2={note.y + 4} stroke={AXIS} />
                <text x={(note.x1 + note.x2) / 2} y={note.y - 8} textAnchor="middle" fill={LABEL} fontSize={12} {...HALO}>{note.text}</text>
              </g>
            )}
            {pts.map((p, i) => {
              const box = placed[i]
              const tx = box.anchor === 'start' ? box.x : box.x + box.w
              return (
                <g key={p.key} opacity={hover && hover !== p.key ? 0.25 : 1} onPointerEnter={() => setHover(p.key)}>
                  {p.ci && <line x1={x(p.cost)} x2={x(p.cost)} y1={y(p.ci[0])} y2={y(p.ci[1])} stroke={p.color} strokeWidth={2} opacity={0.3} strokeLinecap="round" />}
                  <circle cx={x(p.cost)} cy={y(p.score)} r={16} fill="transparent" />
                  <circle cx={x(p.cost)} cy={y(p.score)} r={6} fill={p.color} stroke={SURFACE} strokeWidth={2} />
                  {!narrow && <text x={tx} y={box.y + 13} textAnchor={box.anchor} fill={LABEL} fontSize={13} {...HALO}>{p.label}</text>}
                </g>
              )
            })}
          </svg>
        )}
        {tip && !narrow && (
          <Tip x={x(tip.cost)} y={y(tip.score) - 6} w={w}>
            <div className="text-fg">{tip.label}</div>
            <div className="mt-0.5 flex justify-between font-mono text-[12px] text-fg-muted">
              <span>Score {fmtScore(tip.score)}</span><span>{fmtUsd(tip.cost)} per group</span>
            </div>
            {tip.ci && <div className="font-mono text-[12px] text-fg-faint">95% interval {fmtScore(tip.ci[0])} to {fmtScore(tip.ci[1])}</div>}
          </Tip>
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
  const m = { l: Math.max(...rows.map((r) => textW(r.label)), 60) + 22, r: narrow ? 12 : 132, t: 8, b: 50 }
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
                <text x={x(v)} y={H - m.b + 18} textAnchor="middle" fill={AXIS} fontSize={11} fontFamily={MONO}>{v}</text>
              </g>
            ))}
            <AxisTitles x="Group score (mean of its pulls)" ml={m.l} iw={iw} H={H} />
            {rows.map((r, i) => {
              const cy = m.t + i * rowH + rowH / 2
              return (
                <g key={r.key}>
                  <text x={m.l - 14} y={cy} dy="0.32em" textAnchor="end" fill={LABEL} fontSize={13}>{r.label}</text>
                  {r.ci && <rect x={x(r.ci[0])} y={cy - 5} width={Math.max(2, x(r.ci[1]) - x(r.ci[0]))} height={10} rx={5} fill={r.color} opacity={0.22} />}
                  {r.groups.map((g, k) => <circle key={k} cx={x(g)} cy={cy} r={4} fill={r.color} opacity={0.8} stroke={SURFACE} strokeWidth={1} />)}
                  <rect x={x(r.mean) - 1.5} y={cy - 12} width={3} height={24} rx={1.5} fill={COLOR.fg} />
                  {!narrow && (
                    <text x={w - 8} y={cy} dy="0.32em" textAnchor="end" fontSize={12} fontFamily={MONO}>
                      <tspan fill={COLOR.fg}>{fmtScore(r.mean)}</tspan>
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
