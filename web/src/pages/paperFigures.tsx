// Figures for the paper: the same components and data as the home page.
import { useState, type ReactNode } from 'react'
import { CostScatter, LearningCurves } from '../site/charts'
import { LeaderboardTable } from '../site/Leaderboard'
import { tierName } from '../site/results'
import { useResults } from '../site/useResults'
import { SampleNotice } from './Home'

function Figure({ n, caption, children }: { n: number; caption: ReactNode; children: ReactNode }) {
  return (
    <figure className="not-prose my-10 xl:-mx-32">
      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-6">{children}</div>
      <figcaption className="mt-3 text-[13px] leading-5 text-fg-muted"><span className="text-fg">Figure {n}.</span> {caption}</figcaption>
    </figure>
  )
}

export function PaperLeaderboard() {
  const { results, error } = useResults()
  if (error) return <p className="text-bad">{error}</p>
  if (!results) return null
  return (
    <>
      <div className="not-prose my-6"><SampleNotice results={results} /></div>
      <Figure n={1} caption="MythicBench score (the +10 progression score) with its 95% interval, per-tier scores, +10 clear rate, pulls to clear +10 over the episodes that cleared, and the list-price cost of one episode on each tier. The scripted commander and the scripted bots on the same seeds below.">
        <LeaderboardTable results={results} />
      </Figure>
    </>
  )
}

export function PaperCurves() {
  const { results } = useResults()
  const [tier, setTier] = useState('plus10')
  if (!results) return null
  const tiers = Object.keys(results.tiers)
  const t = tiers.includes(tier) ? tier : tiers[0]
  return (
    <Figure n={2} caption={<>Mean score at each pull on {tierName(results, t)}, by model. Dashed lines in a model's color are memory-off controls; grey dashed rules are the scripted bots; the dotted rule at 70 separates wipes from clears.</>}>
      <div className="mb-4 flex justify-end">
        <div className="seg" role="group" aria-label="Tier">
          {tiers.map((x) => <button key={x} aria-pressed={t === x} onClick={() => setTier(x)}>{tierName(results, x)}</button>)}
        </div>
      </div>
      <LearningCurves results={results} tier={t} />
    </Figure>
  )
}

export function PaperScatter() {
  const { results } = useResults()
  if (!results) return null
  return (
    <Figure n={3} caption="MythicBench score against the list-price cost of one run (one blind episode on each tier), log scale.">
      <CostScatter results={results} />
    </Figure>
  )
}

/** A section still to be written. */
export function Draft({ children }: { children: ReactNode }) {
  return (
    <p className="not-prose my-6 rounded-xl border border-dashed border-white/15 px-4 py-3 text-[14px] leading-6 text-fg-faint">
      <span className="text-fg-muted">To be written.</span> {children}
    </p>
  )
}
