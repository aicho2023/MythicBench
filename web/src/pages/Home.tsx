import { ArrowRight } from 'lucide-react'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { CostScatter, LearningCurves } from '../site/charts'
import { LeaderboardTable } from '../site/Leaderboard'
import { Page } from '../site/Layout'
import { modelName, pullLabel } from '../content/display'
import { FEATURED } from '../site/config'
import { tierName, topPull, type Results } from '../site/results'
import { Link } from '../site/router'
import { useResults } from '../site/useResults'

const Teaser = lazy(() => import('../site/Teaser'))

export function HowToRead({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 max-w-[720px] border-t border-line pt-4 text-[13px] leading-5 text-fg-muted">
      <span className="text-fg">How to read this. </span>{children}
    </div>
  )
}

export function SampleNotice({ results }: { results: Results }) {
  if (results.protocol.name === 'v1') return null
  if (!results.leaderboard.length) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] leading-5 text-fg-muted">
        <span className="text-fg">Results are coming soon.</span> The official run of five models fills in the
        leaderboard and charts on launch.
      </p>
    )
  }
  return (
    <p className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] leading-5 text-fg-muted">
      <span className="text-fg">Sample data.</span> These numbers come from the <span className="font-mono text-[12px]">{results.protocol.name}</span> protocol:
      a mock model that makes no API calls, and the scripted commander. They exist so the site can be built and checked.
      The official run of five models replaces them on launch.
    </p>
  )
}

export function Home() {
  const { results, error } = useResults()
  // The hero shows the top model's best +10 pull once there are results (see site/Teaser.tsx).
  const top = results ? topPull(results) : null
  return (
    <Page>
      {/* Hero: the question and two actions, the live crypt beside them */}
      <section className="grid items-center gap-10 py-12 md:py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <div>
          <h1 className="max-w-[560px] text-[32px] font-normal leading-[1.12] text-fg sm:text-[44px] sm:leading-[1.08] sm:tracking-[-0.02em] xl:text-[52px]">
            Can an AI lead a Mythic+ group through a dungeon it has never seen?
          </h1>
          <p className="mt-6 max-w-[520px] text-[17px] leading-7 text-fg-muted">
            Five AI agents, one per character, run the Hollow Vault: two trash packs, then Oruth, on one
            timer. They go in blind, with no guide to the boss. After each wipe they read the combat log, talk it over, each write their own
            notes, and pull again, up to five times.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/watch" className="btn btn-primary h-11 px-5 text-[14px]">Watch a run</Link>
            <Link to="/commentary" className="btn h-11 px-5 text-[14px]">Read the commentary</Link>
          </div>
        </div>
        <figure className="m-0">
          <Link to={top?.path ?? `/watch?replay=${encodeURIComponent(FEATURED.id)}`} aria-label="Open this replay in the viewer"
            className="group relative block aspect-[16/10] overflow-hidden rounded-2xl border border-line bg-[#0d0a18]">
            <Suspense fallback={null}><Teaser /></Suspense>
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-lg border border-line bg-[rgba(15,15,16,0.88)] px-3 py-2 text-[13px] text-fg transition-colors group-hover:bg-surface-raised">
              Open in the viewer <ArrowRight size={16} className="text-fg-muted" />
            </span>
          </Link>
          <figcaption className="mt-3 text-[13px] leading-5 text-fg-faint">
            {top
              ? <>{modelName(top.model)}'s best pull on {tierName(results!, top.tier)} ({pullLabel(top.episode, top.pull)}). Every pull is replayable the same way</>
              : FEATURED.caption}
          </figcaption>
        </figure>
      </section>

      {error && <p className="py-8 text-[14px] text-bad">{error}</p>}
      {results && <Results results={results} />}
    </Page>
  )
}

function Results({ results }: { results: Results }) {
  if (!results.leaderboard.length) return <div className="pt-16"><SampleNotice results={results} /></div>
  return <ResultsBody results={results} />
}

function ResultsBody({ results }: { results: Results }) {
  const tiers = Object.keys(results.tiers)
  const [tier, setTier] = useState(tiers.includes('plus10') ? 'plus10' : tiers[0])
  const p = results.protocol
  return (
    <>
      <SampleNotice results={results} />

      <section id="leaderboard" className="pt-16">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-[20px] font-medium text-fg">Leaderboard</h2>
          <p className="text-[13px] text-fg-faint">
            {p.episodes} fresh groups per model, each with up to {p.max_pulls} pulls, effort {p.effort}, harness {results.harness_version}
          </p>
        </div>
        <div className="mt-6"><LeaderboardTable results={results} /></div>
        <HowToRead>
          Each model plays as several <b>groups</b>: a group is a fresh party that gets up to {p.max_pulls} <b>pulls</b> at
          the dungeon, talking it over and taking notes between pulls, and it's done once it clears in time. A
          model's MythicBench score is its average group score on +10 (Normal is a sanity check, not ranked on).
          A group's score averages its pulls on a 0 to 100 scale, where a clear within the timer scores 70 and up,
          and a clear counts again for each pull it saved, so clearing sooner scores higher.{(results.baselines ?? []).length > 0 && " The scripted commander below gives fixed, obvious orders through the same interface. It's one fixed policy: a reference point for what obvious rules do, not a ceiling or a floor."} The bar is the 95% confidence interval
          across groups, with a dot per group: where two bars overlap, the order of those two models isn't
          settled. Cost is what one group on +10 costs at list prices, thinking included. Click a model to watch its pulls.
        </HowToRead>
      </section>

      <section className="grid gap-8 pt-20 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-12">
        <div>
          <h2 className="text-[20px] font-medium text-fg">What a score costs</h2>
          <div className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
            <CostScatter results={results} />
          </div>
        </div>
        <div className="lg:pt-14">
          <HowToRead>
            Each dot is a model: its +10 score against what one +10 group costs, on a log scale. Up and to the
            left is better value. Every model runs at the same named reasoning effort (medium), but that setting
            buys different amounts of thinking from different providers, so cost is the fairer axis: where we
            also ran a model at low and high effort, its dashed line shows how its score moves with spend, on
            the same few groups at every effort (so its medium point sits apart from the six-group dot). A
            model that clears early costs less, because it plays fewer pulls. Costs are list prices for the
            tokens used, thinking included; every reply is recorded, so replaying a run is free.
          </HowToRead>
        </div>
      </section>

      <section className="pt-20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-[20px] font-medium text-fg">Does it learn between wipes?</h2>
          <div className="seg" role="group" aria-label="Tier">
            {tiers.map((t) => <button key={t} aria-pressed={tier === t} onClick={() => setTier(t)}>{tierName(results, t)}</button>)}
          </div>
        </div>
        <div className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <LearningCurves results={results} tier={tier} />
        </div>
        <HowToRead>
          Each solid line is one model's mean score at each pull, across its groups, with a group that cleared
          carrying its clearing score forward. It shows observed progression, not proof that the notes helped:
          that's what the memory-off control is for. A dashed line in a model's color is that control, which
          plays the same seeds with no talk and no notes between pulls; for those models both lines
          cover the same groups. The learning effect is the paired difference between the two, so it measures
          the talk and the notes together. Each pull uses a new seed, so a party can't just memorize timings. The grey dashed line is the scripted commander, which doesn't learn, and the
          dotted rule at 70 is the line between a wipe and a clear.
        </HowToRead>
      </section>


    </>
  )
}
