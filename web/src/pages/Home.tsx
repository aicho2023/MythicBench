import { ArrowRight } from 'lucide-react'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { CostScatter, LearningCurves } from '../site/charts'
import { LeaderboardTable } from '../site/Leaderboard'
import { Page } from '../site/Layout'
import { tierName, type Results } from '../site/results'
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
  return (
    <p className="rounded-xl border border-line bg-surface px-4 py-3 text-[13px] leading-5 text-fg-muted">
      <span className="text-fg">Sample data.</span> These numbers come from the <span className="font-mono text-[12px]">{results.protocol.name}</span> protocol:
      a mock model that makes no API calls, and the scripted bots. They exist so the site can be built and checked.
      The official run of seven models replaces them on launch.
    </p>
  )
}

export function Home() {
  const { results, error } = useResults()
  return (
    <Page>
      {/* Hero: the question and two actions, the live crypt beside them */}
      <section className="grid items-center gap-10 py-12 md:py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <div>
          <h1 className="max-w-[560px] text-[32px] font-normal leading-[1.12] text-fg sm:text-[44px] sm:leading-[1.08] sm:tracking-[-0.02em] xl:text-[52px]">
            Can an AI lead a Mythic+ group through a dungeon it has never seen?
          </h1>
          <p className="mt-6 max-w-[520px] text-[17px] leading-7 text-fg-muted">
            Five AI agents, one per character, run the Gravecrown Crypt: two trash packs, then Mortisar, on one
            timer. They go in blind. After each wipe they read the combat log, talk it over, each write their own
            notes, and pull again, up to five times.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/watch" className="btn btn-primary h-11 px-5 text-[14px]">Watch a run</Link>
            <Link to="/paper" className="btn h-11 px-5 text-[14px]">Read the paper</Link>
          </div>
        </div>
        <figure className="m-0">
          <Link to="/watch?replay=expert-clear" aria-label="Open this replay in the viewer"
            className="group relative block aspect-[16/10] overflow-hidden rounded-2xl border border-line bg-[#0d0a18]">
            <Suspense fallback={null}><Teaser /></Suspense>
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-lg border border-line bg-[rgba(15,15,16,0.88)] px-3 py-2 text-[13px] text-fg transition-colors group-hover:bg-surface-raised">
              Open in the viewer <ArrowRight size={16} className="text-fg-muted" />
            </span>
          </Link>
          <figcaption className="mt-3 text-[13px] leading-5 text-fg-faint">
            Scripted expert bots clearing the +10, a reference run. Every model pull is replayable the same way
          </figcaption>
        </figure>
      </section>

      {error && <p className="py-8 text-[14px] text-bad">{error}</p>}
      {results && <Results results={results} />}
    </Page>
  )
}

function Results({ results }: { results: Results }) {
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
            {p.episodes} blind episodes of up to {p.max_pulls} pulls on each tier, effort {p.effort}, harness {results.harness_version}
          </p>
        </div>
        <div className="mt-6"><LeaderboardTable results={results} /></div>
        <HowToRead>
          A model's MythicBench score is the mean of its Normal and +10 progression scores. A progression score
          averages every pull of an episode on a 0 to 100 scale, where 70 and up is a clear, and a clear counts
          again for each pull it saved, so clearing sooner scores higher. The bar is the 95% confidence interval
          across episodes: where two bars overlap, the order of those two models isn't settled. Cost per run is
          what one blind episode on each tier costs at list prices. Click a model to watch its pulls.
        </HowToRead>
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
          Each solid line is one model's mean score at each pull, across episodes. A line that climbs means the
          notes it wrote after a wipe helped on the next pull; each pull uses a new seed, so it can't just
          memorize timings. A dashed line in a model's color is its memory-off control, which plays the same
          pulls with its notes wiped. The grey dashed rules are the scripted bots, which don't learn, and the
          dotted rule at 70 is the line between a wipe and a clear.
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
            Each dot is a model: its MythicBench score against what one run costs, on a log scale. Up and to the left is better value. A model that clears early also
            costs less, because it plays fewer pulls. Costs are list prices for the tokens each run used, with
            every reply recorded, so replaying a run is free.
          </HowToRead>
        </div>
      </section>
    </>
  )
}
