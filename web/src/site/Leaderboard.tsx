import { ChevronRight } from 'lucide-react'
import { modelName } from '../content/display'
import { CIAxis, CIBar, scoreDomain } from './charts'
import {
  costPerRun, episodeHeadlines, fmtScore, fmtUsd, headlineTier, labName, modelColor,
  type LeaderboardRow, type Results,
} from './results'
import { navigate } from './router'
import { COLOR } from './tokens'
import { useInsights } from './PullGrid'
import { useWidth } from './useWidth'

/** A pull's best score and, when it reached Oruth, how much of him was left (from the scoring rule). */
export function bestPull(r: Results, row: LeaderboardRow): { score: number; bossLeft: number | null } | null {
  const cell = row.tiers[headlineTier(r)]
  const scores = cell?.episode_list.flatMap((e) => e.pulls.map((p) => p.score)) ?? []
  if (!scores.length) return null
  const score = Math.max(...scores)
  // Below a clear, a pull scores 70 x progress, where both packs are 30% of
  // progress and Oruth's health removed the other 70%.
  const progress = score / 70
  const bossLeft = score < 70 && progress >= 0.3 ? Math.round(100 * (1 - (progress - 0.3) / 0.7)) : null
  return { score, bossLeft }
}

const TH = 'px-3 pb-3 text-left align-bottom text-[12px] font-medium leading-4 text-fg-muted'
const TD = 'h-14 px-3 align-middle'
const NUM = 'num text-right font-mono text-[14px]'
/** The dot plot takes what the fixed-width columns leave, within these bounds. */
const STRIP_MIN = 160
const STRIP_MAX = 440

/** A column heading: what it is, and in a second quieter line, what it measures. */
function Head({ name, sub }: { name: string; sub: string }) {
  return (
    <>
      <span className="block text-fg-muted">{name}</span>
      <span className="block whitespace-nowrap font-normal text-fg-faint">{sub}</span>
    </>
  )
}

/** Oruth's health bar at the end of a model's best pull. */
function BossLeft({ pct }: { pct: number }) {
  return (
    <span className="flex items-center justify-end gap-2.5" title={`Oruth had ${pct.toFixed(1)}% of his health left`}>
      <span className="h-1.5 w-[88px] overflow-hidden rounded-full bg-white/[0.08]">
        <span className="block h-full rounded-full bg-[#d0463b]" style={{ width: `${pct}%` }} />
      </span>
      <span className="num w-[44px] text-right font-mono text-[14px]">{pct.toFixed(1)}%</span>
    </span>
  )
}

export function LeaderboardTable({ results }: { results: Results }) {
  const hard = headlineTier(results)
  // Models only: the scripted bot is a reference line on the charts, not a row here.
  const baselines: LeaderboardRow[] = []
  const rows = results.leaderboard
  const [lo, hi] = scoreDomain(rows.flatMap((r) => [...(r.tiers[hard]?.episode_scores ?? []), ...(r.mythicbench_score_ci95 ?? [])]))
  const lead = results.leaderboard.find((r) => r.rank !== null)?.model
  // A column of "0 of 6" says nothing the page doesn't: it appears once any model clears.
  const anyClear = results.leaderboard.some((r) => (r.tiers[hard]?.clears ?? 0) > 0)
  // Oruth's health at the end of each model's best try on the ranked tier (web/public/insights).
  const insights = useInsights()
  const closest = (model: string): number | null => {
    const left = (insights?.models[model] ?? []).filter((g) => g.ranked).flatMap((g) => g.pulls.map((p) => p.boss)).filter((b): b is number => b != null)
    return left.length ? Math.min(...left) : null
  }
  const [stripRef, stripW] = useWidth()
  const STRIP = Math.min(STRIP_MAX, Math.max(STRIP_MIN, stripW))

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[210px] pb-1 pl-0`}>Model</th>
            <th className={`${TH} w-[104px] pb-1 text-right`}><Head name="Score" sub="0 to 100" /></th>
            <th className={`${TH} hidden pb-1 pl-8 text-right sm:table-cell`}><span className="block" style={{ width: STRIP }}><Head name="Each group's score" sub="one dot per group" /></span></th>
            <th className={`${TH} hidden w-[190px] pb-1 text-right md:table-cell`}><Head name="Oruth's health" sub="at the end of the best pull" /></th>
            <th className={`${TH} hidden w-[150px] pb-1 text-right lg:table-cell`}><Head name="First pull" sub="before any learning" /></th>
            {anyClear && <th className={`${TH} hidden w-[88px] pb-1 text-right lg:table-cell`}><Head name="Clears" sub="of six groups" /></th>}
            <th className={`${TH} hidden w-[112px] pb-1 pr-0 text-right sm:table-cell`}><Head name="Cost" sub="per group" /></th>
            <th className="w-6" aria-hidden />
          </tr>
          {/* The dot plot's scale, on its own line so every heading above sits on one baseline */}
          <tr className="border-b border-line" aria-hidden>
            <th className="pl-0" />
            <th />
            <th className="hidden pb-2 pl-8 sm:table-cell">
              <div ref={stripRef} className="w-full"><CIAxis width={STRIP} lo={lo} hi={hi} /></div>
            </th>
            <th className="hidden md:table-cell" />
            <th className="hidden lg:table-cell" />
            {anyClear && <th className="hidden lg:table-cell" />}
            <th className="hidden sm:table-cell" />
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cell = row.tiers[hard]
            const ref = baselines.includes(row)
            const go = () => !ref && navigate(`/watch/${encodeURIComponent(row.model)}`)
            const ink = ref ? 'text-fg-faint' : 'text-fg-muted'
            return (
              <tr key={row.model} onClick={go} className={`group border-b border-line transition-colors ${ref ? '' : 'cursor-pointer hover:bg-white/[0.03]'}`}>
                <td className={`${TD} pl-0`}>
                  <a href={ref ? undefined : `/watch/${encodeURIComponent(row.model)}`} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) e.preventDefault() }}
                    className="flex items-center gap-3 rounded">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ref ? 'transparent' : modelColor(results, row.model), border: ref ? `1px solid ${COLOR.fgFaint}` : undefined }} aria-hidden />
                    <span className="min-w-0">
                      <span className={`block truncate text-[15px] leading-5 ${ref ? 'text-fg-muted' : 'text-fg'}`}>{row.provider === 'scripted' ? 'Scripted bot' : row.name || modelName(row.model)}</span>
                      <span className="block text-[12px] leading-4 text-fg-faint">{ref ? 'Reference, not ranked' : labName(row.provider)}</span>
                    </span>
                  </a>
                </td>
                <td className={`${TD} text-right`}>
                  <span className={`num font-mono text-[17px] ${ref ? 'text-fg-muted' : 'text-fg'}`}>{fmtScore(row.mythicbench_score)}</span>
                  <span className="block font-mono text-[11px] text-fg-faint sm:hidden">
                    {row.mythicbench_score_ci95 ? `${fmtScore(row.mythicbench_score_ci95[0])}–${fmtScore(row.mythicbench_score_ci95[1])}` : ''}
                  </span>
                </td>
                <td className={`${TD} hidden pl-8 sm:table-cell`}>
                  <span title={row.mythicbench_score_ci95 ? `95% interval ${fmtScore(row.mythicbench_score_ci95[0])} to ${fmtScore(row.mythicbench_score_ci95[1])}` : undefined}>
                    <CIBar mean={row.mythicbench_score} ci={row.mythicbench_score_ci95} dots={episodeHeadlines(results, row)}
                      lo={lo} hi={hi} width={STRIP} color={ref ? COLOR.fgFaint : modelColor(results, row.model)} accent={row.model === lead} />
                  </span>
                </td>
                <td className={`${TD} ${NUM} hidden md:table-cell ${ink}`}>{ref || closest(row.model) == null ? '–' : <BossLeft pct={closest(row.model)!} />}</td>
                <td className={`${TD} ${NUM} hidden lg:table-cell ${ink}`}>{fmtScore(cell?.first_pull_score_mean)}</td>
                {anyClear && <td className={`${TD} ${NUM} hidden lg:table-cell ${ink}`}>{cell ? `${cell.clears ?? 0} of ${cell.episodes}` : '–'}</td>}
                <td className={`${TD} ${NUM} hidden pr-0 sm:table-cell ${ink}`}>{ref ? '$0' : fmtUsd(costPerRun(row, results))}</td>
                <td className="w-6 text-fg-faint transition-colors group-hover:text-fg">{!ref && <ChevronRight size={16} />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

