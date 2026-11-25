import { ArrowRight } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { HighlightCard, isRankedGroup } from './Highlights'
import { HIGHLIGHTS } from '../content/highlights'
import { PyreGrid } from '../site/PyreGrid'
import { useInsights } from '../site/PullGrid'
import { CostScatter, LearningCurves } from '../site/charts'
import { LeaderboardTable } from '../site/Leaderboard'
import { Page } from '../site/Layout'
import { HERO_WINDOW_S } from '../site/config'
import { tierName, topPull, type Results } from '../site/results'
import { modelName } from '../content/display'
import { Link } from '../site/router'
import { useResults } from '../site/useResults'

const Teaser = lazy(() => import('../site/Teaser'))

/** True from tablet width up: only then does the hero load the live 3D clip. */
function useWide(): boolean {
  const q = '(min-width: 768px)'
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

/**
 * True once the page has loaded and the browser is idle. The hero's 3D clip (three.js, the
 * character models and a replay: several MB) waits for this, so the text, leaderboard and charts
 * come first and the still image stands in until then. Data-saver browsers keep the still.
 */
function useIdleAfterLoad(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
    let idle = 0
    let timer = 0
    const go = () => {
      if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(() => setReady(true), { timeout: 3000 })
      else timer = setTimeout(() => setReady(true), 1000) as unknown as number
    }
    if (document.readyState === 'complete') go()
    else window.addEventListener('load', go, { once: true })
    return () => {
      window.removeEventListener('load', go)
      if (idle) cancelIdleCallback(idle)
      clearTimeout(timer)
    }
  }, [])
  return ready
}

export function Home() {
  const { results, error } = useResults()
  // The hero shows the top model's best +10 pull once there are results (see site/Teaser.tsx).
  const top = results ? topPull(results) : null
  const wide = useWide()
  const idle = useIdleAfterLoad()
  return (
    <Page>
      {/* Hero: the question and two actions, the live crypt beside them */}
      <section className="grid items-center gap-10 py-12 md:py-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <div>
          <h1 className="max-w-[560px] text-[32px] font-normal leading-[1.12] text-fg sm:text-[44px] sm:leading-[1.08] sm:tracking-[-0.02em] xl:text-[52px]">
            Can five AI agents learn to clear an MMORPG dungeon?
          </h1>
          <p className="mt-6 max-w-[520px] text-[17px] leading-7 text-fg-muted">
            We've all been there. Your character's corpse lies on the ground, alongside the rest of your group. Time is
            running out, and you've probably thought, "Even bots would be better than my teammates." Well, it's time
            to put that to the test. Introducing: MythicBench. We wanted to see if seven AI models could learn how to clear a
            Mythic-style dungeon, all by themselves.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/watch" className="btn btn-primary h-11 px-5 text-[14px]">Watch a run</Link>
            <Link to="/report" className="btn h-11 px-5 text-[14px]">Read the report</Link>
          </div>
        </div>
        <figure className="m-0">
          <Link to={top ? `${top.path}?t=${HERO_WINDOW_S[0]}` : '/watch'} aria-label="Open this replay in the viewer"
            className="group relative block aspect-[16/10] overflow-hidden rounded-2xl border border-line bg-scene">
            {/* A still from the same pull: the poster while the 3D clip loads, and all phones get (no WebGL download) */}
            <img src={`${import.meta.env.BASE_URL}stills/closest.jpg`} alt="" className="absolute inset-0 h-full w-full object-cover" />
            {wide && idle && <Suspense fallback={null}><Teaser /></Suspense>}
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-lg border border-line bg-[rgba(15,15,16,0.88)] px-3 py-2 text-[13px] text-fg transition-colors group-hover:bg-surface-raised">
              Open in the viewer <ArrowRight size={16} className="text-fg-muted" />
            </span>
          </Link>
        </figure>
      </section>

      {error && <p className="py-8 text-[14px] text-bad">{error}</p>}
      {results && <Results results={results} />}
    </Page>
  )
}

/**
 * How a score is made, before any score is shown: a paragraph, and one bar
 * for what "how far the party got" means. The numbers are the scoring rule's
 * (sim/mythicsim/metrics.py: dungeon_score, PROGRESS_WEIGHTS); the marker is
 * the top model's best +10 pull, from the insights file.
 */
function Scoring({ results }: { results: Results }) {
  const insights = useInsights()
  const top = results.leaderboard[0]
  const pulls = (insights?.models[top?.model ?? ''] ?? []).filter((g) => g.ranked).flatMap((g) => g.pulls)
  const best = pulls.length ? pulls.reduce((a, b) => (b.score > a.score ? b : a)) : null
  const far = best ? best.score / 70 : null // a wipe scores 70 x how far it got
  const segs: [string, number][] = [['Pack 1', 15], ['Pack 2', 15], ['Oruth, the boss', 70]]
  return (
    <section id="scoring" className="pt-20">
      <SectionHead title="Scoring formula" />
      <p className="mt-3 max-w-[760px] text-[17px] leading-7 text-fg-muted">
        Each attempt at the dungeon is called a pull, and every pull scores 0 to 100. A pull that ends in a wipe
        earns up to 70, depending on how far the party got. A clear earns 70, plus up to 30 the faster it finishes,
        and counts again for every pull it saved. A model's score is the average of all its pulls: six groups of
        five, on +10, the hardest difficulty.
      </p>
      <div className="mt-8 max-w-[960px]">
        <p className="text-[14px] text-fg-muted">How far the party got is measured in health taken off. Each pack is worth 15%, Oruth 70%.</p>
        <div className="relative mt-3">
          <div className="flex h-9 overflow-hidden rounded-lg text-[12px]">
            {segs.map(([name, w], i) => (
              <div key={name} className="flex items-center justify-center border-r-2 border-bg last:border-r-0"
                style={{ width: `${w}%`, background: i < 2 ? 'rgba(255,255,255,0.07)' : 'rgba(208,70,59,0.22)' }}>
                <span className="truncate px-2 text-fg-muted">{name}, {w}%</span>
              </div>
            ))}
          </div>
          {far != null && <div className="absolute -bottom-1 top-[-4px] w-[2px] rounded bg-fg" style={{ left: `${far * 100}%` }} aria-hidden />}
        </div>
        {far != null && best && (
          <p className="mt-3 text-[14px] leading-6 text-fg-muted">
            The white line is <span className="text-fg">{top.name || modelName(top.model)}'s best pull</span>. It killed
            both packs and got Oruth down to {best.boss?.toFixed(1)}%, which is {(far * 100).toFixed(1)}% of the way,
            so it scored 70 × {far.toFixed(3)} = {best.score.toFixed(1)}.
          </p>
        )}
      </div>
    </section>
  )
}

function Results({ results }: { results: Results }) {
  if (!results.leaderboard.length) return null
  return <ResultsBody results={results} />
}

function SectionHead({ title, caption, link, children }: { title: string; caption?: string; link?: [string, string]; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-[760px]">
        <h2 className="text-[20px] font-medium leading-7 text-fg">{title}</h2>
        {caption && <p className="mt-1 text-[15px] leading-6 text-fg-muted">{caption}</p>}
      </div>
      {children}
      {link && (
        <Link to={link[0]} className="flex items-center gap-1.5 text-[13px] text-fg-muted transition-colors hover:text-fg">
          {link[1]} <ArrowRight size={14} />
        </Link>
      )}
    </div>
  )
}

function ResultsBody({ results }: { results: Results }) {
  const tiers = Object.keys(results.tiers)
  const [tier, setTier] = useState(tiers.includes('plus10') ? 'plus10' : tiers[0])
  return (
    <>

      <Scoring results={results} />

      <section id="leaderboard" className="pt-20">
        <SectionHead title="Leaderboard" link={['/report#results', 'Report']} />
        <div className="mt-8"><LeaderboardTable results={results} /></div>
      </section>

      <section className="pt-20">
        <SectionHead title="After five pulls, only Opus and Sol had clearly improved their scores"
          caption="Average score on each pull, 1 to 5, over each model's six groups."
          link={['/report#learning', 'Report']}>
          {tiers.length > 1 && (
            <div className="seg" role="group" aria-label="Difficulty">
              {tiers.map((t) => <button key={t} aria-pressed={tier === t} onClick={() => setTier(t)}>{tierName(results, t)}</button>)}
            </div>
          )}
        </SectionHead>
        <div className="mt-8">
          <LearningCurves results={results} tier={tier} />
        </div>
      </section>

      <section className="pt-20">
        <SectionHead title="Only Opus and Sol learned to stand in the fire"
          caption="Bone Pyre is the boss's key mechanic. A circle appears on the floor, and when it goes off, the blast hits the whole party unless two players are standing in it. Each square below is one Pyre, colored by how many players stood inside."
          link={['/report#pyre', 'Report']} />
        <div className="mt-8">
          <PyreGrid results={results} />
        </div>
      </section>

      <section className="pt-20">
        <SectionHead title="Sol scores like Opus at a fifth of the cost"
          caption="Each model's score against what one group costs to run, at list prices."
          link={['/report#cost', 'Report']} />
        <div className="mt-8">
          <CostScatter results={results} />
        </div>
      </section>

      {HIGHLIGHTS.length > 0 && (
        <section className="pt-20">
          <SectionHead title="Highlights" link={['/highlights', `All ${HIGHLIGHTS.length}`]} />
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {HIGHLIGHTS.filter(isRankedGroup).slice(0, 3).map((h) => <HighlightCard key={h.id} h={h} compact />)}
          </div>
        </section>
      )}
    </>
  )
}
