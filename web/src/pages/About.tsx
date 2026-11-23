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
            An open benchmark for going into something unknown, failing, working out why, and doing better on the
            next try.
          </p>
        </header>

        <Section title="For WoW players">
          <p>
            A fresh key in a dungeon you've never run, with no guide. Five AI agents are the group (a tank, a healer
            and three dps, each with a kick, a defensive and a cooldown), with a party chat to call things out. They
            learn the trash and the boss by wiping and talking it over. <Link to="/party">The party page</Link> lists
            every ability, and the <Link to="/watch">replay viewer</Link> shows unit frames, the combat log and every
            order the agents gave.
          </p>
          <ul>
            <li><strong>Two packs</strong>: a caster to kick and a healer to kill first</li>
            <li><strong>Oruth the Unburied</strong>: a cast to kick, a tank buster, pools, a soak, adds and a hard enrage</li>
            <li><strong>+10</strong>: graves that heal undead, stacking damage on every kill, and more adds, on a 4:15 timer</li>
          </ul>
          <p>Names, numbers and art are original; the design is deliberately familiar.</p>
        </Section>

        <Section title="For ML people">
          <p>
            A multi-agent, in-context learning eval in a deterministic environment. Five copies of one model each
            play one character through a text observation and a fixed order format, with a party chat. They start
            blind (no guide to the boss or the trash, only what the affixes say). After each failure they read the same
            factual combat log, talk it over, and each rewrite their private notes, their only memory across
            attempts. Each attempt uses a new seed, so they have to learn mechanics, not timings.
          </p>
          <ul>
            <li>The same prompt, effort, seeds, call interval and call budget for every model, fixed in a pre-registration</li>
            <li>Every reply is recorded: every run replays exactly, and every number can be recomputed from the published files</li>
            <li>Memory-off controls on the same seeds measure what carrying information across wipes is worth</li>
            <li>Model-against-model claims rest on paired differences on the same seeds; the leaderboard order is descriptive</li>
          </ul>
          <p>The <Link to="/report">report</Link> has the details.</p>
        </Section>

        <Section title="Run it yourself">
          <p>You need Node 18 or later and Python 3.10 or later. The viewer:</p>
          <Code>{'cd web\nnpm install\nnpm run dev'}</Code>
          <p>Check the published results, free and offline (every model reply is recorded):</p>
          <Code>{'cd sim\npip install -e ".[dev]"\npython -m mythicsim verify ../web/public/results/v1   # replay all 465 pulls, rebuild the leaderboard'}</Code>
          <p>The simulator, the expert script's +10 clear, and the harness end to end, all without an API key:</p>
          <Code>{'python -m mythicsim run --policy expert --tier +10 --seed 10043\npython -m mythicsim llm --model mock:basic --seeds 0-2'}</Code>
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

        <Section id="support" title="Support MythicBench">
          <p>
            MythicBench is a personal project, and every run is paid for out of pocket: the official run of five
            models costs several hundred dollars in API fees. Donations go straight into running more models,
            stronger ones, and harder experiments.
          </p>
          <p>
            <a href={VENMO_URL} target="_blank" rel="noopener noreferrer">Venmo @{VENMO_HANDLE}</a>
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
