import { ChevronRight } from 'lucide-react'
import { modelName } from '../content/display'
import { CIBar } from './charts'
import {
  BOT_NAMES, botHeadline, costPerRun, episodeHeadlines, fmtPct, fmtScore, fmtUsd, headlineTier, labName, modelColor, tierName,
  type LeaderboardRow, type Results,
} from './results'
import { navigate } from './router'

/** Mean pulls to clear +10 over the episodes that cleared, with how many did. */
function pullsToClear(r: Results, row: LeaderboardRow, tier: string): { text: string; title: string } {
  const cell = row.tiers[tier]
  if (!cell) return { text: '–', title: 'Not played' }
  const cleared = cell.pulls_to_clear.filter((p): p is number => p !== null && p <= r.protocol.max_pulls)
  if (!cleared.length) return { text: 'Not cleared', title: `No episode cleared within ${r.protocol.max_pulls} pulls` }
  const mean = cleared.reduce((a, b) => a + b, 0) / cleared.length
  return { text: mean.toFixed(1), title: `Mean over the ${cleared.length} of ${cell.episodes} episodes that cleared` }
}

function effectText(v: number | undefined) {
  return v === undefined ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`
}

function effectTitle(cell: LeaderboardRow['tiers'][string] | undefined) {
  if (cell?.learning_effect === undefined) return 'No memory-off control for this model'
  const ci = cell.learning_effect_ci95
  return `Memory on minus memory off${ci ? `, 95% CI ${ci[0]} to ${ci[1]}` : ''}`
}

const TH = 'h-10 px-3 text-left align-bottom pb-2 text-[12px] font-normal leading-4 text-fg-faint'
const TD = 'h-12 px-3 align-middle'
const NUM = 'num text-right font-mono text-[13px]'

export function LeaderboardTable({ results }: { results: Results }) {
  const tiers = Object.keys(results.tiers)
  const hard = headlineTier(results)
  const baselines = results.baselines ?? []
  const bots = Object.keys(BOT_NAMES).map((k) => ({ k, h: botHeadline(results, k) })).filter((b) => b.h)
  const lead = results.leaderboard.find((r) => r.rank !== null)?.model
  const hasEffect = results.leaderboard.some((r) => r.tiers[hard]?.learning_effect !== undefined)

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[300px] border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className={`${TH} pl-0`}>Model</th>
            <th className={TH} title={`The progression score on ${tierName(results, hard)}, the headline tier`}>MythicBench score ({tierName(results, hard)}) <span className="hidden sm:inline">and 95% CI</span></th>
            {tiers.map((t) => <th key={t} className={`${TH} hidden text-right md:table-cell`}>{tierName(results, t)}</th>)}
            <th className={`${TH} hidden text-right lg:table-cell`}>{tierName(results, hard)} clear rate</th>
            <th className={`${TH} hidden text-right lg:table-cell`}>Pulls to clear {tierName(results, hard)}</th>
            {hasEffect && <th className={`${TH} hidden text-right xl:table-cell`} title="Progression score with memory on minus memory off, same seeds">Learning effect {tierName(results, hard)}</th>}
            <th className={`${TH} hidden pr-0 text-right sm:table-cell`}>Cost per {tierName(results, hard)} episode</th>
            <th className="w-6" aria-hidden />
          </tr>
        </thead>
        <tbody>
          {results.leaderboard.map((row) => {
            const p = pullsToClear(results, row, hard)
            const go = () => navigate(`/watch/${encodeURIComponent(row.model)}`)
            return (
              <tr key={row.model} onClick={go} className="group cursor-pointer border-b border-line transition-colors hover:bg-white/[0.03]">
                <td className={`${TD} pl-0`}>
                  <a href={`/watch/${encodeURIComponent(row.model)}`} onClick={(e) => { if (!e.metaKey && !e.ctrlKey) e.preventDefault() }}
                    className="flex items-center gap-3 rounded">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: modelColor(results, row.model) }} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] leading-5 text-fg">{row.name || modelName(row.model)}</span>
                      <span className="block text-[12px] leading-4 text-fg-faint">{labName(row.provider)}{row.complete === false ? ', incomplete (not ranked)' : ''}</span>
                    </span>
                  </a>
                </td>
                <td className={TD}>
                  <span className="flex items-center gap-3">
                    <span className="num w-10 text-right font-mono text-[15px] text-fg">{fmtScore(row.mythicbench_score)}</span>
                    <span className="sm:hidden"><CIBar mean={row.mythicbench_score} ci={row.mythicbench_score_ci95} accent={row.model === lead} width={80} /></span>
                    <span className="hidden sm:block"><CIBar mean={row.mythicbench_score} ci={row.mythicbench_score_ci95} accent={row.model === lead} dots={episodeHeadlines(results, row)} /></span>
                  </span>
                </td>
                {tiers.map((t) => <td key={t} className={`${TD} ${NUM} hidden text-fg-muted md:table-cell`}>{fmtScore(row.tiers[t]?.progression_score)}</td>)}
                <td className={`${TD} ${NUM} hidden text-fg-muted lg:table-cell`}>{fmtPct(row.tiers[hard]?.clear_rate)}</td>
                <td className={`${TD} ${NUM} hidden text-fg-muted lg:table-cell`} title={p.title}>{p.text}</td>
                {hasEffect && <td className={`${TD} ${NUM} hidden text-fg-muted xl:table-cell`} title={effectTitle(row.tiers[hard])}>{effectText(row.tiers[hard]?.learning_effect)}</td>}
                <td className={`${TD} ${NUM} hidden pr-0 text-fg-muted sm:table-cell`}>{fmtUsd(costPerRun(row, results))}</td>
                <td className="w-6 text-fg-faint transition-colors group-hover:text-fg"><ChevronRight size={16} /></td>
              </tr>
            )
          })}
          {(bots.length > 0 || baselines.length > 0) && (
            <tr>
              <td colSpan={10} className="px-0 pb-2 pt-6 text-[12px] text-fg-faint">
                References on the same seeds, not ranked. The scripted commander gives fixed, obvious orders through the agents' own interface: a model has to beat it for its decisions to matter. The bots play the game directly at three skill levels. None of them learn
              </td>
            </tr>
          )}
          {baselines.map((row) => (
            <tr key={row.model} className="border-t border-line">
              <td className={`${TD} pl-0`}>
                <span className="flex items-center gap-3">
                  <span className="h-2 w-2 shrink-0 rounded-full border border-fg-faint" aria-hidden />
                  <span className="text-[14px] text-fg-muted">{row.name}</span>
                </span>
              </td>
              <td className={TD}>
                <span className="flex items-center gap-3">
                  <span className="num w-10 text-right font-mono text-[15px] text-fg-muted">{fmtScore(row.mythicbench_score)}</span>
                  <span className="opacity-70 sm:hidden"><CIBar mean={row.mythicbench_score} ci={row.mythicbench_score_ci95} width={80} /></span>
                  <span className="hidden opacity-70 sm:block"><CIBar mean={row.mythicbench_score} ci={row.mythicbench_score_ci95} dots={episodeHeadlines(results, row)} /></span>
                </span>
              </td>
              {tiers.map((t) => <td key={t} className={`${TD} ${NUM} hidden text-fg-faint md:table-cell`}>{fmtScore(row.tiers[t]?.progression_score)}</td>)}
              <td className={`${TD} ${NUM} hidden text-fg-faint lg:table-cell`}>{fmtPct(row.tiers[hard]?.clear_rate)}</td>
              <td className={`${TD} ${NUM} hidden text-fg-faint lg:table-cell`}>{pullsToClear(results, row, hard).text}</td>
              {hasEffect && <td className={`${TD} ${NUM} hidden text-fg-faint xl:table-cell`} title="Fixed rules don't learn">0</td>}
              <td className={`${TD} ${NUM} hidden pr-0 text-fg-faint sm:table-cell`}>$0</td>
              <td />
            </tr>
          ))}
          {bots.map(({ k, h }) => (
            <tr key={k} className="border-t border-line">
              <td className={`${TD} pl-0`}>
                <span className="flex items-center gap-3">
                  <span className="h-2 w-2 shrink-0 rounded-full border border-fg-faint" aria-hidden />
                  <span className="text-[14px] text-fg-muted">{BOT_NAMES[k]}</span>
                </span>
              </td>
              <td className={TD}>
                <span className="flex items-center gap-3">
                  <span className="num w-10 text-right font-mono text-[15px] text-fg-muted">{fmtScore(h!.score)}</span>
                  <span className="opacity-70 sm:hidden"><CIBar mean={h!.score} ci={h!.ci} width={80} /></span>
                  <span className="hidden opacity-70 sm:block"><CIBar mean={h!.score} ci={h!.ci} /></span>
                </span>
              </td>
              {tiers.map((t) => <td key={t} className={`${TD} ${NUM} hidden text-fg-faint md:table-cell`}>{fmtScore(results.bots?.[t]?.[k]?.progression_score_mean)}</td>)}
              <td className={`${TD} ${NUM} hidden text-fg-faint lg:table-cell`}>–</td>
              <td className={`${TD} ${NUM} hidden text-fg-faint lg:table-cell`}>–</td>
              {hasEffect && <td className={`${TD} ${NUM} hidden text-fg-faint xl:table-cell`} title="Bots don't learn">0</td>}
              <td className={`${TD} ${NUM} hidden pr-0 text-fg-faint sm:table-cell`}>$0</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
