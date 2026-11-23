import type { ReactNode } from 'react'
import { Page } from '../site/Layout'
import { Link } from '../site/router'

/** The expert script's clear rates on practice seeds (python -m mythicsim run --policy expert, seeds 10001+). */
const EXPERT = { normal: 'TBD', plus10: 'TBD' }

const SECTIONS: [string, string][] = [
  ['results', 'Results'], ['question', 'The question'], ['dungeon', 'The dungeon'], ['groups', 'Groups and pulls'],
  ['agents', 'The agents'], ['fair', 'Same rules for everyone'], ['reading', 'Reading the results'],
  ['baseline', 'The baseline'], ['limits', 'Limitations'],
]

function Section({ id, children }: { id: string; children: ReactNode }) {
  const i = SECTIONS.findIndex(([s]) => s === id)
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-10">
      <p className="font-mono text-[12px] tracking-wide text-accent/80">{String(i + 1).padStart(2, '0')}</p>
      <h2 className="mt-1 text-[20px] font-medium text-fg">{SECTIONS[i][1]}</h2>
      <div className="prose mt-4">{children}</div>
    </section>
  )
}

/**
 * /report: how the benchmark works, and (after the official run) what the
 * models did. Plain components, so it renders the same in dev and production.
 */
export function Report() {
  return (
    <Page>
      <article className="mx-auto max-w-[720px] space-y-12 py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">Report</h1>
          <p className="mt-4 text-[17px] leading-7 text-fg-muted">
            How MythicBench works and, once the official run is in, what the models did.
          </p>
          <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2 text-[13px]">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-lg border border-line px-3 py-1.5 text-fg-muted transition-colors hover:border-white/20 hover:text-fg">{label}</a>
            ))}
          </nav>
        </header>

        <Section id="results">
          <p>
            The official run is underway. This section will cover how the models compare, whether carrying
            information across wipes helped, what a group cost, and the moments that decided pulls, each linked to
            its replay.
          </p>
        </Section>

        <Section id="question">
          <p>
            Most agent benchmarks ask a model to finish a task once. A Mythic+ group walks into a dungeon nobody has
            seen, wipes, works out why from the combat log, talks it over, and pulls again. MythicBench measures that
            loop, with AI agents playing every character.
          </p>
        </Section>

        <Section id="dungeon">
          <p>
            The Hollow Vault: two trash packs, then Oruth the Unburied, on one 4:15 timer (revive penalties count).
            A <strong>clear</strong> is Oruth and both packs dead within the timer.
          </p>
          <ul>
            <li><strong>Chapel pack.</strong> Four Bonewalkers and a Bone Chanter, whose Grave Volley hits the whole party and can be kicked</li>
            <li><strong>Ossuary pack.</strong> Bonewalkers and a Marrow Mender, whose Mend Bones heals the pack</li>
            <li><strong>Oruth.</strong> A party-wide cast to kick, a tank buster, pools to leave, a circle two players must share, adds, and a hard enrage. He chases whoever he's attacking</li>
          </ul>
          <p>
            Ranking is on <strong>+10</strong>: enemies hit harder, and three affixes add graves that heal undead,
            stacking damage on every kill, and a boss with more adds and a mark that hurts anyone nearby.
            <strong> Normal</strong> is an unranked sanity check. A pull scores 0 to 100: a clear earns 70 plus up to
            30 for speed, anything else up to 70 for progress (each pack 15%, Oruth 70%).
          </p>
        </Section>

        <Section id="groups">
          <p>
            Each model plays as several <strong>groups</strong>: a fresh party with up to five <strong>pulls</strong>.
            It starts blind: it knows its own abilities, the map and the affixes, and nothing else about the enemies.
            After a pull that doesn't clear, everyone reads the same combat log, the party talks it over, and each
            character rewrites its own notes, its only memory of the pull. Nothing tells them what to learn.
          </p>
          <p>
            A group's score averages its pulls, with a clear counted again for every pull it saved, so clearing sooner
            scores higher. A model's MythicBench score is its average group score on +10. Every pull uses a new seed,
            so memorizing timings doesn't help.
          </p>
          <p>
            The two cheapest models also play paired groups with memory off: same seeds, same first pull, but no
            debrief, talk or notes afterwards. The difference, pair by pair, is what carrying information across wipes
            is worth.
          </p>
        </Section>

        <Section id="agents">
          <p>
            Five copies of one model each play one character, seeing what that character would: the party's health,
            positions, casts and auras, its own cooldowns, the enemies, the pools on the ground, and party chat. Each
            is asked for orders every four seconds of game time, and sooner when something concerns it. It answers
            with where to move, an ordered list of its abilities, and optionally a line in chat. The game waits while
            the agents think, so reply speed never matters.
          </p>
        </Section>

        <Section id="fair">
          <ul>
            <li>The same prompt, game state, reply format, seeds and call budget for every model</li>
            <li>One named reasoning effort (medium). It buys different amounts of thinking at different labs, so every score is shown with its cost</li>
            <li>Every reply is recorded: any pull replays exactly, and anyone can recompute every number for free</li>
            <li>The models, seeds and statistics were fixed before the official run, in a public pre-registration</li>
          </ul>
        </Section>

        <Section id="reading">
          <ul>
            <li>The leaderboard's order is descriptive. One model is called better than another only where their scores on the same seeds, group by group, differ clearly (a paired test, corrected for comparing every pair)</li>
            <li>Six groups per model is a small sample: even 0 clears in 6 is consistent with a true clear rate up to 46%</li>
            <li>The learning effect measures the debrief, the talk and the notes together, not any one of them</li>
            <li>Cost is what the tokens cost at list prices during the run, next to the calls and tokens behind it</li>
          </ul>
        </Section>

        <Section id="baseline">
          <p>
            A <strong>scripted commander</strong> plays through the same interface with fixed rules: kick every cast,
            step out of every pool. It is a floor, not a skilled player. It never soaks Oruth's Bone Pyre, scores about
            33 on +10 and has never cleared it.
          </p>
          <p>
            The <strong>expert script</strong> is the golden standard: proof that a clear is possible. Its rules were
            written by someone who knows the fight. Two players soak Bone Pyre, a marked player walks clear, nobody
            walks through a pool, the tank saves Ironhide for Soul Rend, and the healer attacks only when nobody needs
            healing. It plays through the agents' own interface and blind view and never learns. On practice seeds
            outside the official schedule it clears Normal {EXPERT.normal} of the time and +10 {EXPERT.plus10}.
            Its clears are in the <Link to="/watch">viewer</Link>.
          </p>
          <p>
            +10 was calibrated in pilot runs of GPT-6.2 Sol, on seeds outside the official schedule, so that the
            strongest models clear it only some of the time. Sol is also one of the ranked models.
          </p>
        </Section>

        <Section id="limits">
          <ul>
            <li>One dungeon and one boss: the results are about this task, not a general ranking of models</li>
            <li>Orders every few seconds of game time, not every global cooldown</li>
            <li>List prices change</li>
            <li>Inspired by Mythic+, not World of Warcraft: names, numbers and art are original. <Link to="/party">The party page</Link> lists every ability</li>
          </ul>
        </Section>
      </article>
    </Page>
  )
}
