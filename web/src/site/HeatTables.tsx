// Heat tables over the ranked +10 groups: a row per model, a cell per column,
// shaded on the pull grid's ramp (dark = little, bright = a lot) with the value
// written in. Two views: how much of Bone Pyre each model soaked at each pull,
// and what killed its characters.
// Data: web/public/insights/v1.json (scripts/build_insights.py).
import { useRef, useState, type ReactNode } from 'react'
import { modelName } from '../content/display'
import { heat, useInsights, type GroupFacts, type Insights } from './PullGrid'
import { modelColor, type Results } from './results'
import { Tip } from './Tooltip'
import { COLOR } from './tokens'

interface Cell { v: number | null; text: string; tip: ReactNode }
interface Column { key: string; head: string; short?: string; sub?: string }
interface Row { model: string; cells: Cell[]; extra?: string }

/** "Claude Sonnet 5.5" -> "Sonnet 5.5", "GPT-6.2 Sol" -> "Sol": for phones. */
const shortName = (model: string) => modelName(model).replace(/^Claude /, '').replace(/^GPT-[\d.]+ /, '')

/** Dark ink on bright cells, light ink on dark ones. */
function inkOn(rgb: string): string {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).map(Number)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? COLOR.surface : COLOR.fg
}

function HeatTable({ results, columns, rows, extraHead, max = 1, caption, corner }: {
  results: Results; columns: Column[]; rows: Row[]; extraHead?: string; max?: number; caption: string
  /** A word over the row labels on phones, naming the short column headings ("Pull"). */
  corner?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ r: number; c: number; x: number; y: number } | null>(null)
  return (
    <figure className="m-0">
      <div ref={box} className="relative overflow-x-auto" onPointerLeave={() => setTip(null)}>
        <table className="heat w-full table-fixed border-separate" style={{ borderSpacing: 3 }}>
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col className="w-[84px] sm:w-[176px]" />
            {columns.map((c) => <col key={c.key} />)}
            {extraHead && <col className="hidden w-[104px] sm:table-column" />}
          </colgroup>
          <thead>
            <tr>
              <th className="pb-1 pr-3 text-left align-bottom text-[12px] font-normal text-fg-faint"><span className="sr-only">Model</span>{corner && <span aria-hidden className="block text-right text-[11px] text-fg-faint sm:hidden">{corner}</span>}</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="pb-1 text-center align-bottom font-normal">
                  <span className="hidden text-[12px] leading-4 text-fg-muted sm:block">{c.head}</span>
                  <span className="block text-[11px] leading-4 text-fg-muted sm:hidden">{c.short ?? c.head}</span>
                  {c.sub && <span className="hidden text-[11px] leading-4 text-fg-faint sm:block">{c.sub}</span>}
                </th>
              ))}
              {extraHead && <th scope="col" className="hidden pb-1 pl-2 text-right sm:table-cell align-bottom text-[12px] font-normal text-fg-muted">{extraHead}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.model}>
                <th scope="row" className="truncate pr-3 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: modelColor(results, row.model) }} aria-hidden />
                    <span className="hidden text-[14px] text-fg sm:inline">{modelName(row.model)}</span>
                    <span className="text-[13px] text-fg sm:hidden">{shortName(row.model)}</span>
                  </span>
                </th>
                {row.cells.map((cell, ci) => {
                  const bg = cell.v == null ? 'rgba(255,255,255,0.04)' : heat(cell.v / max)
                  return (
                    <td key={ci} tabIndex={0}
                      onPointerEnter={(e) => {
                        const b = box.current!.getBoundingClientRect()
                        const r = e.currentTarget.getBoundingClientRect()
                        setTip({ r: ri, c: ci, x: r.left - b.left + r.width / 2, y: r.top - b.top })
                      }}
                      className="h-11 rounded-[4px] text-center font-mono text-[13px] outline-none transition-shadow focus-visible:shadow-[0_0_0_2px_theme(colors.fg.DEFAULT)] sm:h-12"
                      style={{ background: bg, color: cell.v == null ? COLOR.off : inkOn(bg), boxShadow: tip?.r === ri && tip.c === ci ? `0 0 0 2px ${COLOR.fg}` : undefined }}>
                      {cell.text}
                    </td>
                  )
                })}
                {row.extra != null && <td className="hidden whitespace-nowrap pl-3 text-right sm:table-cell font-mono text-[13px] text-fg-muted">{row.extra}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {tip && (
          <Tip x={tip.x} y={tip.y} w={box.current?.clientWidth ?? 0}>
            <div className="text-fg">{modelName(rows[tip.r].model)}</div>
            <div className="text-[12px] text-fg-muted">{rows[tip.r].cells[tip.c].tip}</div>
          </Tip>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-fg-muted">
        <span className="font-mono text-fg-faint">0%</span>
        <span className="h-2.5 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(heat).join(',')})` }} aria-hidden />
        <span className="font-mono text-fg-faint">{Math.round(max * 100)}%{max < 1 ? ' or more' : ''}</span>
      </div>
    </figure>
  )
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–')
function ranked(results: Results, data: Insights): { model: string; groups: GroupFacts[] }[] {
  return results.leaderboard
    .map((r) => ({ model: r.model, groups: (data.models[r.model] ?? []).filter((g) => g.ranked) }))
    .filter((r) => r.groups.length)
}

/** Share of Bone Pyres soaked (two or more players inside), by pull. */
export function SoakByPull({ results }: { results: Results }) {
  const data = useInsights()
  if (!data) return <div className="h-[300px]" />
  const pulls = results.protocol.max_pulls
  const columns: Column[] = Array.from({ length: pulls }, (_, i) => ({
    key: String(i + 1), head: `Pull ${i + 1}`, short: String(i + 1), sub: i === 0 ? 'blind' : i === 1 ? 'after one debrief' : undefined,
  }))
  const rows: Row[] = ranked(results, data).map(({ model, groups }) => {
    let all = 0, soaked = 0
    const cells = columns.map((_, k) => {
      const ps = groups.flatMap((g) => g.pulls.filter((p) => p.pull === k + 1))
      const n = ps.reduce((a, p) => a + p.pyres, 0)
      const s = ps.reduce((a, p) => a + p.soaked, 0)
      all += n; soaked += s
      return {
        v: n ? s / n : null, text: pct(s, n),
        tip: <>Pull {k + 1}: <span className="font-mono text-fg">{s} of {n}</span> Bone Pyres soaked, over {ps.length} groups</>,
      }
    })
    return { model, cells, extra: pct(soaked, all) }
  })
  return (
    <HeatTable results={results} columns={columns} rows={rows} extraHead="All pulls" corner="Pull"
      caption="Share of Bone Pyres soaked by two or more players, by model and pull, over each model's six ranked +10 groups" />
  )
}

/** What killed each model's characters, as a share of its deaths. */
const CAUSES: { key: string; head: string; short: string; sub: string; ids: string[] }[] = [
  { key: 'pyre', head: 'Bone Pyre', short: 'Pyre', sub: 'the circle', ids: ['bone_pyre'] },
  { key: 'pools', head: 'Desecrate', short: 'Pools', sub: 'floor pools', ids: ['desecrate', 'restless_grave'] },
  { key: 'boss', head: 'Oruth’s hits', short: 'Oruth', sub: 'on the tank', ids: ['hollow_strike', 'soul_rend'] },
  { key: 'adds', head: 'Adds', short: 'Adds', sub: 'undead melee', ids: ['bone_claw'] },
]

export function DeathCauses({ results }: { results: Results }) {
  const data = useInsights()
  if (!data) return <div className="h-[300px]" />
  const columns: Column[] = [...CAUSES.map(({ key, head, short, sub }) => ({ key, head, short, sub })), { key: 'other', head: 'Other', sub: 'everything else' }]
  const name = (id: string) => data.abilities?.[id] ?? id
  const rows: Row[] = ranked(results, data).map(({ model, groups }) => {
    const by: Record<string, number> = {}
    let pulls = 0
    for (const g of groups) for (const p of g.pulls) {
      pulls++
      for (const [id, n] of Object.entries(p.killed_by ?? {})) by[id] = (by[id] ?? 0) + n
    }
    const total = Object.values(by).reduce((a, b) => a + b, 0)
    const known = new Set(CAUSES.flatMap((c) => c.ids))
    const cells = [
      ...CAUSES.map((c) => c.ids),
      Object.keys(by).filter((id) => !known.has(id)),
    ].map((ids, k) => {
      const n = ids.reduce((a, id) => a + (by[id] ?? 0), 0)
      const parts = ids.filter((id) => by[id]).sort((a, b) => by[b] - by[a])
      return {
        v: total ? n / total : null, text: pct(n, total),
        tip: <><span className="font-mono text-fg">{n} of {total}</span> deaths{k === CAUSES.length && parts.length ? `: ${parts.map((id) => `${name(id)} ${by[id]}`).join(', ')}` : ''}</>,
      }
    })
    return { model, cells, extra: (total / Math.max(1, pulls)).toFixed(1) }
  })
  return (
    <HeatTable results={results} columns={columns} rows={rows} extraHead="Deaths per pull" max={0.6}
      caption="What killed each model's characters, as a share of its deaths, over its six ranked +10 groups" />
  )
}
