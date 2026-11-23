import { ChevronRight } from 'lucide-react'
import { modelName } from '../content/display'
import { CIAxis, CIBar, scoreDomain } from './charts'
import {
  costPerRun, episodeHeadlines, fmtScore, fmtUsd, headlineTier, labName, modelColor, tierName,
  type LeaderboardRow, type Results,
} from './results'
import { navigate } from './router'

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
const STRIP = 200

export function LeaderboardTable({ results }: { results: Results }) {
  const hard = headlineTier(results)
  const T = tierName(results, hard)
  const baselines = results.baselines ?? []
  const rows = [...results.leaderboard, ...baselines]
  const [lo, hi] = scoreDomain(rows.flatMap((r) => [...(r.tiers[hard]?.episode_scores ?? []), ...(r.mythicbench_score_ci95 ?? [])]))
  const lead = results.leaderboard.find((r) => r.rank !== null)?.model

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className={`${TH} pl-0`}>Model</th>
            <th className={`${TH} text-right`}>Score</th>
            <th className={`${TH} hidden sm:table-cell`}>
              <span className="block pb-1">Each group, mean and 95% interval</span>
              <CIAxis width={STRIP} lo={lo} hi={hi} />
            </th>
            <th className={`${TH} hidden text-right md:table-cell`} title="Mean score of the first pull: blind, before any wipe">First pull</th>
            <th className={`${TH} hidden text-right md:table-cell`} title="The best single pull, and how much of Oruth's health was left when it ended">Best pull</th>
            <th className={`${TH} hidden text-right lg:table-cell`}>Clears</th>
            <th className={`${TH} hidden pr-0 text-right sm:table-cell`}>Cost per group</th>
            <th className="w-6" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cell = row.tiers[hard]
            const ref = baselines.includes(row)
            const best = bestPull(results, row)
            const go = () => !ref && navigate(`/watch/${encodeURIComponent(row.model)}`)
            const ink = ref ? 'text-fg-faint' : 'text-fg-muted'
            return (
              <tr key={row.model} onClick={go} className={`group border-b border-line transition-colors ${ref ? '' : 'cursor-pointer hover:bg-white/[0.03]'}`}>
                <td className={`${TD} pl-0`}>
                  <a href={ref ? undefined : `/watch/${encodeURIComponent(row.model)}`} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) e.preventDefault() }}
                    className="flex items-center gap-3 rounded">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ref ? 'transparent' : modelColor(results, row.model), border: ref ? '1px solid #8b8b93' : undefined }} aria-hidden />
                    <span className="min-w-0">
                      <span className={`block truncate text-[15px] leading-5 ${ref ? 'text-fg-muted' : 'text-fg'}`}>{row.name || modelName(row.model)}</span>
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
                <td className={`${TD} hidden sm:table-cell`}>
                  <span title={row.mythicbench_score_ci95 ? `95% interval ${fmtScore(row.mythicbench_score_ci95[0])} to ${fmtScore(row.mythicbench_score_ci95[1])}` : undefined}>
                    <CIBar mean={row.mythicbench_score} ci={row.mythicbench_score_ci95} dots={episodeHeadlines(results, row)}
                      lo={lo} hi={hi} width={STRIP} color={ref ? '#8b8b93' : modelColor(results, row.model)} accent={row.model === lead} />
                  </span>
                </td>
                <td className={`${TD} ${NUM} hidden md:table-cell ${ink}`}>{fmtScore(cell?.first_pull_score_mean)}</td>
                <td className={`${TD} ${NUM} hidden md:table-cell ${ink}`}>
                  {best ? fmtScore(best.score) : '–'}
                  {best?.bossLeft != null && <span className="block text-[11px] text-fg-faint">Oruth at {best.bossLeft}%</span>}
                </td>
                <td className={`${TD} ${NUM} hidden lg:table-cell ${ink}`}>{cell ? `${cell.clears ?? 0} of ${cell.episodes}` : '–'}</td>
                <td className={`${TD} ${NUM} hidden pr-0 sm:table-cell ${ink}`}>{ref ? '$0' : fmtUsd(costPerRun(row, results))}</td>
                <td className="w-6 text-fg-faint transition-colors group-hover:text-fg">{!ref && <ChevronRight size={16} />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[12px] leading-5 text-fg-faint">
        {T}, {results.protocol.episodes} groups per model. A white tick is the model's mean, the bar its 95% interval, each dot one group.
      </p>
    </div>
  )
}
