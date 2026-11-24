import { Heart } from 'lucide-react'
import type { ReactNode } from 'react'
import { GITHUB_URL, RESULTS_DIR, VENMO_HANDLE, VENMO_URL } from '../site/config'
import { Page } from '../site/Layout'
import { Link } from '../site/router'

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-10">
      <h2 className="text-[20px] font-medium text-fg">{title}</h2>
      <div className="prose mt-4">{children}</div>
    </section>
  )
}

function Code({ children }: { children: string }) {
  return <pre><code>{children}</code></pre>
}

export function About() {
  return (
    <Page>
      <div className="mx-auto max-w-[720px] space-y-12 py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">About MythicBench</h1>
          <p className="mt-4 text-[17px] leading-7 text-fg-muted">
            MythicBench tests whether a team of AI agents can learn something hard and new from its own failures.
            The task is a boss fight.
          </p>
        </header>

        <Section title="Why a dungeon">
          <p>
            Most agent benchmarks give a model one attempt at a task and score the result. Real work rarely goes like
            that. You try, it goes wrong, you work out why, and you try again. MythicBench measures that loop.
          </p>
          <p>
            A Mythic+ style dungeon suits it well. It needs five roles working together. Some of its mechanics punish
            instinct. It runs on a timer. And failure is cheap and easy to read: every wipe leaves a combat log, and the
            next pull shows whether anything was learned.
          </p>
        </Section>

        <Section title="How a run works">
          <ol>
            <li><strong>Five agents, one model.</strong> Five copies of the same model each play one character: a tank, a healer and three damage dealers.</li>
            <li><strong>They go in blind.</strong> Nobody tells them what the boss does. They see what their character would see, and can talk in party chat.</li>
            <li><strong>They pull.</strong> Every few seconds of game time, each agent sends its orders: where to move, what to cast, and on whom. The game waits while they think.</li>
            <li><strong>After a wipe, they debrief.</strong> They read the combat log, talk it over, and each rewrites its own notes. Those notes are all they carry into the next pull.</li>
          </ol>
          <p>
            A group gets up to five pulls, each on a new random seed, so it has to learn the mechanics, not memorise
            timings. Every model plays six fresh groups.
          </p>
        </Section>

        <Section title="What we found">
          <p>
            In 480 pulls by seven models from four labs, no party cleared the dungeon. The closest on +10 was GPT-6.2 Sol, which had Oruth at 8.7%
            when time ran out. The key to the fight is soaking Bone Pyre: standing in the fire instead of running from
            it. Claude Opus 5.5 and GPT-6.2 Sol worked that out in every group. The other five models almost never
            did. A clear is possible: a script written by someone who knows the fight finds one, with a second to spare.
          </p>
          <p>
            The <Link to="/report">report</Link> has the full results, and the <Link to="/highlights">highlights</Link> show
            the moments behind them.
          </p>
        </Section>

        <Section title="For WoW players">
          <p>
            Think of a fresh key in a dungeon you've never run, with no guide. Each character has an interrupt, a
            defensive and a cooldown. The <Link to="/party">party page</Link> lists every ability, and
            the <Link to="/watch">replay viewer</Link> shows unit frames, the combat log and every order the agents gave.
          </p>
          <ul>
            <li><strong>Two trash packs.</strong> One has a caster to kick, the other a healer to kill first.</li>
            <li><strong>Oruth the Unburied.</strong> A cast to kick, a tank buster, pools, a soak, adds and a hard enrage.</li>
            <li><strong>+10.</strong> Graves that heal the undead, stacking damage on every trash kill, and more adds, on a 4:15 timer.</li>
          </ul>
          <p>The names, numbers and art are original. The design is meant to feel familiar.</p>
        </Section>

        <Section title="Fair and checkable">
          <ul>
            <li>Every model gets the same rules, seeds, reasoning effort and call budget, all fixed in a public pre-registration before the run.</li>
            <li>Every model reply is recorded, so every pull replays exactly and every number can be recomputed.</li>
            <li>A memory-off control plays the same seeds without the debrief, to measure what carrying lessons across wipes is worth.</li>
            <li>One model is called better than another only when it scores higher on the same seeds, by a margin a statistical test supports.</li>
            <li>Problems found after the run are disclosed, in the report and the <Link to="/changelog">changelog</Link>.</li>
          </ul>
        </Section>

        <Section title="Questions">
          <h3>Don't the models already know World of Warcraft?</h3>
          <p>
            They know the genre. The dungeon is original, so no guide to it exists. But its mechanics are familiar
            types, so the benchmark tests applying general game knowledge as well as learning from scratch.
          </p>
          <h3>Is it fair to make an AI play in real time?</h3>
          <p>
            It doesn't have to. The game pauses while the agents think, so reply speed never matters. Orders come every
            few seconds of game time rather than every global cooldown, which makes the fight about decisions, not reflexes.
          </p>
          <h3>Why does nobody clear +10?</h3>
          <p>
            It is hard on purpose. Even the expert script clears it rarely, and only with near-perfect play. That leaves
            room for stronger models to show progress, and a known solution for them to find.
          </p>
        </Section>

        <Section title="Run it yourself">
          <p>
            Every model reply is recorded, so checking the published results is free and offline. You need Python 3.10
            or later:
          </p>
          <Code>{'cd sim\npip install -e ".[dev]"\npython -m mythicsim verify ../web/public/results/v1   # replay all 525 pulls, rebuild the leaderboard'}</Code>
          <p>
            The dataset is <code>{RESULTS_DIR}</code>: the leaderboard, the exact settings, and a replay of every pull with
            every reply the model gave (<a href={`/${RESULTS_DIR}/leaderboard.json`}>leaderboard.json</a>). Running the
            viewer, running models and the full protocol are in the <a href={`${GITHUB_URL}#readme`}>README</a>.
          </p>
        </Section>

        <Section id="support" title="Support MythicBench">
          <p>
            MythicBench is a personal project, and every run is paid for out of pocket: the official run of seven
            models cost several hundred dollars in API fees. Donations go straight into running more models,
            stronger ones, and harder experiments.
          </p>
          <p className="not-prose">
            <a href={VENMO_URL} target="_blank" rel="noopener noreferrer" className="btn h-10 px-4 text-[14px] !text-fg">
              <Heart size={15} className="text-accent" /> Venmo @{VENMO_HANDLE}
            </a>
          </p>
        </Section>

        <Section id="credits" title="Credits">
          <ul>
            <li>Characters, animations and dungeon art: <a href="https://www.kaylousberg.com">KayKit by Kay Lousberg</a>, released under CC0</li>
            <li>The format of this site is inspired by <a href="https://www.dwarkesh.com/p/clocktower">Clocktower Bench</a> by Dwarkesh Patel</li>
            <li>Built with three.js, React Three Fiber, React, Tailwind CSS and Lucide icons; type is IBM Plex</li>
          </ul>
          <p>Full list and licenses: <a href={`${GITHUB_URL}/blob/main/THIRD_PARTY.md`}>THIRD_PARTY.md</a>. The code is MIT-licensed.</p>
        </Section>

      </div>
    </Page>
  )
}
