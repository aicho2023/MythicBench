import type { ReactNode } from 'react'
import { GITHUB_URL, RESULTS_DIR } from '../site/config'
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
            An open benchmark for one skill that matters for agents and for raid leaders alike: going into
            something unknown, failing, working out why, and doing better on the next try.
          </p>
        </header>

        <Section title="For WoW players">
          <p>
            Think of a fresh Mythic+ key in a dungeon you've never run, with no guide. The model is the raid
            leader and the whole group: a tank, a healer and three dps, each with a real kit (a kick, a
            defensive, a cooldown). It has to learn the trash and the boss by wiping.
          </p>
          <ul>
            <li><strong>Mortisar, the Hollow King</strong>: a cast you must kick, a tank buster, swirls to step out of, adds, and a hard enrage</li>
            <li><strong>Two packs first</strong>: a caster to kick and a healer to kill first, on one 4:30 timer</li>
            <li><strong>+10</strong> adds three affixes: graves that heal undead, stacking damage on every kill, and more adds</li>
          </ul>
          <p>
            Everything is original (names, art, numbers), but the design is deliberately familiar. The{' '}
            <Link to="/watch">replay viewer</Link> shows unit frames, the boss bar, a combat log, and every order the model gave.
          </p>
        </Section>

        <Section title="For ML people">
          <p>
            An in-context learning eval with a deterministic environment. The model controls five agents through
            a JSON observation and a fixed order format. It starts blind, gets a factual debrief after each
            failure, and rewrites its own notes, which are its only memory across attempts. Each attempt uses a
            new seed, so it has to learn mechanics, not timings.
          </p>
          <ul>
            <li>Every model gets the same prompt, effort, seeds, call interval and call budget</li>
            <li>Every reply is recorded, so every run replays exactly and anyone can recompute every number from the published files</li>
            <li>Memory-off controls separate learning from luck</li>
            <li>Scripted bots at three skill levels check that the score ranks known skill correctly</li>
            <li>Scores come with 95% confidence intervals across episodes</li>
          </ul>
          <p>The <Link to="/paper">paper</Link> has the full protocol.</p>
        </Section>

        <Section title="Run it yourself">
          <p>You need Node 18 or later and Python 3.10 or later. The viewer:</p>
          <Code>{'cd web\nnpm install\nnpm run dev'}</Code>
          <p>The simulator and the scripted bots, free and offline:</p>
          <Code>{'cd sim\npython -m mythicsim run --policy expert --seed 7\npython -m mythicsim bench --policy expert,competent,sloppy --runs 200\npython -m mythicsim llm --model mock:basic --seeds 0-2   # the harness end to end, no API'}</Code>
          <p>The official protocol (this calls model APIs and costs money; <code>--dry-run</code> prints the worst case first):</p>
          <Code>{'python -m mythicsim campaign ../protocol/v1.json --dry-run\npython -m mythicsim campaign ../protocol/v1.json --workers 3\npython -m mythicsim results ../protocol/v1.json --out ../results/v1'}</Code>
          <p>More in the <a href={`${GITHUB_URL}#readme`}>README</a>.</p>
        </Section>

        <Section title="The data">
          <p>
            The site reads one dataset, written by <code>python -m mythicsim results</code>: <code>leaderboard.json</code> (every
            score, interval, clear rate, cost and token count), <code>protocol.json</code> (the exact settings), and a gzipped replay of
            every pull under <code>replays/&lt;model&gt;/&lt;tier&gt;/</code>. A replay is the full event log of the pull plus
            every reply the model gave, so the viewer and the scores are computed from the same file.
          </p>
          <p>
            This site currently serves <code>{RESULTS_DIR}</code>.{' '}
            <a href={`/${RESULTS_DIR}/leaderboard.json`}>Download leaderboard.json</a>
          </p>
        </Section>

        <Section id="credits" title="Credits">
          <ul>
            <li>Characters, animations and dungeon art: <a href="https://www.kaylousberg.com">KayKit by Kay Lousberg</a>, released under CC0</li>
            <li>The format of this site is inspired by <a href="https://clocktowerbench.com">Clocktower Bench</a> by Dwarkesh Patel</li>
            <li>Built with three.js, React Three Fiber, React, Tailwind CSS and Lucide icons; type is IBM Plex</li>
          </ul>
          <p>Full list and licenses: <a href={`${GITHUB_URL}/blob/main/THIRD_PARTY.md`}>THIRD_PARTY.md</a>. The code is MIT-licensed.</p>
        </Section>

        <Section title="Disclaimer">
          <p>
            MythicBench is an independent project. It is not affiliated with or endorsed by Blizzard Entertainment.
            World of Warcraft and Mythic+ are trademarks of Blizzard Entertainment, Inc.
          </p>
        </Section>
      </div>
    </Page>
  )
}
