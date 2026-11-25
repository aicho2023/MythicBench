import { ChevronDown } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { modelName } from '../content/display'
import { BEHAVIOUR, EXPERT, LESSONS, MOMENTS, SOAKS } from '../content/findings'
import { GroupScores, LearningCurves } from '../site/charts'
import { DeathCauses, SoakByPull } from '../site/HeatTables'
import { Cite, References } from '../site/Cite'
import { GITHUB_URL } from '../site/config'
import { Page } from '../site/Layout'
import { bestPull } from '../site/Leaderboard'
import { costPerRun, fmtScore, fmtUsd, headlineTier, labName, type LeaderboardRow, type Results } from '../site/results'
import { Link } from '../site/router'
import { useResults } from '../site/useResults'

/** Sections in order: [anchor, number, title]. */
const TOC: [string, string, string][] = [
  ['introduction', '1', 'Introduction'],
  ['environment', '2', 'The environment'],
  ['harness', '3', 'Agents and harness'],
  ['protocol', '4', 'Protocol'],
  ['results', '5', 'Results'],
  ['cases', '6', 'Three pulls, up close'],
  ['lessons', '7', 'Beyond the game'],
  ['ceiling', '8', 'How hard is +10?'],
  ['validity', '9', 'Validity'],
  ['related', '10', 'Related work'],
  ['limits', '11', 'Limitations'],
  ['next', '12', 'Next steps'],
  ['conclusion', '13', 'Conclusion'],
  ['references', '', 'References'],
  ['reproduce', 'A', 'Reproducing the results'],
  ['cite', 'B', 'Citing'],
]

/** Table 8: [name, reference key or null for MythicBench, game world, unseen, improvement, team, time limit]. */
const COMPARE: [string, string | null, boolean, boolean, boolean, boolean, boolean][] = [
  ['SWE-bench', 'swebench', false, false, false, false, false],
  ['BALROG', 'balrog', true, false, false, false, false],
  ['ARC-AGI-3', 'arc-agi-3', true, true, false, false, false],
  ['J-TTL', 'evotest', true, false, true, false, false],
  ['Hanabi Challenge', 'hanabi', true, false, false, true, false],
  ['Overcooked-AI', 'overcooked-ai', true, false, false, true, true],
  ['MythicBench', null, true, true, true, true, true],
]

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
 * /report: the write-up, as a paper. Every number in a table or figure is read
 * from the published results (results/v1/leaderboard.json); the behaviour
 * counts and case studies come from the same dataset's replays (content/findings.ts).
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
      <div className="mx-auto grid max-w-[1120px] gap-16 py-12 md:py-16 xl:grid-cols-[200px_minmax(0,720px)]">
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

        <article className="min-w-0">
          <header>
            <p className="font-mono text-[12px] text-fg-faint">Report, v1, November 2026</p>
            <h1 className="mt-3 text-[32px] font-normal leading-[1.12] tracking-[-0.01em] text-fg sm:text-[40px]">
              MythicBench: can language-model agents learn a boss fight from failure?
            </h1>
            <p className="mt-5 text-[17px] leading-7 text-fg-muted">
              Seven frontier models from four labs, five agents each, a dungeon none of them has seen, and five attempts to beat it.
            </p>
            <p className="mt-3 text-[14px] text-fg-faint">
              By Austin (<a href="https://x.com/awstnnnn" target="_blank" rel="noopener noreferrer" className="text-fg-muted underline decoration-white/30 underline-offset-4 hover:text-fg">@awstnnnn</a>)
            </p>
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

          <section aria-label="Abstract" className="mt-6 xl:mt-10 rounded-2xl border border-line bg-surface px-6 py-5">
            <p className="text-[13px] font-medium text-fg-muted">Abstract</p>
            <p className="mt-2 text-[16px] leading-7 text-[#c4c4ca]" style={{ fontFamily: "'IBM Plex Serif', Georgia, serif" }}>
              Most agent benchmarks ask a model to finish a task once. MythicBench asks whether a team of agents can fail
              at a task, work out why, and do better on the next try. Five copies of one model each play one character
              in a five-person party, run a Mythic+-style dungeon they have never seen, and get up to five attempts.
              Between attempts they read the same combat log, talk it over and rewrite their own notes, with no guidance
              on what to learn. In a pre-registered run of seven frontier models from four labs (96 groups, 480 attempts, all
              public and replayable), no model cleared the dungeon. Claude Opus 5.5 (44.1) and GPT-6.2 Sol (42.9) lead, with
              no clear difference between them. The other five score 32.1 to 33.4, about what a fixed-rule bot scores (32.5).
              Each leader is ten to twelve points ahead of each of the five on the same seeds; after correcting for all 21
              comparisons, five of those ten gaps are clear. The leaders' edge does not
              come from the first attempt, where every model plays about the same, but from what they take away from one
              wipe: both work out a mechanic that runs against gamer instinct, in every one of their groups. The other five
              almost never do, often even when their own notes describe it. A clear exists, but it takes near-perfect play. The results suggest lessons for agents
              meant to learn on the job: a first attempt says little about who will learn, a rule that runs against habit
              is rarely learned, and memory, effort and agreement between agents do not make up for drawing the wrong
              lesson.
            </p>
          </section>

          <div className="paper mt-4">
            <H2 id="introduction">Introduction</H2>
            <p>
              Being good at something new usually means being bad at it first. A raid group walking into a new dungeon
              wipes, reads the combat log, argues about what happened and tries again. The skill that matters is not
              getting it right the first time but getting it right by the third: noticing what killed you, forming a
              theory, agreeing on a plan with four other people and carrying it out under time pressure.
            </p>
            <p>
              That loop is hard to test with most agent benchmarks, which score a single attempt at a task of known
              shape, such as fixing a GitHub issue or finishing a task on a website{' '}
              <Cite k={['swebench', 'webarena']} />. Newer work stretches how long an agent can keep going{' '}
              <Cite k="vending-bench" />, but still asks for one try. MythicBench
              tests the loop directly. It is a deterministic simulation of a Mythic+-style dungeon, the
              format World of Warcraft players know: a fixed route of enemies and a boss, on one timer. Five agents play
              it, one per character, all the same model. They start blind to everything about the enemies, and between
              attempts nothing tells them what to learn.
            </p>
            <p>
              Learning from failure has mostly been studied one agent at a time. Reflexion and ExpeL showed that a model
              can do better on a second try by writing down, in plain language, what went wrong on the first{' '}
              <Cite k={['reflexion', 'expel']} />, and recent work scores a single agent on how much it improves when it
              replays the same text game <Cite k="evotest" />. Teamwork has its own benchmarks, from Hanabi to
              Overcooked <Cite k={['hanabi', 'overcooked-ai']} />. To our knowledge no public benchmark asks for both at
              once: five agents who must draw the same lesson from the same failure, agree on it in conversation, and
              carry it out together under a timer, in a fight built so that their prior knowledge points the wrong way.
              Section 10 places MythicBench among this work.
            </p>
            <p>This report makes four contributions:</p>
            <ul>
              <li>An environment for learning from failure as a team: deterministic, replayable to the frame, with a boss whose key mechanic contradicts common sense.</li>
              <li>A pre-registered evaluation of seven frontier models from four labs: 96 groups and 480 attempts, with seeds, statistics and stopping rules fixed in advance.</li>
              <li>The finding that the gap between models opens only after the first failure, and that it shows most clearly in one mechanic, Bone Pyre.</li>
              <li>Every attempt as a 3D replay with every agent's orders, chat and reasoning, and every recorded model reply, so anyone can check or recompute any number for free.</li>
            </ul>

            <H2 id="environment">The environment</H2>
            <H3 n="2.1">The Hollow Vault</H3>
            <p>
              A run is a walk through three rooms. The party pulls two packs of undead, then the boss, Oruth the
              Unburied, all on one 4:15 timer. A run is a <strong>clear</strong> only if Oruth and both packs die before
              the timer runs out. Table 1 lists what the party faces and what each mechanic asks of it. The agents start
              knowing only their own abilities, the map and the difficulty's affixes. Everything in the table that
              belongs to an enemy has to be learned by playing.
            </p>
            <Table n="1" caption="What the party faces on +10, and what each mechanic asks of it. The enemies' rows are not in the agents' instructions.">
              <table>
                <thead><tr><th>Source</th><th>Mechanic</th><th>What it does</th><th>What it asks</th></tr></thead>
                <tbody>
                  <tr><td>Bone Chanter</td><td>Grave Volley</td><td>Bone shards hit the whole party</td><td>Interrupt it</td></tr>
                  <tr><td>Marrow Mender</td><td>Mend Bones</td><td>Heals the most injured undead by 30%</td><td>Interrupt it, or kill the Mender first</td></tr>
                  <tr><td>Oruth</td><td>Requiem of Bones</td><td>Party-wide damage</td><td>Interrupt it</td></tr>
                  <tr><td>Oruth</td><td>Soul Rend</td><td>A huge hit on the tank, then a lingering wound</td><td>A defensive cooldown, healing</td></tr>
                  <tr><td>Oruth</td><td>Desecrate</td><td>A damaging pool under four players</td><td>Step out at once</td></tr>
                  <tr><td>Oruth</td><td>Bone Pyre</td><td>A circle that goes off in 6 s. With two or more players inside they split a modest hit; otherwise it hits everyone hard</td><td>Two players <em>stand in</em> it</td></tr>
                  <tr><td>Oruth</td><td>Summon the Restless</td><td>Adds at 80%, 50% and 25% health that run at the healer</td><td>Hold them, kill them</td></tr>
                  <tr><td>Hollow Tyrant</td><td>Grave Mark</td><td>Brands a player; 6 s later it hits everyone within 6 m</td><td>The marked player runs clear</td></tr>
                  <tr><td>Restless Graves</td><td>Graves</td><td>Dead undead leave a pool that heals undead and hurts players</td><td>Drag enemies off them</td></tr>
                  <tr><td>Marrowburst</td><td>Marrow Shards</td><td>Each undead death puts damage over time on the whole party</td><td>Heal through it</td></tr>
                </tbody>
              </table>
            </Table>
            <p>
              Bone Pyre is the fight's central test. Every instinct a player has, and most of what a model has read about
              games, says to step out of a glowing circle on the floor. Here that is exactly wrong. The evidence is usually in the
              debrief after the first wipe: too few players stood in it, and everyone took a large hit.
            </p>
            <H3 n="2.2">Difficulty and scoring</H3>
            <p>
              The ranked difficulty is <strong>+10</strong>: enemies have 98% of their listed health and deal 15% more
              damage, under three affixes (Restless Graves, Marrowburst and Hollow Tyrant, which adds Grave Mark and a
              third wave of adds). <strong>Normal</strong> (95% health, 90% damage, no affixes) is an unranked check
              played by the two cheapest models. A clear scores 70 plus up to 30 for speed. Anything else scores up to 70
              for how far it got: each pack is worth 15% and Oruth 70%, by health removed. A group's score is the mean of
              its five attempts, with a clear counting again for every attempt it saved. A model's MythicBench score is
              its mean group score on +10.
            </p>

            <H2 id="harness">Agents and harness</H2>
            <H3 n="3.1">What an agent sees and does</H3>
            <p>
              Each agent controls one character and sees what that character would: the party's health, positions, casts
              and auras; its own cooldowns; the enemies and what they are casting; the pools on the floor; and the party
              chat. It is asked for orders every four seconds of game time, and sooner when something concerns it, such
              as a cast starting, a pool appearing or an ally falling low. It replies in JSON with where to move (a
              point, or "safe" to step out of a known hazard), an ordered priority list of abilities and targets, and
              optionally one line of party chat, at most one every ten seconds. The game pauses while the agents think,
              so reply speed never matters. Interrupts land 350 ms after a cast starts, as a person's would.
            </p>
            <H3 n="3.2">Between attempts</H3>
            <p>
              After an attempt that does not clear, every agent reads the same debrief: the timeline, deaths, damage taken
              by source, interrupts, and each Bone Pyre with who stood inside. The party talks it over in a short round of
              messages, and each agent rewrites its own private notes. The notes are its only memory of the attempt, and
              they come back to it on the next one. Nothing in the instructions says what to look for or what a good plan
              is. In this report, one fresh party with up to five attempts is a <strong>group</strong>, and one attempt a{' '}
              <strong>pull</strong>.
            </p>
            <H3 n="3.3">Same rules for everyone</H3>
            <p>
              Every model gets the same instructions, game state, reply format, seeds and call budget, at the reasoning
              effort its lab calls "medium", with an 8,000-token output cap per reply. Effort buys different amounts of
              thinking at different labs, so every score is reported next to what it cost. Every model reply is
              recorded, which makes every pull replay exactly.
            </p>

            <H2 id="protocol">Protocol</H2>
            <p>
              The models, seeds, metrics, analysis and stopping rules were fixed in a public pre-registration before the
              official run, and the code was frozen (harness 1.0.0, sim 0.11.0, content 1.8.0). Seeds come from a schedule
              nobody tuned on. The run was played in two stages: stage 1 played each configuration's first group and was
              checked only for harness faults, and stage 2 played the rest on the same frozen code. Two models from two
              more labs, Grok 4.3 (xAI) and DeepSeek V4.1 Flash (DeepSeek), were added afterwards by a pre-registered
              amendment (Amendment 3), and played the same frozen code, seeds and settings in the same two stages.
            </p>
            <Table n="2" caption="Groups played per model. The two cheapest models also played extra memory-on groups, paired with the memory-off control on the same seeds, a Normal check, and low and high effort.">
              <table>
                <thead><tr><th>Model</th><th>Lab</th><th className="r">+10, ranked</th><th className="r">Memory on / off</th><th className="r">Normal</th><th className="r">Low / high effort</th></tr></thead>
                <tbody>
                  {(results?.leaderboard ?? []).map((r) => {
                    const head = headlineTier(results!)
                    const ctl = results!.controls.find((c) => c.model === r.model && c.tier === head)
                    const eff = (results!.configs ?? []).filter((c) => c.model === r.model)
                    return (
                      <tr key={r.model}>
                        <td>{modelName(r.model)}</td><td>{labName(r.provider)}</td>
                        <td className="r m">{r.tiers[head]?.episodes ?? '–'}</td>
                        <td className="r m">{ctl ? `${ctl.episodes} / ${ctl.episodes}` : '–'}</td>
                        <td className="r m">{r.tiers.normal?.episodes ?? '–'}</td>
                        <td className="r m">{eff.length ? eff.map((c) => c.tiers[head]?.episodes ?? 0).join(' / ') : '–'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Table>
            <p>
              The unit of analysis is the group. Each model's score comes with a 95% Student-t interval over its six
              groups. Two models are called different only where their scores on the same seeds, group by group, differ
              clearly: a paired t-test, with Holm's correction for comparing every pair <Cite k="holm" />, following
              the case for paired comparisons on shared items in <Cite k="error-bars" t />. Clear rates get exact
              (Clopper-Pearson) intervals <Cite k="clopper-pearson" />. The effect of memory is the paired difference between the same seeds played
              with and without the debrief, talk and notes.
            </p>

            <H2 id="results">Results</H2>
            {!results ? <Loading /> : <ResultsBody r={results} />}

            <H2 id="cases">Three pulls, up close</H2>
            <p>
              Every pull can be replayed with each agent's orders and chat beside it. Three are worth watching for what
              they show about how teams of agents learn, and how they fail to.
            </p>
            {MOMENTS.map((m, i) => (
              <div key={m.path}>
                <H3 n={`6.${i + 1}`}>{m.title}</H3>
                <p>{m.text} <Link to={m.path}>Watch the pull</Link>.</p>
              </div>
            ))}
            <p>
              The second case is the most telling. The party had evidence both ways in one pull: a soak with two inside that
              hurt nobody, and a blast with one inside that killed two. Wren's notes generalised from the blast that killed
              her, not the one she survived inside the circle, and the party carried that lesson into the next pull. Each
              agent keeps its own notes, so the lesson that wins is the one that gets written down and argued for.
            </p>
            <p>Twenty more moments like these, each a click from the replay, are on the <Link to="/highlights">highlights page</Link>.</p>

            <H2 id="lessons">Beyond the game</H2>
            <p>
              MythicBench is one fight in one game, and six groups per model separate only large differences, so none of
              what follows is established in general. But the setting has the same shape as a common goal for agents in
              real work: do a task, get feedback, and do it better next time, often as one of several agents. Six results
              look likely to carry over to that setting, and each is a hypothesis worth testing there.
            </p>
            {LESSONS.map((l, i) => (
              <div key={l.id}>
                <H3 id={`lesson-${l.id}`} n={`7.${i + 1}`}>{l.title}</H3>
                <p>
                  {l.evidence}{l.id === 'consensus' && <> Multi-agent systems are known to fail this way <Cite k="mast" />.</>}{' '}
                  <a href={`#${l.section}`}>Details</a>.
                </p>
                <p><strong>What it suggests.</strong> {l.takeaway}</p>
              </div>
            ))}

            <H2 id="ceiling">How hard is +10?</H2>
            <p>
              Nobody cleared +10, so is a clear possible at all? To find out, we wrote an expert script after the run: a
              fixed set of rules written by someone who knows the fight, playing through the same interface and the same
              blind view as the agents. It soaks Bone Pyre with two players, sends a marked player clear, never walks
              through a pool when a dry path exists, saves the tank's defensive for Soul Rend, and keeps the tank healed.
              On {EXPERT.seeds.toLocaleString('en-US')} practice seeds outside the official schedule it clears Normal{' '}
              {EXPERT.normal.clears} times, but +10 only {EXPERT.plus10.clears} times, each with about a second to spare.
              A clear exists, but +10 asks for near-perfect play. That leaves plenty of room above today's best models,
              and a known solution for future ones to find. The expert's clears are in the <Link to="/watch">viewer</Link>.
            </p>

            <H2 id="validity">Validity</H2>
            <ul>
              <li>All 105 planned groups were played (96 by the models, 9 by a fixed-rule bot), and all 525 pulls replay exactly from the published recordings. <code>python -m mythicsim verify</code> rebuilds the leaderboard from them.</li>
              <li>Every call was served by the model that was asked for. There were no API errors and no refusals in the counted groups. Some runs stopped part-way (a cloud session's time limit, and once a provider account running out of credit); a stopped group is not counted until it is played again from its recorded replies, so the replay continues exactly where it stopped.</li>
              <li>Unusable or cut-off replies were the models' own, and they count against the model. Under the same 8,000-token cap every model has, DeepSeek V4.1 Flash's replies were cut off far more often than any other model's: 654 of its 9,887 calls (6.6%), most of them orders during a fight, after which that agent keeps its previous orders. Next were about 0.6% of Claude Sonnet 5.5's calls, and Claude Haiku 5.5's at high effort. xAI's API cannot cap Grok 4.3's reasoning, so the cap was applied when its replies were read; none of Grok's replies passed it.</li>
              <li>
                One harness fault, found in stage 1, was kept. The pre-registered rule was to fix a fault and restart on
                reserve seeds; after stage 1 we amended the protocol to keep this one instead (Amendment 2), so that every
                group plays the same code, and counted it by a rule fixed before stage 2.
                In 127,071 moves by the first five models it happened once (and never in the 15,495 moves of the two added later): Claude Haiku 5.5, Normal, group 1, pull 4, at 3:44.7, Wren walks through a
                corner of Oruth's throne, a floating-point edge case. It saved about a second and harmed nobody.{' '}
                <Link to="/watch/claude-haiku-5-5/normal/0/4">Watch it</Link>.
              </li>
              <li>
                A second harness fault was found after the run, while reviewing replays. The rules tell agents that
                "safe" steps to the nearest spot clear of the pools. An agent already standing clear should stay where it
                is. But when it was also out of reach of its first target, and no dry spot was in reach, the harness
                moved it to another clear spot instead. An agent that kept sending "safe" could shuffle back and forth
                between two spots. In the 480 pulls the models played, this happened 3,108 times: GPT-6 Luna 1,726,
                Claude Haiku 5.5 820, Grok 4.3 509, DeepSeek V4.1 Flash 32, Claude Sonnet 5.5 18, Claude Opus 5.5 2 and
                GPT-6.2 Sol 1. Only 18 of these moves cut a cast short. In the rest, the agent could not reach its target from
                where it stood anyway. The cancelled casts are the one consequence that can be counted; the fault's total
                effect on scores was not measured. It fell mostly on GPT-6 Luna, Claude Haiku 5.5 and Grok 4.3. v1 keeps
                the fault, since its code is frozen, and the two added models played with it too. The fix waits for the
                next harness version.{' '}
                <Link to="/watch/gpt-6-luna/normal/2/5?t=148">Watch it</Link> (Kit, from 2:28).
              </li>
              <li>Two departures, disclosed. Interim scores were looked at while stage 2 was playing; nothing was changed or decided because of them. And +10 was calibrated in pilots on an earlier version of the fight, where GPT-6.2 Sol cleared some pulls. Later changes made the fight harder, and the calibration was not re-run before the freeze. Finally, Amendment 3 was made after the five-model results were published, so the two labs were added knowing those results; the new models played the frozen protocol unchanged, and the five models' results stand as published.</li>
            </ul>

            <H2 id="related">Related work</H2>
            <H3 n="10.1">Agent benchmarks score one attempt</H3>
            <p>
              The best-known agent benchmarks give a model a task and score whether it succeeds, such as resolving real
              GitHub issues <Cite k="swebench" /> or completing tasks on self-hosted websites <Cite k="webarena" />.
              Vending-Bench has an agent run a simulated vending business for a long time, and finds that agents lose
              coherence over long horizons <Cite k="vending-bench" />. In all of these the unit is one attempt.
              MythicBench's score is a learning curve: the first, blind pull counts, but so does every pull after it.
            </p>

            <H3 n="10.2">Learning across attempts</H3>
            <p>
              Reflexion has an agent write a verbal reflection after each failed trial and read it on the next, and
              improves on text games, question answering and coding <Cite k="reflexion" />. ExpeL distils insights from
              many trials and reuses them on new tasks <Cite k="expel" />. Without outside feedback, though, models are
              poor at correcting their own reasoning <Cite k="no-self-correct" />, which is why MythicBench gives every
              agent the same factual combat log after each wipe. Closest to our setting is J-TTL,
              where one agent replays the same Jericho text game over several episodes and is scored on how much it
              improves; reflection and memory baselines struggle there too <Cite k="evotest" />. MythicBench differs in
              three ways: each pull uses a new seed, so a party cannot replay a script; the lesson must be shared and
              agreed among five agents who each keep their own notes; and the plan has to be carried out in real time.
            </p>

            <H3 n="10.3">Games and teams</H3>
            <p>
              Games are a long-standing testbed for AI, and suites such as BALROG now score language models on them{' '}
              <Cite k="balrog" />. ARC-AGI-3 puts agents into turn-based games with no instructions and scores how
              efficiently they learn each one, compared with people <Cite k="arc-agi-3" />. Cooperative games test
              whether agents can coordinate with partners they cannot read directly: Hanabi hides each player's own
              cards from them <Cite k="hanabi" />, and Overcooked-AI asks two cooks to share a kitchen against the
              clock <Cite k="overcooked-ai" />. Systems of several language-model agents also fail in characteristic
              ways, including agents ignoring one another's input <Cite k="mast" />; the case in Section 6.2, where a
              correct lesson is argued away, is one of them. Clocktower Bench, which pits models against each other in
              a game of social deduction, inspired how this benchmark is run and presented <Cite k="clocktower-bench" />.
            </p>

            <H3 n="10.4">What is new here</H3>
            <p>
              Each of the properties MythicBench combines has been studied before. What has not, to our knowledge, is
              all of them in one benchmark: an unseen world learned by playing it, a score that rewards improvement
              across attempts, a team that has to agree on what it learned, and a time limit (Table 8). That
              combination is what lets the results separate models that play equally well on the first try.
            </p>
            <Table n="8" caption="MythicBench next to related benchmarks. Game: an interactive game world. Unseen: the agent has to learn the world by playing it. Learning scored: the score rewards improvement across attempts. Team: several agents must coordinate. Timer: play runs against a time limit. A tick is a statement about design, not about difficulty or quality.">
              <table>
                <thead>
                  <tr><th>Benchmark</th><th className="r">Game</th><th className="r">Unseen</th><th className="r">Learning scored</th><th className="r">Team</th><th className="r">Timer</th></tr>
                </thead>
                <tbody>
                  {COMPARE.map(([name, key, ...flags]) => (
                    <tr key={name}>
                      <td>{key ? <a href={`#ref-${key}`} className="cite">{name}</a> : <strong>{name}</strong>}</td>
                      {flags.map((f, i) => <td key={i} className={`r ${f ? 'yes' : 'no'}`}>{f ? '✓' : '–'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Table>

            <H2 id="limits">Limitations</H2>
            <ul>
              <li><strong>One dungeon, one boss.</strong> The results are about this task, not a general ranking of models.</li>
              <li><strong>Small samples.</strong> Six groups per model separate large gaps, not small ones. Zero clears in six is consistent with a true clear rate of up to 46%. Adding models makes the correction for multiple comparisons stricter: with seven models, two gaps that were clear among five (Opus and Sol over Claude Haiku 5.5) no longer are, though neither changed.</li>
              <li><strong>A narrow memory test.</strong> It was run on the two cheapest models, which never learned the key mechanic, so it says nothing about memory in the models that did.</li>
              <li><strong>Coarse control.</strong> Orders come every few seconds of game time, not every global cooldown, and the game waits for the agents.</li>
              <li><strong>Prior knowledge.</strong> Models know about MMOs. The fight is original, but its mechanics are familiar types, so it tests applying general game knowledge as well as learning.</li>
              <li><strong>Range is the agent's job.</strong> The state lists abilities that are off cooldown, not whether their target is in reach. An agent has to work out reach from positions, and some stood idle centimetres out of melee range. That is part of what is measured, but it weighs on melee characters more than on ranged ones, and there is no line-of-sight rule.</li>
              <li><strong>Interrupts only delay.</strong> An interrupted caster starts the same spell again at once, so an interrupt buys about half a second.</li>
              <li><strong>Prices change.</strong> Costs are list prices at the time of the run.</li>
            </ul>

            <H2 id="next">Next steps</H2>
            <ul>
              <li><strong>More models.</strong> New models join v1 the way Grok 4.3 and DeepSeek V4.1 Flash did: by an amendment, on the same frozen code, seeds and settings, so their scores sit on the same leaderboard. Next in line are Claude Fable 5.2, GPT Terra, Grok 4.7 and Kimi, as budget and research credits from the labs allow. One group costs from under $1 to about $37 at list prices, depending on the model, and each model plays six.</li>
              <li><strong>Tighter comparisons.</strong> Six groups per model separate only large gaps. More groups per model would show whether the five models level with the scripted bot really are level.</li>
              <li><strong>Memory where it matters.</strong> The memory test ran only on two models that never learned the key mechanic. Running it on Claude Opus 5.5 and GPT-6.2 Sol would show how much of their gain the debrief, talk and notes explain.</li>
              <li><strong>A fixed harness.</strong> The "safe" fault waits for the next harness version, which would be a new protocol with its own runs, not a change to v1.</li>
              <li><strong>More fights.</strong> Other bosses with other mechanics that run against instinct would test whether the pattern here holds beyond Bone Pyre.</li>
            </ul>

            <H2 id="conclusion">Conclusion</H2>
            <p>
              Today's best models can coordinate a party well enough to bring a boss within a tenth of his health, and they
              can learn from a failure. Two of seven models, after one wipe, worked out a mechanic that runs against
              instinct and turned it into a plan five agents could carry out, in every group they played. The other five
              almost never did, some even with the right plan in their notes, and played no better than fixed rules. No model cleared. The gap that matters is not what
              a model knows on the first attempt, but what it can make of the second.
            </p>
            <p>
              MythicBench starts a long way from its ceiling: no model has cleared it, a scripted expert shows that a
              clear exists, and more models or more attempts per group need only a new protocol file. We think learning from
              failure, as a team and in a world that punishes the obvious answer, is where agent evaluation should go
              next, and we hope MythicBench makes it easy to measure.
            </p>

            <H2 id="references">References</H2>
            <References />

            <H2 id="reproduce">Reproducing the results</H2>
            <p>Everything runs from the repository. Checking the published results is free, because every model reply is recorded.</p>
            <pre><code>{`cd sim && pip install -e ".[dev]"
python -m mythicsim verify ../web/public/results/v1             # replay all 525 pulls, rebuild the leaderboard
python -m mythicsim export ../web/public/results/v1 --zip       # flat files for your own analysis
python -m mythicsim run --policy expert --tier +10 --seed 10043   # the expert's +10 clear`}</code></pre>

            <H2 id="cite">Citing</H2>
            <pre><code>{`@misc{mythicbench2026,
  title        = {MythicBench: Can Language-Model Agents Learn a Boss Fight from Failure?},
  author       = {Austin},
  year         = {2026},
  howpublished = {\\url{https://mythicbench.com/report}},
  note         = {Version 1. Code and data: ${GITHUB_URL}}
}`}</code></pre>
          </div>
        </article>
      </div>
    </Page>
  )
}

function ResultsBody({ r }: { r: Results }) {
  const head = headlineTier(r)
  const rows = r.leaderboard
  const cell = (x: LeaderboardRow) => x.tiers[head]
  const [top1, top2] = rows
  const pairs = r.pairwise ?? []
  const effectRows = rows.filter((x) => cell(x)?.learning_effect !== undefined)
  const firsts = rows.map((x) => cell(x)?.first_pull_score_mean).filter((v): v is number => v != null)
  const sol = rows.find((x) => x.model === 'gpt-6.2-sol') ?? top2
  return (
    <>
      <H3 n="5.1">Nobody cleared the dungeon</H3>
      <p>
        Across 96 groups and 480 pulls, no model cleared the Hollow Vault, on +10 or on Normal. With zero clears in six
        groups, each model's +10 clear rate has an exact 95% interval of 0% to 46%. The closest pulls came from the top
        two models: GPT-6.2 Sol finished one with all five agents alive and Oruth at {bestPull(r, sol)?.bossLeft}% health,
        and Claude Opus 5.5 got him to {bestPull(r, top1)?.bossLeft}%. Figure 1 shows every group's score, and Table 3 the
        numbers.
      </p>
      <Figure n="1" caption="Every group's +10 score, by model. Each dot is one group of up to five pulls; the white tick is the model's mean and the band its 95% interval.">
        <GroupScores results={r} />
      </Figure>
      <Table n="3" caption="Results on +10. First pull: the mean score of the blind first attempt. Best pull: the single best attempt, with how much of Oruth's health was left at its end. Cost: one group at list prices, thinking included.">
        <table>
          <thead><tr><th>Model</th><th className="r">Score</th><th className="r">95% interval</th><th className="r">First pull</th><th className="r">Best pull</th><th className="r">Clears</th><th className="r">Cost / group</th></tr></thead>
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

      <H3 n="5.2">Two models lead; five are level with fixed rules</H3>
      <p>
        {modelName(top1.model)} ({fmtScore(top1.mythicbench_score)}) and {modelName(top2.model)} ({fmtScore(top2.mythicbench_score)})
        lead, and the difference between them is not significant. Each is ten to twelve points ahead of every other model
        on the same seeds (Table 4). With seven models there are 21 comparisons, and after correcting for all of them five
        of those gaps are clear: Opus over GPT-6 Luna, Claude Sonnet 5.5 and Grok 4.3, and Sol over GPT-6 Luna and
        DeepSeek V4.1 Flash. The other five gaps, of the same size, fall short of the threshold with six groups per model.
        The other five models cannot be told apart, and all of them score within a point of a fixed-rule bot that
        interrupts every cast and steps out of every pool (32.5).
      </p>
      <Table n="4" caption={`Every pair of models on the same seeds: the mean group-by-group difference, its 95% interval, and the paired t-test's p-value before and after Holm's correction for ${pairs.length} comparisons. A difference is claimed only where the adjusted p is below 0.05.`}>
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

      <H3 id="learning" n="5.3">The gap opens after the first wipe</H3>
      <p>
        On the first, blind pull every model scores between {fmtScore(Math.min(...firsts))} and {fmtScore(Math.max(...firsts))},
        about what the fixed-rule bot gets (32). Every party wipes. What separates the models is the next pull (Figure 2).
        Claude Opus 5.5 averages {fmtScore(cell(top1)?.curve_mean?.[0])} on its first pull and{' '}
        {fmtScore(cell(top1)?.curve_mean?.[1])} on its second. GPT-6.2 Sol climbs more slowly, to{' '}
        {fmtScore(Math.max(...(cell(sol)?.curve_mean ?? [0])))} by its fourth. The other five stay about flat.
      </p>
      <Figure n="2" caption={<>Mean +10 score at each pull, over each model's six groups; the dashed line is the scripted bot. Hover for the values. <Link to="/compare">Watch Claude Opus 5.5's first and second pull side by side</Link>.</>}>
        <LearningCurves results={r} tier={head} />
      </Figure>

      <H3 id="pyre" n="5.4">Bone Pyre is the clearest difference in behaviour</H3>
      <p>
        After the first wipe, nearly every party sees the same thing in its debrief: Bone Pyre went off with nobody
        inside, or just one player, and everyone took a heavy hit. (Four of the 54 groups never reached Oruth on their
        first pull: one each for Claude Sonnet 5.5, GPT-6 Luna, Claude Haiku 5.5 and DeepSeek V4.1 Flash.) What the parties make of it divides the models almost perfectly (Table 5). Claude Opus
        5.5 and GPT-6.2 Sol conclude that the circle has to be soaked in every one of their twelve groups, eleven of them
        after the first wipe. The other five models almost never do: 6 of their 42 groups soaked a Pyre even once.
      </p>
      <Table n="5" caption="Bone Pyre on +10. A group counts if its party soaked a Pyre at least once. No group soaked one on its first pull. GPT-6 Luna and Claude Haiku 5.5 include their extra memory-on groups.">
        <table>
          <thead><tr><th>Model</th><th>Groups that soaked at least once</th><th className="r">Pyres soaked, pulls 2 to 5</th></tr></thead>
          <tbody>
            {SOAKS.map((s) => (
              <tr key={s.model}><td>{modelName(s.model)}</td><td>{s.groups}{s.note ? <span className="text-fg-faint">, {s.note}</span> : null}</td><td className="r m">{s.soaked}</td></tr>
            ))}
          </tbody>
        </table>
      </Table>
      <Figure n="3" caption="Share of Bone Pyres soaked (two or more players inside), by pull, over each model's six ranked +10 groups. Nobody soaks on the blind first pull; Opus and Sol do from the second.">
        <SoakByPull results={r} />
      </Figure>
      <p>The agents' notes after the first wipe show what each party inferred from the same kind of blast:</p>
      <blockquote>"EVERYONE STACK INSIDE THE CIRCLE." Claude Opus 5.5</blockquote>
      <blockquote>"BONE PYRE is a soak, not a pool to dodge." GPT-6.2 Sol</blockquote>
      <blockquote>"The floor circle is NOT the danger." GPT-6 Luna, from the same evidence</blockquote>
      <blockquote>"Bone Pyre is party-wide ~33k unavoidable, hits everyone; NOT a floor circle to dodge." DeepSeek V4.1 Flash</blockquote>
      <p>
        Knowing is not the same as doing. Sol names the soak in every group after its first wipe, but gets two agents into
        a 2.5 m circle within six seconds on only three Pyres in four, while also dodging pools, interrupting casts and
        holding adds. Grok 4.3 shows the gap more starkly. In its first group, after the first wipe, all five agents'
        notes say the Pyre must be soaked and name the two who will stand in it. Over the next four pulls the party gets two players
        inside on 2 of 9 Pyres. Across Grok's six groups, 14 of the 50 Pyres on pulls 2 to 5 had exactly one player
        inside, not enough to split the blast. The same rule written down did not become the same behaviour.
      </p>
      <p>
        Figure 4 shows what killed each party. Bone Pyre causes 55% of GPT-6 Luna's deaths and 30 to 40% of every other
        model's. Opus and Sol, whose parties gather in the middle to soak it, lose more characters to the Desecrate pools
        that land there: 30% and 28% of their deaths, against 5% for Luna.
      </p>
      <Figure n="4" caption="What killed each model's characters, as a share of its deaths over its six ranked +10 groups. Hover a cell for the count; Other lists the rest.">
        <DeathCauses results={r} />
      </Figure>

      <H3 id="memory" n="5.5">The debrief and notes showed no clear benefit for Haiku or Luna</H3>
      <p>
        The pre-registered memory test replays the same seeds with the debrief, talk and notes switched off, so it
        measures all three together. It was run on the two cheapest models, and found no clear difference in score:{' '}
        {effectRows.map((x, i) => {
          const c = cell(x)!
          return (
            <span key={x.model}>
              {i ? '; ' : ''}{modelName(x.model)} {(c.learning_effect! > 0 ? '+' : '') + num(c.learning_effect)} points
              (95% interval {ci(c.learning_effect_ci95)}{c.learning_effect_p != null ? `, p = ${pval(c.learning_effect_p)}` : ''})
            </span>
          )
        })}. That fits Table 5: neither model learned the key mechanic, so the debrief may have had little of use to carry. The models that did
        learn were not part of this test, so their gains in Figure 2 are a before-and-after, not a controlled effect.
      </p>
      <Figure n="5" caption="The memory test: mean +10 score at each pull on the same twelve seeds, with memory (solid) and without (dashed).">
        <LearningCurves results={r} tier={head} view="memory" />
      </Figure>

      <H3 id="cost" n="5.6">Cost and effort</H3>
      <p>
        The official run cost about $445 at list prices, $221 of it Claude Opus 5.5. Opus and GPT-6.2 Sol score 44.1 and 42.9,
        with no clear difference between them, but an Opus group costs about five times as much, and Sol writes about a fifth as many output tokens (Table 6).
        A Grok 4.3 or DeepSeek V4.1 Flash group costs about as much as a Sol group (DeepSeek's at its peak list price, which errs high).
        Raising the cheap models' reasoning effort did not help: on the same three groups, Claude Haiku 5.5 did worse at low
        effort than at medium and barely better at high, and GPT-6 Luna scored the same at every level.
      </p>
      <Table n="6" caption="Cost on +10. Output tokens include thinking. The last column compares low, medium and high effort on the same three groups.">
        <table>
          <thead><tr><th>Model</th><th className="r">Score</th><th className="r">Cost / group</th><th className="r">Output tokens / pull</th><th className="r">Low / medium / high</th></tr></thead>
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

      <H3 n="5.7">How the parties played</H3>
      <p>
        Every party organised its own interrupt rotation without being told to, and the two leading models stopped more of
        the casts that can be interrupted. Talking more is not the same as learning: Claude Haiku 5.5's party is one of the
        chattiest and learned nothing, while GPT-6.2 Sol's says less and learned in every group (Table 7). Nearly every pull
        still ended in a wipe.
      </p>
      <Table n="7" caption="Behaviour on +10, over each model's memory-on groups: the share of interruptible casts interrupted, party-chat lines per pull, and deaths per pull out of five characters.">
        <table>
          <thead><tr><th>Model</th><th className="r">Casts interrupted</th><th className="r">Chat lines / pull</th><th className="r">Deaths / pull</th></tr></thead>
          <tbody>
            {BEHAVIOUR.map((b) => (
              <tr key={b.model}><td>{modelName(b.model)}</td><td className="r m">{b.kicks}</td><td className="r m">{b.chat}</td><td className="r m">{b.deaths.toFixed(1)}</td></tr>
            ))}
          </tbody>
        </table>
      </Table>
    </>
  )
}
