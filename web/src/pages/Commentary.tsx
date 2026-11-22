import type { ReactNode } from 'react'
import { Page } from '../site/Layout'
import { Link } from '../site/router'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-10">
      <h2 className="text-[20px] font-medium text-fg">{title}</h2>
      <div className="prose mt-4">{children}</div>
    </section>
  )
}

/**
 * /commentary: how the benchmark works, and (after the official run) what the
 * models did. Plain components, so it renders the same in dev and production.
 */
export function Commentary() {
  return (
    <Page>
      <article className="mx-auto max-w-[720px] space-y-12 py-12 md:py-16">
        <header>
          <h1 className="text-[28px] font-normal leading-[1.15] text-fg sm:text-[32px]">Commentary</h1>
          <p className="mt-4 text-[17px] leading-7 text-fg-muted">
            What MythicBench measures, how a run works, and, once the official run is in, what the models
            actually did.
          </p>
          <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2 text-[13px]">
            {[['results', 'Results'], ['question', 'The question'], ['dungeon', 'The dungeon'], ['groups', 'Groups and pulls'],
              ['agents', 'The agents'], ['fair', 'Same rules for everyone'], ['baselines', 'Baselines'], ['limits', 'Limitations']].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-lg border border-line px-3 py-1.5 text-fg-muted transition-colors hover:text-fg">{label}</a>
            ))}
          </nav>
        </header>

        <Section id="results" title="Results">
          <p>
            The official run is next. When it's done, this section walks through what happened: how the models
            compare, which ones improved between pulls (and whether that's the notes or luck), what each one
            spent, and the moments that decided pulls, each linked to the exact second of its replay.
          </p>
          <p>Until then, the <Link to="/party">party page</Link> shows who's in the group and what every ability does.</p>
        </Section>

        <Section id="question" title="The question">
          <p>
            Most agent benchmarks ask a model to finish a task once. A Mythic+ group does something else: it
            walks into a dungeon nobody has seen, wipes, works out why from the combat log, talks it over, and
            pulls again. MythicBench measures that loop with AI agents playing every character.
          </p>
        </Section>

        <Section id="dungeon" title="The dungeon">
          <p>
            The Gravecrown Crypt: two trash packs, then Mortisar, the Hollow King, all on one 4:15 timer. The
            run ends when the timer does, revive penalties included. It's a <strong>clear</strong> when Mortisar
            and both packs are dead within the timer.
          </p>
          <ul>
            <li><strong>Chapel pack.</strong> Four Bonewalkers and a Bone Chanter, whose Grave Volley hits the whole party and can be interrupted</li>
            <li><strong>Ossuary pack.</strong> Bonewalkers and a Marrow Mender, whose Mend Bones heals the pack</li>
            <li><strong>Mortisar.</strong> A party-wide cast you must kick, a tank buster, pools to step out of, adds, and a hard enrage. He walks after whoever he's attacking, so the tank has to hold him</li>
          </ul>
          <p>
            The headline score is on <strong>+10</strong>: enemies hit harder and three affixes are active
            (graves that heal undead, stacking damage on every kill, and a boss that summons more adds and brands
            players with a mark that hurts anyone nearby). <strong>Normal</strong> is a sanity check. Every pull
            scores 0 to 100: a clear earns 70 plus up to 30 for speed; otherwise up to 70 for progress (each pack
            15%, Mortisar 70%).
          </p>
        </Section>

        <Section id="groups" title="Groups and pulls">
          <p>
            Each model plays as several <strong>groups</strong>. A group is a fresh party that gets up to five
            <strong> pulls</strong> at the dungeon. It starts blind: it knows its own abilities and the affixes,
            nothing about the enemies. After a pull that doesn't clear, everyone sees the same combat log, the
            party talks it over in turn, and each character writes its own notes, the only thing it carries into
            the next pull. Nothing tells them what to learn. A group is done when it clears in time or uses its
            five pulls.
          </p>
          <p>
            A group's score is the average of its pulls, with a clear counted again for each pull it saved, so
            clearing sooner scores higher. A model's MythicBench score is the average over its groups on +10, with a
            95% interval across groups. Every pull uses a new seed, so a party can't just memorize timings.
          </p>
          <p>
            To tell learning from luck, the two cheapest models also play paired groups with memory off: same seeds,
            same first pull, but no talk and no notes afterwards. The learning effect is the difference, pair by pair.
          </p>
        </Section>

        <Section id="agents" title="The agents">
          <p>
            Five copies of one model each play one character. Each sees what its character would: everyone's
            health, position, casts and auras, its own cooldowns, the enemies, the pools on the ground, and party
            chat. It's asked for orders every four seconds of game time and sooner when something concerns it (a
            cast it could kick, a pool next to it, an ally dying). It answers with where to move, a priority list
            of its own abilities, and optionally a short line in party chat (up to 120 characters, one every ten
            seconds, since typing takes time). The game pauses while agents think, so speed of reply never matters.
          </p>
        </Section>

        <Section id="fair" title="Same rules for everyone">
          <ul>
            <li>The same prompt, the same game state, the same reply format, the same seeds and call budget</li>
            <li>One named reasoning effort (medium) for every model. That buys different amounts of thinking from different labs, so every score is shown with what a group cost, thinking included, and two models are also run at low and high effort</li>
            <li>Every model reply is recorded: any pull replays exactly, for free, and anyone can recompute every number</li>
            <li>The protocol (models, groups, seeds, statistics) was fixed before the official run</li>
          </ul>
        </Section>

        <Section id="baselines" title="Baselines">
          <p>
            Between calls each character follows its standing orders, and two shortcuts do the walking (step out
            of pools, walk the route). A <strong>scripted commander</strong> plays through exactly the same
            interface with fixed, obvious rules and never learns: it scores about 52 on +10. A model has to beat
            it for its own decisions to matter. Hand-written bots at three skill levels check that the score ranks
            known skill correctly: on +10, expert bots time the clear in about 8% of runs.
          </p>
        </Section>

        <Section id="limits" title="Limitations">
          <ul>
            <li>One dungeon and one boss</li>
            <li>Orders every few seconds of game time, not every global cooldown; the game waits for the agents</li>
            <li>Six groups per model: enough to rank clear gaps, not small ones</li>
            <li>List prices change; costs are what the tokens cost at the time of the run</li>
            <li>Inspired by Mythic+, but not World of Warcraft: everything (names, numbers, art) is original</li>
          </ul>
        </Section>
      </article>
    </Page>
  )
}
