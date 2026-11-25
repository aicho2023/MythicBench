import { Heart } from 'lucide-react'
import type { ReactNode } from 'react'
import { GITHUB_URL, VENMO_HANDLE, VENMO_URL } from '../site/config'
import { Page } from '../site/Layout'

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-10">
      <h2 className="text-[20px] font-medium text-fg">{title}</h2>
      <div className="prose mt-4">{children}</div>
    </section>
  )
}

export function About() {
  return (
    <Page>
      <div className="mx-auto max-w-[720px] space-y-12 py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">About MythicBench</h1>
        </header>

        <Section id="why" title="Why did you build MythicBench?">
          <p>
            I recently got hooked on World of Warcraft and had really been enjoying progressing on Mythic+ dungeons. For
            the uninitiated, Mythic+ dungeons are multi-stage battles against a timer that involve clearing both small groups of enemies
            as well as strong bosses. I got curious about whether the latest models could clear them, and that's how
            MythicBench was born. I got to combine my love for WoW with my interest in creating benchmarks!
          </p>
        </Section>

        <Section id="capabilities" title="What model capabilities were you trying to test?">
          <p>There are a few capabilities I was interested in:</p>
          <ol>
            <li>Are agents run by the same underlying model able to collaborate effectively?</li>
            <li>Can agents learn how to complete a task over time, even when going in blind?</li>
            <li>Do agents actually follow through with what they learned from previous attempts?</li>
          </ol>
          <p>
            These capabilities were always in the back of my mind when designing this benchmark, and I think I ended up
            with a decent result!
          </p>
        </Section>

        <Section id="how" title="How does a run work?">
          <ol>
            <li><strong>Five agents run by one model:</strong> There are five players (1 tank, 1 healer, 3 DPS) that are all controlled by the same underlying model.</li>
            <li><strong>Attempt the dungeon blind:</strong> The agents are not given any information about the enemies, like what abilities they have. They need to rely on their own observations and notes to complete the dungeon.</li>
            <li><strong>Orders every few seconds:</strong> Every few seconds, each agent sends its orders: where to move, what to cast, and on whom. The game state waits for their response before progressing.</li>
            <li><strong>Debrief after a wipe:</strong> After every wipe, the agents can read the combat log, deliberate, and jot down notes. These notes are all they carry into the next pull to help inform their next decisions.</li>
          </ol>
          <p>
            The rules, models and seeds were fixed in a public <a href={`${GITHUB_URL}/blob/main/docs/PREREGISTRATION.md`}>pre-registration</a> before
            the official run. Anyone can reproduce my results by following the <a href={`${GITHUB_URL}#readme`}>README</a>.
          </p>
        </Section>

        <Section id="author" title="Who made this?">
          <p>
            MythicBench was created by Austin (<a href="https://x.com/awstnnnn" target="_blank" rel="noopener noreferrer">@awstnnnn</a>). Feel free to follow along and send messages on X.
          </p>
        </Section>

        <Section id="support" title="Support MythicBench">
          <p>
            MythicBench is an independent, personal project. The official run of seven models cost several hundred
            dollars in API fees. Any donations are greatly appreciated, and will go straight into running more models
            and coming up with new experiments / benchmarks.
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
            <li>Built with three.js, React Three Fiber, React, Tailwind CSS and Lucide icons, in the IBM Plex typeface</li>
          </ul>
          <p>Full list and licenses: <a href={`${GITHUB_URL}/blob/main/THIRD_PARTY.md`}>THIRD_PARTY.md</a>. The code is MIT-licensed.</p>
          <p>
            MythicBench is an independent project, not affiliated with or endorsed by Blizzard Entertainment. World of
            Warcraft and Mythic+ are trademarks of Blizzard Entertainment, Inc.
          </p>
        </Section>

      </div>
    </Page>
  )
}
