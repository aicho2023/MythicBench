import type { ReactNode } from 'react'
import { modelName } from '../content/display'
import { BEHAVIOUR, EXPERT, MOMENTS, SOAKS } from '../content/findings'
import { GroupScores, LearningCurves } from '../site/charts'
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
  ['ceiling', '7', 'How hard is +10?'],
  ['validity', '8', 'Validity'],
  ['related', '9', 'Related work'],
  ['limits', '10', 'Limitations'],
  ['conclusion', '11', 'Conclusion'],
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
  return (
    <Page>
      <div className="mx-auto grid max-w-[1120px] gap-16 py-12 md:py-16 xl:grid-cols-[200px_minmax(0,720px)]">
        <aside className="hidden xl:block">
          <nav aria-label="Contents" className="sticky top-24 text-[13px] leading-6">
            <p className="mb-2 font-medium text-fg">Contents</p>
            <ol>
              {TOC.map(([id, n, title]) => (
                <li key={id}>
                  <a href={`#${id}`} className="flex gap-2 text-fg-muted transition-colors hover:text-fg">
                    <span className="w-5 shrink-0 text-right font-mono text-[12px] text-fg-faint">{n}</span>{title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="min-w-0">
          <header>
            <p className="font-mono text-[12px] tracking-wide text-accent/80">REPORT · v1 · NOVEMBER 2026</p>
            <h1 className="mt-3 text-[32px] font-normal leading-[1.12] tracking-[-0.01em] text-fg sm:text-[40px]">
              MythicBench: can language-model agents learn a boss fight from failure?
            </h1>
            <p className="mt-5 text-[17px] leading-7 text-fg-muted">
              Five frontier models, five agents each, a dungeon none of them has seen, and five attempts to beat it.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 text-[13px]">
              {LINKS.map(([label, to, internal]) => internal
                ? <Link key={label} to={to} className="rounded-lg border border-line px-3 py-1.5 text-fg-muted transition-colors hover:border-white/20 hover:text-fg">{label}</Link>
                : <a key={label} href={to} className="rounded-lg border border-line px-3 py-1.5 text-fg-muted transition-colors hover:border-white/20 hover:text-fg">{label}</a>)}
            </div>
          </header>

          <section aria-label="Abstract" className="mt-10 rounded-2xl border border-line bg-surface px-6 py-5">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-fg-faint">Abstract</p>
            <p className="mt-2 text-[16px] leading-7 text-[#c4c4ca]" style={{ fontFamily: "'IBM Plex Serif', Georgia, serif" }}>
              Most agent benchmarks ask a model to finish a task once. MythicBench asks whether a team of agents can fail
              at a task, work out why, and do better on the next try. Five copies of one model each play one character
              in a five-person party, run a Mythic+-style dungeon they have never seen, and get up to five attempts.
              Between attempts they read the same combat log, talk it over and rewrite their own notes, with no guidance
              on what to learn. In a pre-registered run of five frontier models (84 groups, 420 attempts, all public and
              replayable), no model cleared the dungeon. Claude Opus 5.5 (44.1) and GPT-6.2 Sol (42.9) are tied at the
              top and clearly ahead of the other three, which score no better than a fixed-rule bot. Their lead does not
              come from the first attempt, where every model plays about the same, but from what they take away from one
              wipe: both work out a mechanic that runs against gamer instinct, in every one of their groups. The others
              almost never do. A clear exists, but it takes near-perfect play.
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
              shape: fixing a GitHub issue, or finishing a task on a website or a desktop{' '}
              <Cite k={['swebench', 'webarena', 'osworld', 'agentbench']} />. Newer work stretches how long an agent
              can keep going <Cite k={['metr-horizon', 'vending-bench']} />, but still asks for one try. MythicBench
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
              Section 9 places MythicBench among this work.
            </p>
            <p>This report makes four contributions:</p>
            <ul>
              <li>An environment for learning from failure as a team: deterministic, replayable to the frame, with a boss whose key mechanic contradicts common sense.</li>
              <li>A pre-registered evaluation of five frontier models from two labs: 84 groups and 420 attempts, with seeds, statistics and stopping rules fixed in advance.</li>
              <li>The finding that the gap between models opens only after the first failure, and that much of it comes down to one inference.</li>
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
              games, says to step out of a glowing circle on the floor. Here that is exactly wrong. The evidence is in the
              debrief after the first wipe: nobody stood in it, and everyone took a large hit.
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
              checked only for harness faults, and stage 2 played the rest on the same frozen code.
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
              The second case is the most telling. The right answer reached the group, was tried, worked, and was then
              argued away. Each agent keeps its own notes, so a lesson that lives in one agent's notes can be outvoted in
              the talk. One agent even wrote the opposite of what had just happened to it.
            </p>
            <p>Twenty more moments like these, each a click from the replay, are on the <Link to="/highlights">highlights page</Link>.</p>

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
              <li>All 93 planned groups were played (84 by the models, 9 by a fixed-rule bot), and all 465 pulls replay exactly from the published recordings. <code>python -m mythicsim verify</code> rebuilds the leaderboard from them.</li>
              <li>Every call was served by the model that was asked for. There were no API errors and no refusals.</li>
              <li>Unusable or cut-off replies were the models' own: about 0.6% of Claude Sonnet 5.5's calls, and Claude Haiku 5.5's at high effort when it ran out of output tokens. They count against the model.</li>
              <li>
                One known harness fault was kept, as the pre-registration allows, and counted by a rule fixed before stage 2.
                In 127,071 moves it happened once: Claude Haiku 5.5, Normal, group 1, pull 4, at 3:44.7, Wren walks through a
                corner of Oruth's throne, a floating-point edge case. It saved about a second and harmed nobody.{' '}
                <Link to="/watch/claude-haiku-5-5/normal/0/4">Watch it</Link>.
              </li>
              <li>Two departures, disclosed. Interim scores were looked at while stage 2 was playing; nothing was changed or decided because of them. And +10 was calibrated in pilots on an earlier version of the fight, where GPT-6.2 Sol cleared some pulls. Later changes made the fight harder, and the calibration was not re-run before the freeze.</li>
            </ul>

            <H2 id="related">Related work</H2>
            <H3 n="9.1">Agent benchmarks score one attempt</H3>
            <p>
              The best-known agent benchmarks give a model a task and score whether it succeeds: resolving real GitHub
              issues <Cite k="swebench" />, completing tasks on self-hosted websites <Cite k="webarena" /> or in a real
              operating system <Cite k="osworld" />, or a mix of eight such environments <Cite k="agentbench" />. METR
              measures how long a task agents can finish, and finds that length doubling roughly every seven
              months <Cite k="metr-horizon" />. Vending-Bench has an agent run a simulated vending business and finds that
              agents lose coherence over long horizons <Cite k="vending-bench" />. In all of these the unit is one
              attempt. Benchmarks of that kind also tend to saturate quickly, which is why efforts like Humanity's Last
              Exam exist at all <Cite k="hle" />. MythicBench's score is a learning curve: the first, blind pull counts,
              but so does every pull after it.
            </p>

            <H3 n="9.2">Learning across attempts</H3>
            <p>
              Reflexion has an agent write a verbal reflection after each failed trial and read it on the next, and
              improves on text games, question answering and coding <Cite k="reflexion" />. ExpeL distils insights from
              many trials and reuses them on new tasks <Cite k="expel" />. Without outside feedback, though, models are
              poor at correcting their own reasoning <Cite k="no-self-correct" />, which is why MythicBench gives every
              agent the same factual combat log after each wipe. Algorithm Distillation shows a transformer improving
              across episodes purely in context <Cite k="algorithm-distillation" />. Closest to our setting is J-TTL,
              where one agent replays the same Jericho text game over several episodes and is scored on how much it
              improves; reflection and memory baselines struggle there too <Cite k="evotest" />. MythicBench differs in
              three ways: each pull uses a new seed, so a party cannot replay a script; the lesson must be shared and
              agreed among five agents who each keep their own notes; and the plan has to be carried out in real time.
            </p>

            <H3 n="9.3">Games as testbeds</H3>
            <p>
              Games have long served as AI benchmarks, from text adventures <Cite k="textworld" /> and NetHack{' '}
              <Cite k="nle" /> to suites built for language models, such as BALROG and SmartPlay{' '}
              <Cite k={['balrog', 'smartplay']} />. Language-model agents have explored Minecraft with a growing skill
              library <Cite k="voyager" />, played commercial games from screenshots <Cite k="cradle" />, and attempted
              1990s video games in real time <Cite k="videogamebench" />. Long, public runs of Pokémon made the
              same point to a wide audience: Claude 3.7 Sonnet earned three gym badges in Pokémon Red{' '}
              <Cite k="claude-pokemon" />, and Gemini 2.5 Pro later finished Pokémon Blue <Cite k="gemini-pokemon" />.
              ARC-AGI-3 moves abstract reasoning into turn-based games with no instructions, scored on how efficiently
              an agent learns each one compared with people <Cite k="arc-agi-3" />. At the other extreme, reinforcement
              learning reached champion level in team games like Dota 2 and StarCraft II{' '}
              <Cite k={['openai-five', 'alphastar']} />, after training on vast numbers of games. MythicBench asks the
              opposite question: what a team can learn from four wipes.
            </p>

            <H3 n="9.4">Teams of agents</H3>
            <p>
              Cooperative games test whether agents can coordinate with partners they cannot read directly: Hanabi
              hides each player's own cards from them <Cite k="hanabi" />, and Overcooked-AI asks two cooks to share a
              kitchen against the clock <Cite k="overcooked-ai" />. Both have been adapted for language models{' '}
              <Cite k={['llm-coordination', 'collab-overcooked']} />, and MindAgent studies an LLM planner
              directing several agents in a cooking game <Cite k="mindagent" />. Groups of language-model agents
              produce believable social behaviour <Cite k="generative-agents" />, and debate between copies of one model
              can improve its answers <Cite k="debate" />. Multi-agent systems also fail in characteristic ways,
              including agents ignoring one another's input <Cite k="mast" />; the case in Section 6.2, where a
              correct lesson is argued away, is one of them. In competitive settings, CICERO reached human-level play in
              Diplomacy by combining a language model with planning <Cite k="cicero" />, and Clocktower Bench pits
              models against each other in a game of social deduction <Cite k="clocktower-bench" />.
            </p>

            <H3 n="9.5">What is new here</H3>
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
              <li><strong>Small samples.</strong> Six groups per model separate large gaps, not small ones. Zero clears in six is consistent with a true clear rate of up to 46%.</li>
              <li><strong>A narrow memory test.</strong> It was run on the two cheapest models, which never learned the key mechanic, so it says nothing about memory in the models that did.</li>
              <li><strong>Coarse control.</strong> Orders come every few seconds of game time, not every global cooldown, and the game waits for the agents.</li>
              <li><strong>Prior knowledge.</strong> Models know about MMOs. The fight is original, but its mechanics are familiar types, so it tests applying general game knowledge as well as learning.</li>
              <li><strong>Interrupts only delay.</strong> An interrupted caster starts the same spell again at once, so an interrupt buys about half a second.</li>
              <li><strong>Prices change.</strong> Costs are list prices at the time of the run.</li>
            </ul>

            <H2 id="conclusion">Conclusion</H2>
            <p>
              Today's best models can coordinate a party well enough to bring a boss within a tenth of his health, and they
              can learn from a failure. Two of five models, after one wipe, worked out a mechanic that runs against
              instinct and turned it into a plan five agents could carry out, in every group they played. The other three
              almost never did, and played no better than fixed rules. No model cleared. The gap that matters is not what
              a model knows on the first attempt, but what it can make of the second.
            </p>
            <p>
              Benchmarks that score one attempt are being saturated within a few years of release <Cite k="hle" />.
              MythicBench starts a long way from that: no model has cleared it, a scripted expert shows that a clear
              exists, and more models or more attempts per group need only a new protocol file. We think learning from
              failure, as a team and in a world that punishes the obvious answer, is where agent evaluation should go
              next, and we hope MythicBench makes it easy to measure.
            </p>

            <H2 id="references">References</H2>
            <References />

            <H2 id="reproduce">Reproducing the results</H2>
            <p>Everything runs from the repository. Checking the published results is free, because every model reply is recorded.</p>
            <pre><code>{`cd sim && pip install -e ".[dev]"
python -m mythicsim verify ../web/public/results/v1             # replay all 465 pulls, rebuild the leaderboard
python -m mythicsim export ../web/public/results/v1 --zip       # flat files for your own analysis
python -m mythicsim run --policy expert --tier +10 --seed 10043   # the expert's +10 clear`}</code></pre>

            <H2 id="cite">Citing</H2>
            <pre><code>{`@misc{mythicbench2026,
  title        = {MythicBench: Can Language-Model Agents Learn a Boss Fight from Failure?},
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
        Across 84 groups and 420 pulls, no model cleared the Hollow Vault, on +10 or on Normal. With zero clears in six
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

      <H3 n="5.2">Two models lead; three are level with fixed rules</H3>
      <p>
        {modelName(top1.model)} ({fmtScore(top1.mythicbench_score)}) and {modelName(top2.model)} ({fmtScore(top2.mythicbench_score)})
        lead, and the difference between them is not significant. Each beats the other models on the same seeds by ten to
        twelve points (Table 4), except that Sol's lead over Claude Sonnet 5.5 falls just short after correction. GPT-6 Luna,
        Claude Sonnet 5.5 and Claude Haiku 5.5 cannot be told apart, and none of them beats a fixed-rule bot that interrupts
        every cast and steps out of every pool (32.5).
      </p>
      <Table n="4" caption="Every pair of models on the same seeds: the mean group-by-group difference, its 95% interval, and the paired t-test's p-value before and after Holm's correction for ten comparisons. A difference is claimed only where the adjusted p is below 0.05.">
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

      <H3 n="5.3">The gap opens after the first wipe</H3>
      <p>
        On the first, blind pull every model scores between {fmtScore(Math.min(...firsts))} and {fmtScore(Math.max(...firsts))},
        about what the fixed-rule bot gets (32). Every party wipes. What separates the models is the next pull (Figure 2).
        Claude Opus 5.5 averages {fmtScore(cell(top1)?.curve_mean?.[0])} on its first pull and{' '}
        {fmtScore(cell(top1)?.curve_mean?.[1])} on its second. GPT-6.2 Sol climbs more slowly, to{' '}
        {fmtScore(Math.max(...(cell(sol)?.curve_mean ?? [0])))} by its fourth. The other three stay flat.
      </p>
      <Figure n="2" caption="Mean +10 score at each pull, over each model's six groups. Hover for the values.">
        <LearningCurves results={r} tier={head} />
      </Figure>

      <H3 n="5.4">One inference makes most of the difference</H3>
      <p>
        After the first wipe, every party sees the same thing in its debrief: Bone Pyre went off with nobody inside, and
        everyone took a heavy hit. What the parties make of it divides the models almost perfectly (Table 5). Claude Opus
        5.5 and GPT-6.2 Sol conclude that the circle has to be soaked in every one of their twelve groups, eleven of them
        after the first wipe. The other three models almost never do.
      </p>
      <Table n="5" caption="Bone Pyre on +10. A group counts if its party soaked a Pyre at least once. No group soaked one on its first pull. GPT-6 Luna and Claude Haiku 5.5 include their extra memory-on groups.">
        <table>
          <thead><tr><th>Model</th><th>Groups that learned to soak</th><th className="r">Pyres soaked, pulls 2 to 5</th></tr></thead>
          <tbody>
            {SOAKS.map((s) => (
              <tr key={s.model}><td>{modelName(s.model)}</td><td>{s.groups}{s.note ? <span className="text-fg-faint">, {s.note}</span> : null}</td><td className="r m">{s.soaked}</td></tr>
            ))}
          </tbody>
        </table>
      </Table>
      <p>The agents' notes after the first wipe show the split:</p>
      <blockquote>"EVERYONE STACK INSIDE THE CIRCLE." Claude Opus 5.5</blockquote>
      <blockquote>"BONE PYRE is a soak, not a pool to dodge." GPT-6.2 Sol</blockquote>
      <blockquote>"The floor circle is NOT the danger." GPT-6 Luna, from the same evidence</blockquote>
      <p>
        Knowing is not the same as doing. Sol names the soak in every group after its first wipe, but gets two agents into
        a 2.5 m circle within six seconds on only three Pyres in four, while also dodging pools, interrupting casts and
        holding adds.
      </p>

      <H3 id="memory" n="5.5">The memory test found nothing to carry</H3>
      <p>
        The pre-registered memory test replays the same seeds with the debrief, talk and notes switched off. It was run on
        the two cheapest models, and found no effect:{' '}
        {effectRows.map((x, i) => {
          const c = cell(x)!
          return (
            <span key={x.model}>
              {i ? '; ' : ''}{modelName(x.model)} {(c.learning_effect! > 0 ? '+' : '') + num(c.learning_effect)} points
              (95% interval {ci(c.learning_effect_ci95)}{c.learning_effect_p != null ? `, p = ${pval(c.learning_effect_p)}` : ''})
            </span>
          )
        })}. That fits Table 5: neither model learned the key mechanic, so memory had nothing to carry. The models that did
        learn were not part of this test, so their gains in Figure 2 are a before-and-after, not a controlled effect.
      </p>
      <Figure n="3" caption="The memory test: mean +10 score at each pull on the same twelve seeds, with memory (solid) and without (dashed).">
        <LearningCurves results={r} tier={head} view="memory" />
      </Figure>

      <H3 n="5.6">Cost and effort</H3>
      <p>
        The official run cost about $357 at list prices, $221 of it Claude Opus 5.5. Opus and GPT-6.2 Sol score the same,
        but an Opus group costs about five times as much, and Sol writes about a fifth as many output tokens (Table 6).
        Raising the cheap models' reasoning effort did not help: on the same three groups, Claude Haiku 5.5 did worse at low
        effort than at medium and barely better at high, and GPT-6 Luna scored the same at every level.
      </p>
      <Table n="6" caption="Cost on +10. Output tokens include thinking. The last column compares low, medium and high effort on the same three groups.">
        <table>
          <thead><tr><th>Model</th><th className="r">Score</th><th className="r">Cost / group</th><th className="r">Output tokens / pull</th><th className="r">Low · medium · high</th></tr></thead>
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
                  <td className="r m">{med ? `${fmtScore(low?.progression_score)} · ${fmtScore(med.progression_score)} · ${fmtScore(high?.progression_score)}` : '–'}</td>
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
