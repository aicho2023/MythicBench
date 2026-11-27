import { ArrowDown, ArrowRight, ChevronDown, RotateCcw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { modelName } from '../content/display'
import { behaviourRows, soakRows } from '../site/facts'
import { useInsights } from '../site/insights'
import { CostScatter, GroupScores, LearningCurves } from '../site/charts'
import { DeathCauses, SoakByPull } from '../site/HeatTables'
import { Cite, References } from '../site/Cite'
import { GITHUB_URL, SITE_URL } from '../site/config'
import { Page } from '../site/Layout'
import { bestPull } from '../site/Leaderboard'
import { costPerRun, fmtScore, fmtUsd, headlineTier, type Results } from '../site/results'
import { Link } from '../site/router'
import { useResults } from '../site/useResults'

/** Sections in order: [anchor, number, title]. */
const TOC: [string, string, string][] = [
  ['introduction', '1', 'Introduction'],
  ['methodology', '2', 'Methodology'],
  ['results', '3', 'Results'],
  ['limits', '4', 'Limitations'],
  ['conclusion', '5', 'Conclusion'],
  ['next', '6', 'Next steps'],
  ['closing', '7', 'Closing note'],
  ['references', '', 'References'],
  ['reproduce', 'A', 'Reproducing the results'],
  ['cite', 'B', 'Citing'],
]

/** The works the paper cites, for its reference list. */
const CITED = ['swebench', 'webarena', 'reflexion', 'expel', 'evotest', 'llm-hanabi', 'collab-overcooked', 'holm']

function H2({ id, children }: { id: string; children: ReactNode }) {
  const n = TOC.find(([a]) => a === id)?.[1]
  return <h2 id={id}>{n && <span className="n">{n}</span>}{children}</h2>
}
function H3({ id, n, children }: { id?: string; n: string; children: ReactNode }) {
  return <h3 id={id}><span className="n">{n}</span>{children}</h3>
}

function Figure({ n, caption, children }: { n: string; caption: ReactNode; children: ReactNode }) {
  return (
    <figure>
      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-6">{children}</div>
      <figcaption><b>Figure {n}.</b> {caption}</figcaption>
    </figure>
  )
}

function Table({ n, caption, children }: { n: string; caption: ReactNode; children: ReactNode }) {
  return (
    <figure>
      <figcaption className="!mt-0 mb-3"><b>Table {n}.</b> {caption}</figcaption>
      <div className="overflow-x-auto">{children}</div>
    </figure>
  )
}

/** Figure 1: the learning-from-failure loop, in the introduction's words. */
const LOOP: [string, string][] = [
  ['Diagnose', 'Figure out what happened and why things went wrong.'],
  ['Revise', 'Self-reflect and revise the approach, even when the result contradicts what was expected.'],
  ['Agree', 'With several agents, reach the same conclusion and agree to execute the new plan.'],
  ['Execute', 'Carry out the new approach on the next attempt.'],
]
const LOOP_COLS = 'md:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)]'

function LoopDiagram() {
  return (
    <div className="ui">
      <div className={`grid grid-cols-1 ${LOOP_COLS}`}>
        {LOOP.flatMap(([title, body], i) => [
          i > 0 && (
            <div key={`to${i}`} className="flex h-7 items-center justify-center text-fg-faint md:h-auto" aria-hidden>
              <ArrowDown size={15} className="md:hidden" /><ArrowRight size={15} className="hidden md:block" />
            </div>
          ),
          <div key={title} className="rounded-xl border border-line bg-bg p-4">
            <div className="num text-[12px] text-fg-faint">{i + 1}</div>
            <p className="mt-1.5 text-[14px] font-medium leading-5 text-fg">{title}</p>
            <p className="mt-1.5 text-[13px] leading-5 text-fg-muted">{body}</p>
          </div>,
        ])}
      </div>
      <p className="mt-4 flex items-center justify-center gap-2 text-[13px] text-fg-muted">
        <RotateCcw size={14} className="text-fg-faint" aria-hidden />
        If the next attempt fails too, back to step 1
      </p>
    </div>
  )
}

const Loading = () => <p className="ui text-[14px] text-fg-faint">Loading the results…</p>
/** A signed number with a true minus sign. */
const num = (x: number | null | undefined) => fmtScore(x).replace('-', '−')
const ci = (c: [number, number] | null | undefined) => (c ? `${num(c[0])} to ${num(c[1])}` : '–')
const pval = (p: number) => (p >= 0.995 ? '1.00' : p < 0.001 ? '<0.001' : p.toFixed(p < 0.01 ? 3 : 2))
const LINKS: [string, string, boolean][] = [
  ['Replays', '/watch', true], ['Leaderboard', '/', true], ['Data', `${GITHUB_URL}/tree/main/web/public/results/v1`, false],
  ['Code', GITHUB_URL, false], ['Pre-registration', `${GITHUB_URL}/blob/main/docs/PREREGISTRATION.md`, false], ['Changelog', '/changelog', true],
]

/**
 * /report: Austin's paper. The text is his; every number in a table or figure
 * is read from the published results (results/v1/leaderboard.json and the
 * per-pull facts in insights/v1.json).
 */
export function Report() {
  const { results } = useResults()
  // The section being read, marked in the sidebar contents: the last heading above the top fifth of the screen.
  const [current, setCurrent] = useState<string | null>(null)
  useEffect(() => {
    const heads = TOC.map(([id]) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
    const on = () => {
      const line = innerHeight * 0.2
      let at: string | null = null
      for (const h of heads) if (h.getBoundingClientRect().top <= line) at = h.id
      setCurrent(at)
    }
    on()
    addEventListener('scroll', on, { passive: true })
    return () => removeEventListener('scroll', on)
  }, [results])
  // Arriving at /report#section (from another page): scroll there once the section
  // exists. The results sections only render after the results load.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id) return
    const el = document.getElementById(id)
    if (el) requestAnimationFrame(() => el.scrollIntoView())
  }, [results])
  return (
    <Page>
      <div className="mx-auto grid max-w-[1080px] gap-16 py-12 md:py-16 xl:grid-cols-[200px_minmax(0,680px)]">
        <aside className="hidden xl:block">
          <nav aria-label="Contents" className="sticky top-24 text-[13px] leading-6">
            <p className="mb-2 font-medium text-fg">Contents</p>
            <ol>
              {TOC.map(([id, n, title]) => (
                <li key={id}>
                  <a href={`#${id}`} aria-current={current === id ? 'location' : undefined}
                    className={`flex gap-2 transition-colors hover:text-fg ${current === id ? 'text-fg' : 'text-fg-muted'}`}>
                    <span className="w-5 shrink-0 text-right font-mono text-[12px] text-fg-faint">{n}</span>{title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="mx-auto w-full min-w-0 max-w-[680px]">
          <header>
            <p className="font-mono text-[12px] text-fg-faint">Report, v1, November 2026</p>
            <h1 className="mt-3 text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">
              MythicBench: Can AI Agents Learn How to Defeat MMORPG Dungeons?
            </h1>
            <p className="mt-4 text-[14px] text-fg-faint">By Austin Ho</p>
            <div className="mt-6 flex flex-wrap gap-2 text-[13px]">
              {LINKS.map(([label, to, internal]) => internal
                ? <Link key={label} to={to} className="rounded-lg border border-line px-3 py-1.5 text-fg-muted transition-colors hover:border-white/20 hover:text-fg">{label}</Link>
                : <a key={label} href={to} className="rounded-lg border border-line px-3 py-1.5 text-fg-muted transition-colors hover:border-white/20 hover:text-fg">{label}</a>)}
            </div>
          </header>

          {/* Below xl the sidebar contents are hidden, so the long page gets a collapsible list instead. */}
          <details className="group mt-8 rounded-xl border border-line text-[14px] xl:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-medium text-fg [&::-webkit-details-marker]:hidden">
              Contents
              <ChevronDown size={16} className="text-fg-muted transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ol className="border-t border-line px-4 py-3 leading-8">
              {TOC.map(([id, n, title]) => (
                <li key={id}>
                  <a href={`#${id}`} onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')} className="flex gap-3 text-fg-muted transition-colors hover:text-fg">
                    <span className="w-5 shrink-0 text-right font-mono text-[12px] text-fg-faint">{n}</span>{title}
                  </a>
                </li>
              ))}
            </ol>
          </details>

          <section aria-label="Abstract" className="mt-6 xl:mt-10 rounded-2xl border border-line bg-surface px-6 py-6 sm:px-8 sm:py-7">
            <p className="text-[13px] font-medium text-fg-muted">Abstract</p>
            <div className="mt-3 space-y-5 text-[16px] leading-[28px] text-fg" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
              <p>
                Most AI agent benchmarks score a single attempt at a task. This was valuable when people used agents for
                one-off tasks, but as agents are increasingly used for long-horizon tasks, they are expected to improve over
                time. Ultimately, what matters is how much an agent can learn from its own failures. I propose MythicBench,
                a deterministic simulation of a World of Warcraft-inspired dungeon built to test this learning-from-failure
                loop in a team of agents. Five agents, all run by the same underlying model, are asked to play the dungeon
                blind. After each failed attempt, they can read a factual combat log, discuss what went wrong, and write
                private notes on how to improve for the next attempt, up to five times.
              </p>
              <p>
                I ran a pre-registered evaluation of seven models from four labs, with three disclosed amendments, totaling
                96 groups and 480 attempts, of which 42 groups and 210 attempts are ranked. Of these attempts, no models
                successfully cleared the dungeon. Claude Opus 5.5 (44.1) and GPT-6.2 Sol (42.9) had the highest scores and
                were not distinguishable from one another. The other five models scored within about a point of a scripted
                bot that never learns.
              </p>
              <p>
                Differences between models appear mainly after the first attempt, when all models start with similar
                scores. Opus and Sol learned to handle the core game mechanic in all twelve of their groups, whereas the
                other five models handled it at least once in only 6 of their 42 groups, often writing down the wrong
                lesson. All of the code, replays, model replies, and notes are public, so that anyone is able to check the
                results independently, offline.
              </p>
            </div>
          </section>

          <div className="paper mt-6">
            <H2 id="introduction">Introduction</H2>
            <p>
              Recent advancements in Large Language Models (LLMs) have made them increasingly integrated into our daily
              lives. Agents powered by these models are now expected not only to perform tasks, but to improve over time.
              Some early approaches address this, such as coding agents that maintain memory files between sessions and
              agents that repeatedly retry broken pipelines to see whether their patch was effective. In all these cases,
              what matters is not first-attempt accuracy, but how much an agent improves after it fails. Despite this, many
              current benchmarks score a single attempt at a task with a known shape, like how SWE-bench{' '}
              <Cite k="swebench" /> scores models on their ability to resolve a GitHub issue and WebArena{' '}
              <Cite k="webarena" /> scores how a model completes a task on a given website. These benchmarks rank models
              based on what they already know, but they don't meaningfully test how much they can learn over time. With
              Recursive Self-Improvement (RSI) on the horizon, strong evaluations and benchmarks are imperative to judge how
              models learn so the broader AI community can better understand the latest model capabilities.
            </p>
            <p>
              It is worth looking at the learning-from-failure loop for agents. First, the agent must diagnose and
              understand the failure. They need to figure out what happened and why things went wrong. Next, the agent
              must self-reflect and revise its approach, which is difficult when the real-world result contradicts what it
              expected. Lastly, the agent must execute its new approach, which becomes even more complicated in a
              multi-agent system. When multiple agents are involved, they must reach the same conclusion and collectively
              agree to execute the new plan.
            </p>
            <Figure n="1" caption="The learning-from-failure loop. After a failed attempt, an agent has to diagnose the failure, revise its approach and execute the new one; in a team, every agent also has to agree on the new plan.">
              <LoopDiagram />
            </Figure>
            <p>
              There are a few benchmarks that test parts of this loop in isolation. Reflexion <Cite k="reflexion" /> and
              ExpeL <Cite k="expel" /> showed that a single agent is able to perform better on a second try when it writes
              down what went wrong during its first try. More recent work, specifically J-TTL <Cite k="evotest" />, scores
              how much an agent improves when replaying a text-based game. Cooperative benchmarks like LLM-Hanabi{' '}
              <Cite k="llm-hanabi" /> and Collab-Overcooked <Cite k="collab-overcooked" /> also test coordination within
              multi-agent systems to achieve a shared goal. These benchmarks were invaluable for understanding agent
              behavior, but as models advance, we now need a benchmark that evaluates the full learning-from-failure loop.
            </p>
            <p>
              MythicBench fills this gap in the benchmark landscape. It is a deterministic simulation of a World of Warcraft
              (WoW)-inspired Mythic+-style dungeon with a fixed enemy route that culminates in a final boss. Five agents,
              all controlled by the same underlying model, play the dungeon blind, only knowing their own abilities and
              the layout of the dungeon beforehand. After each failure, the party can analyze factual combat logs, discuss
              how they will approach the dungeon next time, and maintain a private set of notes before trying again, up to
              five times. Each time they start the dungeon, it gets a new random seed, meaning the party cannot just
              memorize timings and must learn the core game mechanics to succeed. To ensure the agents are learning rather
              than relying on common game mechanics likely included in their pretraining data, some fight and boss
              abilities are intentionally built so that prior video game knowledge would likely point them in the wrong
              direction.
            </p>
            <p>
              I ran a pre-registered evaluation of seven models from four labs, totaling 96 groups and 480 attempts at the
              dungeon, of which 42 groups and 210 attempts make up the ranked evaluation. I define each try at the dungeon
              as an attempt, and a party's sequence of up to five attempts as a group. Across all attempts, no group
              cleared the dungeon. So, the core result was how the models differed in their approaches. Claude Opus 5.5
              and GPT-6.2 Sol improved after their first failed attempt, while the other five models stayed close
              to a scripted baseline that never learns.
            </p>
            <p>Overall, this paper makes four contributions:</p>
            <ul>
              <li><strong>An environment for learning from failure as a team.</strong> The simulation is deterministic by design, so it is replayable and built around a core mechanic that tests whether a model truly learns. This allows for analysis of all parts of the learning-from-failure loop.</li>
              <li><strong>A pre-registered evaluation of seven models from four labs, with three disclosed amendments.</strong> All are run on the same seeds for paired comparisons, and every run is published so other researchers can review and test independently.</li>
              <li><strong>Evidence that the gap between model learning widens after the first attempt.</strong> I notice a split between more advanced models and weaker models: advanced models record the right lesson and execute it, while most weaker models record the wrong lesson.</li>
              <li><strong>A fully open record.</strong> Every attempt is viewable in a 3D replay, and every chat plus reasoning trace (where the provider returns one) is exportable so that anyone can analyze the data themselves.</li>
            </ul>

            <H2 id="methodology">Methodology</H2>
            <H3 id="environment" n="2.1">Environment</H3>
            <p>
              MythicBench is set in a single dungeon called the Hollow Vault. The run consists of three rooms, containing
              two groups of undead enemies and the final boss, Oruth the Unburied. A run counts as a clear if you defeat
              both groups of enemies and the boss within 4 minutes and 15 seconds. The dungeon has two difficulty modes:
              Normal and +10. The ranked tier, +10, has the enemy health at 0.98x and enemy damage at 1.15x of the base
              dungeon (Normal is 0.95x and 0.9x). In addition, +10 adds three affixes: Restless Graves and Marrowburst,
              which trigger when trash enemies die, and Hollow Tyrant, which gives the boss extra abilities.
            </p>
            <p>
              Regardless of difficulty, the dungeon centers on the core mechanic, Bone Pyre, which requires at least two
              players to stand inside it rather than avoid it. If fewer than two are inside, it hits the whole party. The
              mechanic is called a soak. The agents are never told it is a soak, and the usual instinct with a circle on
              the ground is to step out of it. This was designed so that prior video game knowledge likely points agents
              in the wrong direction and forces them to learn how to handle it.
            </p>
            <p>
              The party for each run follows a similar team composition to what you would find in WoW: a tank, a healer,
              and three damage dealers. Each has unique abilities, health, and range. The dungeon could likely handle
              different team compositions (e.g., two tanks and three damage dealers), but it was intentionally locked to
              the chosen composition to stay true to how WoW dungeons are completed.
            </p>
            <p>
              For research purposes, the simulator is deterministic and runs at fixed 100 ms intervals. With the same seed
              and decisions, the simulator can reproduce byte-identical replays on any machine. Every run records the
              simulator version, the content and harness used, and the campaign runner ensures results from different
              setups are never mixed.
            </p>

            <H3 id="harness" n="2.2">Agent Harness</H3>
            <p>
              While each party has five members, the same underlying model controls them separately. Each agent has its
              own rules, notes, and conversation history. The only things agents share are the public party chat and the
              game state, just like real players in WoW.
            </p>
            <p>
              <strong>Agents play blind:</strong> They know their own abilities, the map, the enemies' names, health, and
              pack makeup, how Oruth moves, and the affixes. They are not told the boss's or the enemy casters' abilities
              or timings.
            </p>
            <p>
              <strong>Observations:</strong> For simplicity's sake, rather than having actual images as input for their
              field of vision, I instead opted to take a text-based approach that would describe in detail the game state,
              such as its own state, its abilities, the positions of enemies, health of allies, active casts, hazards on
              the floor, and recent party chats.
            </p>
            <p>
              <strong>Actions:</strong> The game runs on a tick system, where agents reply in strict JSON at regular
              intervals with their next move, a priority list of abilities and targets, and an optional line to the party
              chat. Between calls, the harness uses these orders to act on the agents' behalf. Since agents are only called
              every few seconds, the harness also handles low-level movement to help agents navigate the dungeon,
              including around solid obstacles, so players don't get stuck before their next orders are sent. Interrupts
              in an agent's priority list fire 0.35 seconds after an interruptible cast starts. Melee characters follow
              their target if it drifts up to 3 m away.
            </p>
            <p>
              <strong>When agents are called:</strong> Calling the models every tick (every 100ms) is impractical and very
              costly, so each agent is instead called every 4 seconds of game time. Agents are also called immediately when
              something important happens, such as a new cast, new enemies spawning, an ally dying, or an agent standing in
              a hazard. Agents that are called in the same tick run in parallel and see the same game state. To prevent the
              world from moving while the harness waits for the agent's replies, the entire simulation waits while the
              models respond. This ensures slower models are not penalized for latency and that every run can be
              reproduced exactly from recorded replies.
            </p>
            <p>
              <strong>Reading replies:</strong> Replies from models are handled the same way and are never repaired by the
              harness. The harness takes the last complete JSON object in the reply that contains the correct order
              format. If it does not see anything it can accept, the order becomes <code>{'{}'}</code>, meaning the player
              keeps its previous orders. Refusals from models are handled the same way, so the player can still do
              something. Finally, agents are capped at 300 calls per attempt and 8000 output tokens per call, including
              reasoning. This was mainly due to the project budget, and these caps could be increased in future runs when
              additional budget is available.
            </p>

            <H3 id="between" n="2.3">Learning Between Attempts</H3>
            <p>
              Before diving in, here is a quick refresher on terminology. I call each dungeon try an attempt (also known as
              a "pull" in WoW terms). A group is one party's sequence of up to five attempts. Each group starts blind, with
              empty notes, and ends at either its first timed clear of the dungeon or after five attempts. Each group is
              independent of the others, isolating all learning within the group.
            </p>
            <p>
              If an attempt does not end in a clear, the party goes through three steps before starting their next
              attempt. First, every agent gets an identical debrief about their last attempt. It includes everything from
              boss casts to damage dealt, who died to what, and what caused the most damage. The debrief is meant to be
              factual and objective, intentionally not giving advice on how to improve in the next run to force the agents
              to draw their own conclusions and come up with a new strategy. Once the debrief is distributed, the party can
              talk amongst themselves. Each agent can see its own notes, the debrief, and any conversation that has
              happened so far, but not the other agents' notes. Each message is capped at 150 words. The talk is completed
              once every agent says they are ready, or after each agent has had a chance to speak three times. Finally,
              agents have time to write their own private notes on how to handle the next attempt, up to 350 words. These
              replace their previous notes.
            </p>

            <H3 id="scoring" n="2.4">Scoring</H3>
            <p>
              Each attempt is scored from 0 to 100. An attempt that does not clear the dungeon scores 70, multiplied by the
              share of the dungeon completed. Each pack counts for 15% of dungeon progress, and the boss counts for 70%,
              measured by health removed. A timed clear scores 70 plus up to 30 for speed, with the full 30 for clearing
              with a quarter of the timer left. This rewards clears that are faster than others.
            </p>
            <p>
              A group's score is the mean of all of its attempts' scores. When a group clears before its fifth attempt, the
              clear's score counts again for each remaining attempt it didn't need, so clearing in fewer attempts results
              in a higher group score. A model's MythicBench score is its mean group score while running the dungeon on +10
              difficulty, reported with a 95% Student-t interval across groups. Every model plays the same seeds, so I
              compare models group by group, and I call one model better than another only when the paired difference has
              a Holm-adjusted <Cite k="holm" /> p-value below 0.05.
            </p>

            <H3 id="models" n="2.5">Model Selection</H3>
            <p>
              I evaluated seven models from four labs: Claude Haiku 5.5, Claude Sonnet 5.5, and Claude Opus 5.5 from
              Anthropic; GPT-6 Luna and GPT-6.2 Sol from OpenAI; Grok 4.3 from xAI; and DeepSeek V4.1 Flash from DeepSeek. I
              chose different-sized models from the same lab so I could compare scale with the model creator held
              constant, and models from different labs for breadth. I used each model via its lab's API, at the lab's
              standard pricing tier.
            </p>
            <p>
              Every model was played at its lab's "medium" reasoning effort. This ensures consistency, though each lab's
              definition of "medium" may differ. For DeepSeek, I used the high setting, which DeepSeek documents as its
              equivalent to medium. I also intended to use both Qwen4-Max and Gemini 3.8 Flash, but I didn't because I
              lacked API access for Qwen, and Gemini's notes didn't conform to the JSON format I wanted.
            </p>
            <p>
              Before the run, I made test calls to check that each provider served the requested model. Every call during
              the run also recorded the model the provider served, and all of them matched.
            </p>
            <p>
              I would have liked to include more models in this benchmark (e.g., Claude Fable, Muse Spark, Inkling) but,
              due to budget constraints, was unable to.
            </p>

            <H3 id="protocol" n="2.6">Data Collection</H3>
            <p>
              Before collecting data and having the models attempt the dungeon, I{' '}
              <a href={`${GITHUB_URL}/blob/main/docs/PREREGISTRATION.md`}>pre-registered</a> and froze the evaluation,
              meaning the models, seeds, metrics, and stopping rules were all fixed. I made three amendments: tightening
              the analysis before any data was produced, keeping a harness edge case unfixed instead of restarting on
              reserve seeds as the pre-registration required, and adding two models (DeepSeek V4.1 Flash and Grok 4.3)
              after the first results were published.
            </p>
            <p>
              The evaluation comprises 96 groups and 480 attempts: 42 ranked groups (six per model), 12 extra memory-on
              groups and 24 memory-off groups for Haiku and Luna, 12 groups of effort sweeps, and 6 groups on Normal as a
              sanity check. In memory-off groups, there is no talk and no notes between attempts, which shows how much of a
              model's improvement comes from learning. I collected the data in two stages. In stage 1, every configuration
              plays its first group. This let me review replays for harness faults only, without looking at scores, before
              committing to spending hundreds of dollars on subsequent groups. Stage 1 found one harness fault (described
              below), which was kept, and stage 2 finished the remaining groups. I reviewed interim scores during stage 2,
              but changed nothing as a result.
            </p>
            <p>
              In data collection, I excluded nothing for scoring poorly; poorly formatted messages or refusals simply
              counted against the models, as the agents would not act as intended. The final dataset in the{' '}
              <a href={GITHUB_URL}>GitHub repository</a> includes every model reply and action, so the leaderboard and
              recordings can be reviewed and recreated offline without any API calls (<code>python -m mythicsim verify</code>,
              see <a href="#reproduce">Appendix A</a>).
            </p>

            <H3 id="baselines" n="2.7">Referenced Baselines</H3>
            <p>
              I created two scripted players that use the same interface as the agents to have a performance baseline. The
              scripted commander follows a set of rules. It never soaks Bone Pyre and fails to clear any of the +10 seeds.
              Its performance sets the performance floor. The second script was the expert script, added after the run,
              written from the perspective of someone who knows the fights. It performs all intended game mechanics, like
              soaking Bone Pyre, interrupting enemy casts, avoiding ground hazards, timing defensive abilities, and healing
              players at the right time. Across 1000 seeds, the expert script clears +10 difficulty only 3 times, with
              a second or less to spare on each run. A clear is therefore possible, but it requires near-perfect play. The +10
              difficulty was calibrated against GPT-6.2 Sol, one of the ranked models, on an earlier version of the
              dungeon.
            </p>

            <H3 id="faults" n="2.8">Disclosed Faults</H3>
            <p>I had two harness faults during data collection.</p>
            <p>
              I identified the first fault during stage 1, where a floating-point edge case allowed a character to stand
              exactly on an object's boundary and walk through it. Out of 142,566 moves, this occurred exactly once, in an
              unranked attempt on Normal. Ultimately, this saved about a second in the total run, as it did allow the
              character to traverse through a corner faster, but this amount ultimately did not make a difference in the
              run.
            </p>
            <p>
              The second fault was found during manual review of replays after the run. The "safe" command, which agents
              use to traverse away from hazards on the floor, did not function as intended for an edge case. If the agent
              was already clear of hazards but out of range of its target, and no clear spot was within range, the "safe"
              command moved the agent to another clear spot instead of leaving it in place. Across the first five models'
              420 attempts, this happened 2,567 times, mostly for GPT-6 Luna (1,726) and Claude Haiku 5.5 (820), and only
              16 of these moves cut a cast short. The fault was kept for Grok and DeepSeek so that all seven models played
              identical code. However, a patch has already been made to fix this problem in the next harness version.
            </p>

            <H2 id="results">Results</H2>
            {results ? <ResultsBody r={results} /> : <Loading />}

            <H2 id="limits">Limitations</H2>
            <p>
              As with everything, there is always room for improvement. Below are the limitations to this study that I
              think should be disclosed:
            </p>
            <p>
              <strong>One Dungeon with One Key Mechanic:</strong> MythicBench solely tests one dungeon with one boss, where
              the entire difficulty rests on handling Bone Pyre. The results show how these models handled this particular
              task, not how they rank on general problem-solving.
            </p>
            <p>
              <strong>Small Sample Size:</strong> Each model played six ranked groups, which was enough to separate the
              leading models from the rest. However, not all of these gaps were statistically significant.
            </p>
            <p>
              <strong>Difficulty and Calibration:</strong> I calibrated the dungeon's difficulty against GPT-6.2 Sol, which
              may have had unintended consequences on how the fight turned out. In addition, +10 might be too hard, with an
              expert script only clearing it about 0.3% of the time across 1000 seeds.
            </p>
            <p>
              <strong>The Memory Test Ran on Only Two Models:</strong> I tested the effects of memory on Haiku and Luna,
              which ultimately almost never learned to soak. The improvement shown by Opus and Sol is therefore a before-and-after
              comparison, not a controlled effect.
            </p>
            <p>
              <strong>The Harness Helps Agents:</strong> The harness handles low-level movement and fires interrupts on
              behalf of the agents. The game environment also pauses while the model responds, so not everything happens in
              real time.
            </p>
            <p>
              <strong>Equal Settings Do Not Mean Equal Compute:</strong> Despite every model being run on "medium" effort
              with an 8000-token cap, "medium" is ultimately subjective and can mean different things at each lab.
              DeepSeek V4.1 Flash also had 6.6% of its replies cut off at the 8000-token cap, far more than any other
              model, and those replies count against it.
            </p>
            <p>
              <strong>Text, Not Vision:</strong> The agents receive a robust text description of the world around them
              instead of live images. Models that are better at text processing may have an unintended advantage because
              of this.
            </p>
            <p>
              <strong>Prior Knowledge:</strong> Soaks are a common mechanic in WoW, and I can't fully rule out that
              pretraining helped or hurt some models.
            </p>

            <H2 id="conclusion">Conclusion</H2>
            <p>
              I created this project to determine whether agents can learn from their own failures, not just perform well
              on their first try. Most benchmarks score a single attempt at a task with a known shape. MythicBench instead
              gives a team five chances to complete a dungeon and measures how much they learn and improve across attempts.
            </p>
            <p>The results find that the learning-from-failure loop breaks in different places for different models:</p>
            <ul>
              <li><strong>Diagnosis:</strong> Most of the models fail here. After the first attempt that resulted in a wipe, almost all parties had the same evidence in their debrief: the Bone Pyre had nobody inside, so everyone took massive damage. Claude Opus 5.5 and GPT-6.2 Sol concluded the circle had to be soaked, whereas the other five models soaked a Pyre at least once in only 6 of their 42 groups because their notes often said the Pyre was unavoidable or that the circle wasn't the source of the damage.</li>
              <li><strong>Agreement:</strong> Even when the party had the right idea for handling Bone Pyre, there was no guarantee they would remember it. In one GPT-6 Luna group, the party watched the soak work and then fail in the same attempt, and the lesson they took away in their notes was wrong.</li>
              <li><strong>Execution:</strong> Even when they had a plan to handle the Bone Pyre, the agents sometimes failed to execute it. Grok 4.3 sometimes wrote down that it needed to soak, but would only get two players inside the soak for a small number of Pyres. Even Sol, which could identify the soak mechanic, carried out the soak about 3 out of 4 times.</li>
            </ul>
            <p>
              Two other results are worth noting. On the first, blind attempt, every model scored between 30.6 and 37.3,
              close to the scripted bot that never learns. The gap between models only revealed itself on subsequent
              attempts, where the two leading models improved their scores compared to the rest of the pack, with Opus
              peaking on its second attempt and Sol on its fourth. Furthermore, more reasoning effort did not necessarily
              buy more learning. Finally, higher prices did not mean better outcomes. Opus and Sol learned about equally well,
              but Opus' groups cost five times as much.
            </p>
            <p>
              I recognize these findings are extrapolated from agents playing a game, but the loop they test is not
              necessarily isolated to games. Coding agents that read a failing CI log are in the same position as a party
              reading a debrief. A memory file that carries between sessions plays the same role as the agents' notes in
              between attempts. A team of agents splitting up a task must agree on what went wrong previously, just as the
              party talks before the next dungeon attempt. The failures I observed would matter in these sorts of
              non-gaming settings as well:
            </p>
            <ul>
              <li><strong>Diagnosis:</strong> an agent that reads the evidence and draws the wrong conclusion</li>
              <li><strong>Agreement:</strong> a team of agents that writes down a wrong lesson and repeats it</li>
              <li><strong>Execution:</strong> an agent that knows the fix but does not perform the fix</li>
            </ul>
            <p>
              A benchmark that only scored the first attempt on the dungeons would have struggled to tell these models
              apart, since on attempt 1, all the models scored within about 7 points of each other. As models improve and
              people become increasingly reliant on agents to handle processes, agents will be expected to improve
              gradually over longer stretches of work. I think measuring this learning-from-failure loop directly is as
              important as measuring what models already know from their training data.
            </p>

            <H2 id="next">Next Steps</H2>
            <ul>
              <li><strong>Run a memory test on the models that learned:</strong> The memory-off control was only run on Claude Haiku 5.5 and GPT-6 Luna. Neither reliably learned the soak, so the test found no effect of memory. Running it on Opus and Sol would show how much of their improvement came from debrief, talks, and notes, rather than from playing again.</li>
              <li><strong>Run more groups per model:</strong> Six groups were enough to separate the leading models from the rest. However, it was not enough to distinguish the other five, or to make all ten leader gaps statistically significant. Furthermore, I'm personally interested in whether more groups would reveal more variance in strategy.</li>
              <li><strong>Adding more models:</strong> I was budget-constrained for this initial run, so I had to axe some models from my test suite. I would have liked to test Claude Fable, Gemini, and more open-source models (Qwen, Inkling, Kimi, Beam). This would hopefully clarify which models can learn from failure versus those that cannot. It would also be interesting to see even more variance in strategy and results.</li>
              <li><strong>Fix the known harness faults:</strong> I found two faults that should be fixed before another run. The "safe" fault is already patched for the next harness version.</li>
              <li><strong>Add new dungeons and mechanics:</strong> Testing on just one boss and one key mechanic is a very narrow test. More dungeons built around non-traditional game mechanics would show whether a model's learning can carry over to a variety of tasks, rather than being specific to this soak mechanic.</li>
              <li><strong>Add more variables to team compositions:</strong> The team compositions were quite fixed for this experiment. In the future, I would like to add more character types and allow characters to change their gear to enable more optimization and emergent strategies.</li>
            </ul>

            <H2 id="closing">Closing Note</H2>
            <p>
              MythicBench is open-source, meaning anyone can watch the replays, check the numbers independently, or even
              run their own models through the same dungeon. I hope this benchmark will help people measure not just what
              agents know, but how well they learn when things go wrong. I am very excited to see where the research
              community takes MythicBench. I strongly believe in open collaboration and welcome any and all requests to
              collaborate further.
            </p>

            <H2 id="references">References</H2>
            <References only={CITED} />

            <H2 id="reproduce">Reproducing the results</H2>
            <p>Everything runs from the repository. Checking the published results is free, because every model reply is recorded.</p>
            <pre><code>{`cd sim && pip install -e ".[dev]"
python -m mythicsim verify ../web/public/results/v1             # replay all 525 pulls, rebuild the leaderboard
python -m mythicsim export ../web/public/results/v1 --zip       # flat files for your own analysis
python -m mythicsim run --policy expert --tier +10 --seed 10043   # the expert's +10 clear`}</code></pre>

            <H2 id="cite">Citing</H2>
            <p>If you use MythicBench, its data or its findings, please cite:</p>
            <pre><code>{`@misc{mythicbench2026,
  title        = {MythicBench: Can AI Agents Learn How to Defeat MMORPG Dungeons?},
  author       = {Ho, Austin},
  year         = {2026},
  howpublished = {\\url{${SITE_URL}/report}},
  note         = {Version 1. Code and data: ${GITHUB_URL}}
}`}</code></pre>
            <p>
              The code is under the <a href={`${GITHUB_URL}/blob/main/LICENSE`}>MIT License</a>. The data, replays,
              recorded model replies and this paper are under <a href={`${GITHUB_URL}/blob/main/LICENSE-DATA.md`}>CC BY 4.0</a>:
              use them for anything, as long as you credit Austin Ho and link the source.
            </p>
          </div>
        </article>
      </div>
    </Page>
  )
}

function ResultsBody({ r }: { r: Results }) {
  const head = headlineTier(r)
  const rows = r.leaderboard
  // Tables 3 and 5 are computed from the per-pull facts (insights/v1.json), not typed in.
  const insights = useInsights()
  const order = rows.map((x) => x.model)
  const soaks = insights ? soakRows(insights, order) : []
  const behaviour = insights ? behaviourRows(insights, order) : []
  const cell = (x: (typeof rows)[number]) => x.tiers[head]
  const pairs = r.pairwise ?? []
  return (
    <>
      <H3 n="3.1">No model cleared the dungeon</H3>
      <p>
        Across all 96 groups and 480 attempts, no model was able to clear the Hollow Vault, on either +10 or on Normal.
        The closest attempts came from the two leading models. GPT-6.2 Sol's best attempt (group 1, attempt 4) had all
        five agents still alive, and Oruth was at 8.7% health when the timer ran out. Meanwhile, Claude Opus 5.5 was able
        to bring Oruth down to 9.0% health (group 2, attempt 2). Figure 2 shows each group's score, and Table 1
        summarizes the results.
      </p>
      <Figure n="2" caption="Every group's +10 score, by model. Each dot is one group of up to five attempts; the white tick is the model's mean and the band its 95% interval.">
        <GroupScores results={r} />
      </Figure>
      <Table n="1" caption="Results on +10. First attempt: the mean score of the blind first attempt. Best attempt: the single best attempt, with how much of Oruth's health was left at its end. Cost: one group at list prices, reasoning included.">
        <table>
          <thead><tr><th>Model</th><th className="r">Score</th><th className="r">95% interval</th><th className="r">First attempt</th><th className="r">Best attempt</th><th className="r">Clears</th><th className="r">Cost / group</th></tr></thead>
          <tbody>
            {rows.map((x) => {
              const b = bestPull(r, x)
              return (
                <tr key={x.model}>
                  <td>{modelName(x.model)}</td>
                  <td className="r m">{fmtScore(x.mythicbench_score)}</td>
                  <td className="r m">{ci(x.mythicbench_score_ci95)}</td>
                  <td className="r m">{fmtScore(cell(x)?.first_pull_score_mean)}</td>
                  <td className="r m">{b ? `${fmtScore(b.score)}${b.bossLeft != null ? ` (${b.bossLeft}%)` : ''}` : '–'}</td>
                  <td className="r m">{cell(x)?.clears ?? 0} / {cell(x)?.episodes}</td>
                  <td className="r m">{fmtUsd(costPerRun(x, r))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Table>

      <H3 n="3.2">Two models lead, and five are even with the scripted bot</H3>
      <p>
        As mentioned in the section before, Claude Opus 5.5 and GPT-6.2 Sol lead, with MythicBench scores of 44.1 and
        42.9, respectively. The difference between them is not significant (+1.1 points, 95% CI −5.6 to 7.9). With seven
        models, there are 21 pairwise comparisons. After Holm correction, five of the ten gaps between the leading models
        and other models are significant: Opus over GPT-6 Luna, Claude Sonnet 5.5, and Grok 4.3, and Sol over GPT-6 Luna
        and DeepSeek V4.1 Flash. The other gaps are large as well, but fall short of the threshold. None of the other
        non-leading models can be told apart from one another. All five score within about a point of the scripted
        commander (32.5).
      </p>
      <Table n="2" caption={`Every pair of models on the same seeds: the mean group-by-group difference, its 95% interval, and the paired t-test's p-value before and after Holm's correction for ${pairs.length} comparisons. A difference is claimed only where the adjusted p is below 0.05.`}>
        <table>
          <thead><tr><th>Comparison</th><th className="r">Difference</th><th className="r">95% interval</th><th className="r">p</th><th className="r">Adjusted p</th><th>Verdict</th></tr></thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={`${p.a}-${p.b}`}>
                <td>{modelName(p.a)} vs {modelName(p.b)}</td>
                <td className="r m">{p.mean > 0 ? '+' : ''}{num(p.mean)}</td>
                <td className="r m">{ci(p.ci95)}</td>
                <td className="r m">{pval(p.p)}</td>
                <td className="r m">{pval(p.p_holm)}</td>
                <td>{p.claim ? <span className="text-fg">{modelName(p.claim)} better</span> : <span className="text-fg-faint">No clear difference</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Table>

      <H3 id="learning" n="3.3">The gap widens after the first wipe</H3>
      <p>
        Every model scores between 30.6 and 37.3 on the first blind attempt, close to the scripted commander. All of
        these first attempts end in a wipe. The models then diverge on subsequent attempts (Figure 3). Claude Opus 5.5
        improves from 36.9 to 52.5 between its first and second attempt, before settling back to 42.2 by its fifth,
        while Sol climbs more slowly from 37.3 on its
        first attempt to 46.7 on its fourth attempt. The remaining five models roughly have the same score across
        attempts. None improve by more than about 5 points on later attempts, and some even regress.
      </p>
      <Figure n="3" caption={<>Mean +10 score at each attempt, over each model's six groups; the dashed line is the scripted bot. Hover for the values. <Link to="/compare">Watch Claude Opus 5.5's first and second attempt side by side</Link>.</>}>
        <LearningCurves results={r} tier={head} />
      </Figure>

      <H3 id="pyre" n="3.4">Bone Pyre separates the models</H3>
      <p>
        After the first wipe, almost every party's debrief shows that the Bone Pyre went off with no one inside or only
        one player, resulting in the whole party taking heavy damage. The only exceptions were four of the 54 memory-on
        groups, which never reached the boss on their first attempt. What each party concluded based on the debrief
        splits the models almost perfectly based on how they would perform on subsequent attempts (Table 3, Figure 4).
        Claude Opus 5.5 and GPT-6.2 Sol figured out that the circle needs to be soaked in all twelve groups, eleven of
        them after a single wipe. The other five models only soaked a Pyre at least once in 6 of the 42 groups.
      </p>
      <Table n="3" caption="Bone Pyre on +10. A group counts if its party soaked a Pyre (two or more players inside) at least once. No group soaked one on its first attempt. GPT-6 Luna and Claude Haiku 5.5 include their extra memory-on groups.">
        <table>
          <thead><tr><th>Model</th><th>Groups that soaked at least once</th><th className="r">Pyres soaked, attempts 2 to 5</th></tr></thead>
          <tbody>
            {soaks.map((s) => (
              <tr key={s.model}><td>{modelName(s.model)}</td><td>{s.groups}{s.note ? <span className="text-fg-faint">, {s.note}</span> : null}</td><td className="r m">{s.soaked}</td></tr>
            ))}
          </tbody>
        </table>
      </Table>
      <Figure n="4" caption="Share of Bone Pyres soaked (two or more players inside), by attempt, over each model's six ranked +10 groups. Nobody soaks on the blind first attempt; Opus and Sol do from the second.">
        <SoakByPull results={r} />
      </Figure>
      <p>
        The agents' notes show how differently the models interpreted the same kind of evidence. For example, a Claude
        Opus 5.5 agent wrote "EVERYONE STACK INSIDE THE CIRCLE," and a GPT-6.2 Sol agent wrote, "BONE PYRE is a soak,
        not a pool to dodge." In contrast, a GPT-6 Luna agent wrote "the floor circle is NOT the danger," and a DeepSeek
        V4.1 Flash agent wrote, "Bone Pyre is party-wide ~33k unavoidable, hits everyone; NOT a floor circle to dodge."
      </p>
      <p>
        Even when agents can write down the right lesson, that doesn't guarantee they will act on it. GPT-6.2 Sol
        identified the soak mechanic in every group after its first wipe, but got two agents to stand inside the Pyre
        within six seconds on only about three Pyres in four, while also handling other mechanics. Grok 4.3 shows this
        gap the most. In its first group, all of its agents identify the soak mechanic and choose two players to handle
        the soak. Over the next four attempts, the party got two players inside only 2 of the 9 Pyres. Across Grok's six
        groups, 14 of the 50 Pyres on attempts 2 to 5 had exactly one player inside, which is not enough to split the
        damage.
      </p>
      <p>
        Figure 5 shows what ultimately killed each party. I find that Bone Pyre caused 55% of the deaths in GPT-6 Luna's
        groups, compared to about 30-40% for all the other models. What's interesting is that learning the soak ended up
        moving the danger rather than removing it. Opus and Sol, who had their parties gather in the middle to soak, lost
        more players to Desecrate pools that landed there (30% and 27% of their deaths, compared with 5% for Luna).
      </p>
      <Figure n="5" caption="What killed each model's characters, as a share of its deaths over its six ranked +10 groups. Hover a cell for the count; Other lists the rest.">
        <DeathCauses results={r} />
      </Figure>

      <H3 id="memory" n="3.5">Memory test showed no clear benefit for Haiku or Luna</H3>
      <p>
        The pre-registered memory test plays all of the same seeds, but with the debrief, talk, and notes turned off. For
        the two models tested (Haiku and Luna), it found no clear difference in score (Figure 6). Claude Haiku 5.5 scored
        −0.8 points with memory on compared to off (95% CI −3.2 to 1.7, p = 0.50), and GPT-6 Luna scored −0.2 points (95%
        CI −1.0 to 0.6, p = 0.60). The test was not run on the two models that did learn, so their gains in Figure 3 are
        a before-and-after comparison, not a controlled effect.
      </p>
      <Figure n="6" caption="The memory test: mean +10 score at each attempt on the same twelve seeds, with memory on (solid) and off (dashed).">
        <LearningCurves results={r} tier={head} view="memory" />
      </Figure>

      <H3 id="cost" n="3.6">Cost and reasoning effort</H3>
      <p>
        All runs cost around $450 at list price. $221 came from Claude Opus 5.5. Interestingly, Opus and GPT-6.2 Sol do
        not differ significantly in score, but an Opus group costs five times as much as a Sol group. Opus also writes
        about five times as many output tokens per attempt (212k compared to 44k, across five agents). A Grok 4.3 or
        DeepSeek V4.1 Flash group cost about as much as a Sol group but produced a much lower score (Table 4, Figure 7).
      </p>
      <p>
        This experiment also examined whether increasing reasoning effort would improve performance. Unfortunately, it
        mostly did not. For the two models tested, going above medium effort did not help: Haiku did worse at low effort and only slightly
        better at high, and Luna scored about the same at every level. Across the same three groups, Claude Haiku 5.5
        scored 25.0 on low effort, 30.2 on medium, and 31.7 on high. GPT-6 Luna scored 32.9, 32.6, and 32.5 at low,
        medium, and high effort, respectively.
      </p>
      <Table n="4" caption="Cost on +10. Output tokens per attempt include reasoning and are summed over the five agents. The last column compares low, medium and high effort on the same three groups.">
        <table>
          <thead><tr><th>Model</th><th className="r">Score</th><th className="r">Cost / group</th><th className="r">Output tokens / attempt</th><th className="r">Low / medium / high</th></tr></thead>
          <tbody>
            {rows.map((x) => {
              const eff = (r.configs ?? []).filter((c) => c.model === x.model)
              const low = eff.find((c) => c.effort === 'low')?.tiers[head]
              const high = eff.find((c) => c.effort === 'high')?.tiers[head]
              const med = (low ?? high)?.default_effort_same_groups
              const tok = cell(x)?.tokens_per_pull
              return (
                <tr key={x.model}>
                  <td>{modelName(x.model)}</td>
                  <td className="r m">{fmtScore(x.mythicbench_score)}</td>
                  <td className="r m">{fmtUsd(costPerRun(x, r))}</td>
                  <td className="r m">{tok ? `${Math.round(tok[1] / 1000).toLocaleString('en-US')}k` : '–'}</td>
                  <td className="r m">{med ? `${fmtScore(low?.progression_score)} / ${fmtScore(med.progression_score)} / ${fmtScore(high?.progression_score)}` : '–'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Table>
      <Figure n="7" caption="Score against the cost of one group, by model, at list prices.">
        <CostScatter results={r} />
      </Figure>

      <H3 id="chat" n="3.7">More chat did not mean more learning</H3>
      <p>
        Communication via party chat did not always lead to learning more. For example, Claude Haiku 5.5's party was one
        of the most talkative, at 66 chat lines per attempt. Despite this, they never soaked a Pyre. GPT-6.2 Sol's party
        talked less, at 49 lines, and learned the soak in every group. Grok 4.3's party talked the least at 10 lines per
        attempt. Nearly every attempt still ended in a wipe.
      </p>
      <Table n="5" caption="Behavior on +10, over each model's memory-on groups: party-chat lines per attempt, and deaths per attempt out of five characters (characters can be revived and die again).">
        <table>
          <thead><tr><th>Model</th><th className="r">Chat lines / attempt</th><th className="r">Deaths / attempt</th></tr></thead>
          <tbody>
            {behaviour.map((b) => (
              <tr key={b.model}><td>{modelName(b.model)}</td><td className="r m">{b.chat}</td><td className="r m">{b.deaths.toFixed(1)}</td></tr>
            ))}
          </tbody>
        </table>
      </Table>

      <H3 id="ceiling" n="3.8">Is a clear even possible?</H3>
      <p>
        With all the models failing, I checked after the run whether a clear was possible using the expert script I
        created. On 1,000 practice seeds that were held out of the official runs, the expert script was able to clear
        Normal 900 times but +10 only 3 times, each with a second or less to spare. A clear is possible, but requires
        near-perfect play. The two best attempts by the models had the boss at less than 10% health when the timer ran
        out, meaning they were close. This also leaves room for future model iterations to improve on this
        benchmark.
      </p>
    </>
  )
}
