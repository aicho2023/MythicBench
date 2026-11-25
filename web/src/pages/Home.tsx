import { ArrowRight } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { HighlightCard, isRankedGroup } from './Highlights'
import { HIGHLIGHTS, highlightPath } from '../content/highlights'
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
  // The live clip (wide screens, once the page is idle) is the top model's best pull; until
  // then, and on phones, the poster is the still of the closest pull of all. Label whichever shows.
  const clip = wide && idle ? top : null
  const poster = HIGHLIGHTS.find((h) => h.id === 'closest')
  const heroModel = clip?.model ?? poster?.model ?? null
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
          <Link to={clip ? `${clip.path}?t=${HERO_WINDOW_S[0]}` : poster ? highlightPath(poster) : '/watch'} aria-label="Open this replay in the viewer"
            className="group relative block aspect-[16/10] overflow-hidden rounded-2xl border border-line bg-scene">
            {/* A still from the same pull: the poster while the 3D clip loads, and all phones get (no WebGL download) */}
            <img src={`${import.meta.env.BASE_URL}stills/closest.jpg`} alt="" className="absolute inset-0 h-full w-full object-cover" />
            {wide && idle && <Suspense fallback={null}><Teaser /></Suspense>}
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-lg border border-line bg-[rgba(15,15,16,0.88)] px-3 py-2 text-[13px] text-fg transition-colors group-hover:bg-surface-raised">
              Open in the viewer <ArrowRight size={16} className="text-fg-muted" />
            </span>
          </Link>
          {heroModel && <figcaption className="mt-2 text-[13px] text-fg-muted">{modelName(heroModel)}'s best attempt</figcaption>}
        </figure>
      </section>

      {error && <p className="py-8 text-[14px] text-bad">{error}</p>}
      {results ? <Results results={results} /> : !error && <div className="min-h-[100vh]" aria-hidden />}
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
  // The same rule as 70 x progress, multiplied out: 10.5 a pack, up to 49 for Oruth.
  const segs: [string, string, number][] = [['Pack 1', '10.5', 10.5], ['Pack 2', '10.5', 10.5], ['Oruth, the boss', 'up to 49', 49]]
  const share = best?.boss != null ? 1 - best.boss / 100 : null // of Oruth's health taken off
  // The example reads right only when that pull killed both packs.
  const ok = best && share != null && Math.abs(21 + 49 * share - best.score) < 0.15
  return (
    <section id="scoring" className="pt-20">
      <SectionHead title="Scoring formula" />
      <div className="mt-4 grid items-center gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <p className="text-[17px] leading-7 text-fg-muted">
        Each attempt at the dungeon is called a pull, and every pull scores 0 to 100. A pull that ends in a wipe
        (everyone dying) earns points for how far the party got: up to 10.5 for each of the two packs (groups of
        monsters before the boss) and up to 49 for Oruth, in proportion to the health taken off each. A clear
        (completion of the dungeon) earns 70, plus up to 30 the faster it finishes. We define a model's score as the
        average score of all its pulls.
      </p>
      <div>
        {ok && (
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-fg">{top.name || modelName(top.model)}'s best pull</span>
            <span className="num font-mono text-fg-muted">{best.score.toFixed(1)} of 70 points</span>
          </div>
        )}
        {/* A wipe's 70 points as a bar, filled as far as that pull got */}
        <div className="mt-2 flex h-9 gap-[3px] text-[12px]">
          {segs.map(([name, label, pts], i) => {
            const boss = i === segs.length - 1
            const fill = !ok ? 0 : boss ? share! : 1
            return (
              <div key={name} className="relative overflow-hidden rounded-md" style={{ width: `${(pts / 70) * 100}%`, background: boss ? 'rgba(208,70,59,0.14)' : 'rgba(255,255,255,0.05)' }}>
                <div className="absolute inset-y-0 left-0" style={{ width: `${fill * 100}%`, background: boss ? 'rgba(208,70,59,0.6)' : 'rgba(255,255,255,0.2)' }} />
                <span className="relative flex h-full items-center justify-center truncate px-2 text-fg">{name}, {label}</span>
              </div>
            )
          })}
        </div>
        {ok && (
          <>
            <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-3 sm:gap-x-5">
              {([['10.5', 'pack 1'], ['+'], ['10.5', 'pack 2'], ['+'], [`49 × ${share!.toFixed(2)}`, `Oruth, ${(share! * 100).toFixed(0)}% of his health`], ['='], [best.score.toFixed(1), '']] as [string, string?][]).map(([v, label], i, all) => (
                label !== undefined
                  ? <div key={i}><div className={`num font-mono text-[22px] leading-8 ${i === all.length - 1 ? 'text-fg' : 'text-fg-muted'}`}>{v}</div><div className="text-[12px] text-fg-faint">{label || '\u00a0'}</div></div>
                  : <div key={i} className="pb-5 font-mono text-[20px] text-fg-faint">{v}</div>
              ))}
            </div>
          </>
        )}
      </div>
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
          <LearningCurves results={results} tier={tier} bot={false} />
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
