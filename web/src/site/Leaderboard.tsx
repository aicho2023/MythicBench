import { ChevronRight } from 'lucide-react'
import { modelName } from '../content/display'
import { CIAxis, CIBar, scoreDomain } from './charts'
import {
  botRow, costPerRun, episodeHeadlines, fmtScore, fmtUsd, headlineTier, labName, modelColor,
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
/** The dot plot's narrowest width; it takes whatever the other columns leave. */
const STRIP_MIN = 160
/** Columns that hug their content, so the space goes to the dot plot. */
const TIGHT = 'w-px whitespace-nowrap'

export function LeaderboardTable({ results }: { results: Results }) {
  const hard = headlineTier(results)
  // The reference rows: every baseline when they're shown, else just the scripted bot, which the
  // results are read against ("level with the bot").
  const bot = botRow(results)
  const baselines = results.baselines?.length ? results.baselines : bot ? [bot] : []
  const rows = [...results.leaderboard, ...baselines]
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
  const STRIP = Math.max(STRIP_MIN, stripW - 24)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className={`${TH} ${TIGHT} pl-0`}>Model</th>
            <th className={`${TH} ${TIGHT} text-right`}>Score</th>
            <th className={`${TH} hidden w-full pl-6 sm:table-cell`}>
              <div ref={stripRef} className="w-full">
                <span className="block pb-1">Each group, with the 95% interval</span>
                <CIAxis width={STRIP} lo={lo} hi={hi} />
              </div>
            </th>
            <th className={`${TH} hidden text-right md:table-cell`}><span className="inline-block w-[92px]">Closest to killing Oruth</span></th>
            <th className={`${TH} ${TIGHT} hidden text-right lg:table-cell`}>First pull</th>
            {anyClear && <th className={`${TH} ${TIGHT} hidden text-right lg:table-cell`}>Clears</th>}
            <th className={`${TH} hidden pr-0 text-right sm:table-cell`}><span className="inline-block w-[64px]">Cost per group</span></th>
            <th className="w-6" aria-hidden />
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
                <td className={`${TD} hidden pl-6 sm:table-cell`}>
                  <span title={row.mythicbench_score_ci95 ? `95% interval ${fmtScore(row.mythicbench_score_ci95[0])} to ${fmtScore(row.mythicbench_score_ci95[1])}` : undefined}>
                    <CIBar mean={row.mythicbench_score} ci={row.mythicbench_score_ci95} dots={episodeHeadlines(results, row)}
                      lo={lo} hi={hi} width={STRIP} color={ref ? COLOR.fgFaint : modelColor(results, row.model)} accent={row.model === lead} />
                  </span>
                </td>
                <td className={`${TD} ${NUM} hidden md:table-cell ${ink}`}>{ref || closest(row.model) == null ? '–' : `${closest(row.model)!.toFixed(1)}% left`}</td>
                <td className={`${TD} ${NUM} hidden lg:table-cell ${ink}`}>{fmtScore(cell?.first_pull_score_mean)}</td>
                {anyClear && <td className={`${TD} ${NUM} hidden lg:table-cell ${ink}`}>{cell ? `${cell.clears ?? 0} of ${cell.episodes}` : '–'}</td>}
                <td className={`${TD} ${NUM} hidden pr-0 sm:table-cell ${ink}`}>{ref ? '$0' : fmtUsd(costPerRun(row, results))}</td>
                <td className="w-6 text-fg-faint transition-colors group-hover:text-fg">{!ref && <ChevronRight size={16} />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <LeaderboardKey />
    </div>
  )
}

/** What each column means, in words visible on every device (hover tooltips don't exist on touch). */
function LeaderboardKey() {
  // [term, meaning, the breakpoint its column shows from]
  const items: [string, string, string?][] = [
    ['Dots and bar', 'each dot is one group\'s score; the bar is the 95% interval, the white tick the average.', 'hidden sm:block'],
    ['Closest to killing Oruth', 'his health at the end of the model\'s best pull. No model got him to zero.', 'hidden md:block'],
    ['First pull', 'the blind first attempt, before any wipe to learn from.', 'hidden lg:block'],
    ['Cost per group', 'one group of up to five pulls, at list prices, thinking included.', 'hidden sm:block'],
    ['Scripted bot', 'fixed rules played through the same controls: it interrupts and steps out of pools, and never learns.'],
  ]
  return (
    <dl className="mt-4 max-w-[760px] space-y-1.5 text-[13px] leading-5 text-fg-faint">
      {items.map(([k, v, show]) => (
        <div key={k} className={show}><dt className="inline text-fg-muted">{k}: </dt><dd className="inline">{v}</dd></div>
      ))}
    </dl>
  )
}
