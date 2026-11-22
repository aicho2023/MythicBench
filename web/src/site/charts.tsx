// Charts drawn as plain SVG: few marks, muted grid, mono labels, a direct label
// on every series (seven hues can't all be told apart by color alone).
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { modelName } from '../content/display'
import {
  BOT_NAMES, botHeadline, costPerRun, fmtScore, fmtUsd, modelColor, tierName, type CI, type Results,
} from './results'

const GRID = 'rgba(255,255,255,0.06)'
const AXIS = '#8b8b93'
const BOT = '#6b6b73'
/** A halo in the surface color behind chart labels, so rules never cut through text. */
const HALO = { stroke: '#111113', strokeWidth: 4, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const }

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

const clamp100 = (x: number) => Math.max(0, Math.min(100, x))

// ---------------------------------------------------------------------------
// The signature: a 95% CI as a thin bar on a 0 to 100 track
// ---------------------------------------------------------------------------
export function CIBar({ mean, ci, accent = false, width = 120, dots = [] }: { mean: number | null; ci?: CI; accent?: boolean; width?: number; dots?: number[] }) {
  if (mean == null) return <span className="text-fg-faint">–</span>
  const x = (v: number) => (clamp100(v) / 100) * width
  const [lo, hi] = ci ?? [mean, mean]
  return (
    <svg width={width} height={12} className="block shrink-0" aria-hidden>
      <rect x={0} y={5} width={width} height={2} rx={1} fill="rgba(255,255,255,0.08)" />
      {/* one dot per episode: the raw data behind the interval */}
      {dots.map((d, i) => <circle key={i} cx={x(d)} cy={6} r={1.6} fill="rgba(237,237,239,0.55)" />)}
      <rect x={x(lo)} y={4} width={Math.max(2, x(hi) - x(lo))} height={4} rx={2} fill={accent ? 'rgba(230,211,163,0.45)' : 'rgba(237,237,239,0.28)'} />
      <rect x={x(mean) - 1} y={1} width={2} height={10} rx={1} fill={accent ? '#e6d3a3' : '#ededef'} />
    </svg>
  )
}

function Tooltip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(8, x + 12), w - 228)
  return (
    <div className="pointer-events-none absolute z-10 w-[220px] rounded-lg border border-line bg-surface-raised px-3 py-2 text-[12px] leading-5 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
      style={{ left, top: Math.max(0, y - 8) }}>
      {children}
    </div>
  )
}

export function Legend({ items, hover, setHover }: {
  items: { key: string; label: string; color: string; dashed?: boolean }[]
  hover: string | null; setHover: (k: string | null) => void
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-muted">
      {items.map((it) => (
        <li key={it.key} onMouseEnter={() => setHover(it.key)} onMouseLeave={() => setHover(null)}
          className={`flex cursor-default items-center gap-2 transition-opacity ${hover && hover !== it.key ? 'opacity-40' : ''}`}>
          <svg width={16} height={8} aria-hidden>
            <line x1={0} x2={16} y1={4} y2={4} stroke={it.color} strokeWidth={2} strokeDasharray={it.dashed ? '3 3' : undefined} />
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Learning curves: mean score at each pull, one line per model
// ---------------------------------------------------------------------------
interface Series { key: string; label: string; color: string; values: number[]; dashed?: boolean }

export function LearningCurves({ results, tier }: { results: Results; tier: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const pulls = results.protocol.max_pulls
  const series: Series[] = useMemo(() => {
    const out: Series[] = []
    for (const row of results.leaderboard) {
      const c = row.tiers[tier]?.curve_mean
      if (c?.length) out.push({ key: row.model, label: modelName(row.model), color: modelColor(results, row.model), values: c })
    }
    for (const c of results.controls.filter((c) => c.tier === tier && c.curve_mean?.length)) {
      out.push({ key: `${c.model}:off`, label: `${modelName(c.model)}, memory off`, color: modelColor(results, c.model), values: c.curve_mean!, dashed: true })
    }
    return out
  }, [results, tier])
  const bots = Object.entries(results.bots?.[tier] ?? {}).map(([k, b]) => ({ key: `bot:${k}`, label: BOT_NAMES[k] ?? k, y: b.progression_score_mean }))

  const narrow = w < 560
  const H = narrow ? 260 : 340
  const m = { l: 36, r: narrow ? 12 : 168, t: 12, b: 32 }
  const iw = Math.max(1, w - m.l - m.r)
  const ih = H - m.t - m.b
  const x = (k: number) => m.l + (pulls === 1 ? iw / 2 : ((k - 1) / (pulls - 1)) * iw)
  const y = (v: number) => m.t + ih - (clamp100(v) / 100) * ih
  const ends = spread([...series.map((s) => y(s.values[s.values.length - 1])), ...bots.map((b) => y(b.y))], 16, m.t + 4, m.t + ih)
  const legend = [...series.map((s) => ({ key: s.key, label: s.label, color: s.color, dashed: s.dashed })),
    ...bots.map((b) => ({ key: b.key, label: b.label, color: BOT, dashed: true }))]
  const dim = (k: string) => (hover && hover !== k ? 0.2 : 1)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
    const px = e.clientX - r.left
    const k = pulls === 1 ? 1 : Math.round(((px - m.l) / iw) * (pulls - 1)) + 1
    setAt(Math.max(1, Math.min(pulls, k)))
  }

  return (
    <figure className="m-0">
      <figcaption className="sr-only">Mean score at each pull on {tierName(results, tier)}, by model</figcaption>
      <Legend items={legend} hover={hover} setHover={setHover} />
      <div ref={ref} className="relative mt-4">
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label={`Learning curves on ${tierName(results, tier)}`}>
            {[0, 25, 50, 70, 100].map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke={v === 70 ? 'rgba(255,255,255,0.14)' : GRID} strokeDasharray={v === 70 ? '2 4' : undefined} />
                <text x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fill={AXIS} fontSize={11} fontFamily="IBM Plex Mono">{v}</text>
              </g>
            ))}
            {Array.from({ length: pulls }, (_, i) => i + 1).map((k) => (
              <text key={k} x={x(k)} y={H - 10} textAnchor={narrow && k === pulls && pulls > 1 ? 'end' : 'middle'} fill={AXIS} fontSize={11} fontFamily="IBM Plex Mono">Pull {k}</text>
            ))}
            {bots.map((b, i) => (
              <g key={b.key} opacity={dim(b.key)}>
                <line x1={m.l} x2={m.l + iw} y1={y(b.y)} y2={y(b.y)} stroke={BOT} strokeWidth={1.5} strokeDasharray="4 4" />
                {!narrow && <text x={m.l + iw + 12} y={ends[series.length + i]} dy="0.32em" fill={AXIS} fontSize={12} {...HALO}>{b.label}</text>}
              </g>
            ))}
            {series.map((s, i) => {
              const d = s.values.map((v, k) => `${k ? 'L' : 'M'}${x(k + 1)},${y(v)}`).join('')
              return (
                <g key={s.key} opacity={dim(s.key)}>
                  <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
                  {s.values.map((v, k) => <circle key={k} cx={x(k + 1)} cy={y(v)} r={3} fill={s.color} stroke="#0a0a0c" strokeWidth={2} />)}
                  {!narrow && <text x={m.l + iw + 12} y={ends[i]} dy="0.32em" fill="#a1a1aa" fontSize={12} {...HALO}>{s.label}</text>}
                </g>
              )
            })}
            {at !== null && <line x1={x(at)} x2={x(at)} y1={m.t} y2={m.t + ih} stroke="rgba(255,255,255,0.2)" />}
            <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setAt(null)} />
          </svg>
        )}
        {at !== null && (
          <Tooltip x={x(at)} y={m.t} w={w}>
            <div className="text-fg">Pull {at}</div>
            {[...series].sort((a, b) => b.values[at - 1] - a.values[at - 1]).map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3 text-fg-muted">
                <span className="flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.label}</span></span>
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
// Cost vs score: what a run costs against what it scores
// ---------------------------------------------------------------------------
export function CostScatter({ results }: { results: Results }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const pts = results.leaderboard
    .filter((r) => r.mythicbench_score != null)
    .map((r) => ({ key: r.model, label: modelName(r.model), color: modelColor(results, r.model), cost: costPerRun(r) ?? 0, score: r.mythicbench_score! }))
  const paid = pts.map((p) => p.cost).filter((c) => c > 0)
  const lo = paid.length ? Math.min(...paid) / 2 : 0.01
  const hi = paid.length ? Math.max(...paid) * 2 : 100
  const decades = []
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) decades.push(10 ** e)
  const H = 300
  const m = { l: 36, r: 16, t: 12, b: 32 }
  const iw = Math.max(1, w - m.l - m.r)
  const ih = H - m.t - m.b
  const [d0, d1] = [Math.log10(decades[0]), Math.log10(decades[decades.length - 1])]
  // A free run (the mock model) sits on the left edge.
  const x = (c: number) => m.l + (c <= 0 ? 0 : ((Math.log10(c) - d0) / Math.max(1e-9, d1 - d0)) * iw)
  const y = (v: number) => m.t + ih - (clamp100(v) / 100) * ih
  const labelY = spread(pts.map((p) => y(p.score)), 16, m.t + 4, m.t + ih)
  const hp = pts.find((p) => p.key === hover)
  const bots = Object.keys(BOT_NAMES).map((k) => ({ k, h: botHeadline(results, k) })).filter((b) => b.h)
  const botY = spread(bots.map((b) => y(b.h!.score) - 6), 14, m.t + 4, m.t + ih)
  const tick = (d: number) => '$' + d.toLocaleString('en-US', { maximumFractionDigits: 3 })

  return (
    <figure className="m-0">
      <figcaption className="sr-only">MythicBench score against the cost of one run, by model</figcaption>
      <div ref={ref} className="relative">
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label="Cost against score">
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke={GRID} />
                <text x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fill={AXIS} fontSize={11} fontFamily="IBM Plex Mono">{v}</text>
              </g>
            ))}
            {decades.map((d) => (
              <text key={d} x={x(d)} y={H - 10} textAnchor="middle" fill={AXIS} fontSize={11} fontFamily="IBM Plex Mono">{tick(d)}</text>
            ))}
            {bots.map(({ k, h }, i) => (
              <g key={k}>
                <line x1={m.l} x2={m.l + iw} y1={y(h!.score)} y2={y(h!.score)} stroke={BOT} strokeDasharray="4 4" strokeWidth={1} />
                <text x={m.l + iw} y={botY[i]} textAnchor="end" fill={AXIS} fontSize={11} {...HALO}>{BOT_NAMES[k]} {fmtScore(h!.score)}</text>
              </g>
            ))}
            {pts.map((p, i) => (
              <g key={p.key} opacity={hover && hover !== p.key ? 0.25 : 1} onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)}>
                <circle cx={x(p.cost)} cy={y(p.score)} r={12} fill="transparent" />
                <circle cx={x(p.cost)} cy={y(p.score)} r={5} fill={p.color} stroke="#0a0a0c" strokeWidth={2} />
                <text x={x(p.cost) + (x(p.cost) > m.l + iw - 120 ? -10 : 10)} y={labelY[i]} dy="0.32em"
                  textAnchor={x(p.cost) > m.l + iw - 120 ? 'end' : 'start'} fill="#a1a1aa" fontSize={12} {...HALO}>{p.label}</text>
              </g>
            ))}
          </svg>
        )}
        {hp && (
          <Tooltip x={x(hp.cost)} y={y(hp.score)} w={w}>
            <div className="text-fg">{hp.label}</div>
            <div className="flex justify-between text-fg-muted">Score <span className="num font-mono text-fg">{fmtScore(hp.score)}</span></div>
            <div className="flex justify-between text-fg-muted">Cost per run <span className="num font-mono text-fg">{fmtUsd(hp.cost)}</span></div>
          </Tooltip>
        )}
      </div>
    </figure>
  )
}
