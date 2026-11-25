import { ArrowRight } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { HighlightCard } from './Highlights'
import { HIGHLIGHTS } from '../content/highlights'
import { PyreGrid } from '../site/PyreGrid'
import { CostScatter, LearningCurves } from '../site/charts'
import { LeaderboardTable } from '../site/Leaderboard'
import { Page } from '../site/Layout'
import { HERO_WINDOW_S } from '../site/config'
import { tierName, topPull, type Results } from '../site/results'
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
            Can five AI agents learn from a wipe?
          </h1>
          <p className="mt-6 max-w-[520px] text-[17px] leading-7 text-fg-muted">
            Five AI agents, each playing one character, team up to clear a dungeon in a game like World of Warcraft:
            two groups of monsters, then a boss, against the clock. They go in blind. When the whole party dies (a
            wipe), they read the combat log, talk it over, write their own notes, and try again, up to five times.
          </p>
          {results?.protocol.name === 'v1' && (
            <p className="mt-5 max-w-[520px] border-l-2 border-accent pl-4 text-[17px] leading-7 text-fg">
              Across 480 attempts by seven models from four labs, no AI team cleared the dungeon. But Claude Opus 5.5 and GPT-6.2 Sol each worked out how
              to survive the boss's party-wide blast in every one of their groups: two players have to stand inside the
              circle. <Link to="/report#pyre" className="underline decoration-accent/50 underline-offset-4 hover:decoration-accent">The other five almost never did.</Link>
            </p>
          )}
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
            {top && (
              <span className="absolute left-3 top-3 max-w-[calc(100%-24px)] rounded-lg border border-line bg-[rgba(15,15,16,0.88)] px-3 py-1.5 text-[13px] leading-5 text-fg">
                Watch for the glowing circle: players step inside to split the blast.
              </span>
            )}
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

function Results({ results }: { results: Results }) {
  if (!results.leaderboard.length) return null
  return <ResultsBody results={results} />
}

function SectionHead({ title, link, children }: { title: string; link?: [string, string]; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <h2 className="text-[20px] font-medium text-fg">{title}</h2>
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
  const p = results.protocol
  return (
    <>

      <section id="leaderboard" className="pt-20">
        <SectionHead title="Leaderboard" link={['/report#results', 'Results in the report']}>
          <p className="text-[13px] text-fg-faint sm:ml-auto">
            {tierName(results, 'plus10')}, {p.episodes} groups per model, up to {p.max_pulls} pulls each
          </p>
        </SectionHead>
        <div className="mt-6"><LeaderboardTable results={results} /></div>
      </section>

      <section className="pt-20">
        <SectionHead title="Does it learn between wipes?" link={['/report#learning', 'Learning in the report']}>
          {tiers.length > 1 && (
            <div className="seg" role="group" aria-label="Difficulty">
              {tiers.map((t) => <button key={t} aria-pressed={tier === t} onClick={() => setTier(t)}>{tierName(results, t)}</button>)}
            </div>
          )}
        </SectionHead>
        <div className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <LearningCurves results={results} tier={tier} />
        </div>
        <Link to="/compare" className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-fg-muted transition-colors hover:text-fg">
          Watch Claude Opus 5.5's first and second pull side by side <ArrowRight size={14} />
        </Link>
      </section>

      <section className="pt-20">
        <SectionHead title="Learning to stand in the fire" link={['/report#pyre', 'Bone Pyre in the report']} />
        <p className="mt-2 max-w-[720px] text-[15px] leading-6 text-fg-muted">
          Bone Pyre's blast hits everyone unless two players stand inside its circle. Each square below is one Pyre.
          After one wipe, Opus and Sol soak most of them. The other five almost never do, even when their notes say to.
        </p>
        <div className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <PyreGrid results={results} />
        </div>
      </section>

      <section className="pt-20">
        <SectionHead title="What a score costs" link={['/report#cost', 'Cost in the report']} />
        <div className="mt-6 rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <CostScatter results={results} />
        </div>
      </section>

      {HIGHLIGHTS.length > 0 && (
        <section className="pt-20">
          <SectionHead title="Highlights" link={['/highlights', `All ${HIGHLIGHTS.length}`]} />
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {HIGHLIGHTS.slice(0, 3).map((h) => <HighlightCard key={h.id} h={h} compact />)}
          </div>
        </section>
      )}
    </>
  )
}
