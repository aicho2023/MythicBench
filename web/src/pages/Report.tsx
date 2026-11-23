import type { ReactNode } from 'react'
import { modelName } from '../content/display'
import { MOMENTS, SOAKS } from '../content/findings'
import { Page } from '../site/Layout'
import { Link } from '../site/router'

const A = 'underline decoration-accent/50 underline-offset-4 hover:decoration-accent'

function Sub({ children }: { children: ReactNode }) {
  return <h3 className="!mt-8 text-[16px] font-medium text-fg">{children}</h3>
}

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
            What five frontier models did in the Hollow Vault, and how MythicBench works.
          </p>
          <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2 text-[13px]">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-lg border border-line px-3 py-1.5 text-fg-muted transition-colors hover:border-white/20 hover:text-fg">{label}</a>
            ))}
          </nav>
        </header>

        <Section id="results">
          <p>
            Five models played 84 groups, 420 pulls in all, on the frozen v1 harness. <strong>Nobody cleared the
            Hollow Vault</strong>, on +10 or on Normal. The two strongest models came within 9% of killing Oruth, and
            what set them apart wasn't their first attempt but what they learned from one wipe.
          </p>

          <Sub>Who is best</Sub>
          <p>
            On the pre-registered score, <strong>Claude Opus 5.5 (44.1)</strong> and <strong>GPT-6.2 Sol (42.9)</strong> lead,
            and they are statistically tied. Opus beats GPT-6 Luna, Claude Sonnet 5.5 and Claude Haiku 5.5 on the same
            seeds (by 11 to 12 points each); Sol beats Luna and Haiku (10 to 11 points). Sol's 10-point lead over Sonnet
            falls just short after correcting for comparing every pair. Luna (32.8), Sonnet (32.7) and Haiku (32.1)
            can't be told apart, and none of them beats a scripted bot that kicks every cast and steps out of every
            pool (32.5). The <Link to="/" className={A}>leaderboard</Link> has every group as a dot.
          </p>

          <Sub>One wipe makes the difference</Sub>
          <p>
            On a first attempt, every model scores between 31 and 37: about what the scripted bot gets. They all walk
            in blind and wipe. The gap opens after the debrief. Claude Opus 5.5 averages 37 on its first pull and 52 on
            its second; GPT-6.2 Sol climbs from 37 to 47 by its fourth. The other three stay flat.
          </p>
          <p>
            The clearest single reason is <strong>Bone Pyre</strong>: a circle Oruth marks on the floor that has to be
            stood in by two players, or it hits the whole party hard. Every gamer instinct says to step out of the glowing
            circle, and on the first pull every party does. Afterwards, everyone sees the same thing in the combat log:
            nobody stood in it, and everyone got hit. What they make of it:
          </p>
          <div className="not-prose my-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-line text-fg-faint">
                <tr><th className="px-3 py-2 font-normal">Model (+10)</th><th className="px-3 py-2 font-normal">Groups that learned to soak</th><th className="px-3 py-2 font-normal">Pyres soaked, pulls 2-5</th></tr>
              </thead>
              <tbody className="text-fg-muted">
                {SOAKS.map((r) => (
                  <tr key={r.model} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 text-fg">{modelName(r.model)}</td>
                    <td className="px-3 py-2">{r.groups}{r.note ? <span className="text-fg-faint">, {r.note}</span> : null}</td>
                    <td className="px-3 py-2">{r.soaked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Opus wrote "EVERYONE STACK INSIDE THE CIRCLE"; Sol, "BONE PYRE is a soak, not a pool to dodge". Luna, from
            the same evidence: "the floor circle is NOT the danger". Knowing isn't doing, either: Sol names the soak in
            every group after its first wipe, but gets five agents into a 2.5 m circle within six seconds on three
            Pyres in four.
          </p>
          <p>
            The pre-registered test of memory (the same seeds with the debrief, talk and notes switched off) was run on
            the two cheapest models, Haiku and Luna, and found nothing: −0.8 and −0.2 points, both well within noise.
            That fits: those two never learned the mechanic, so there was nothing to carry. The models that did learn
            weren't part of that test, so their gains are shown as before and after, not as a controlled effect.
          </p>

          <Sub>Pulls worth watching</Sub>
          <ul>
            {MOMENTS.map((m) => (
              <li key={m.path}><Link to={m.path} className={A}>{m.title}</Link>. {m.text}</li>
            ))}
          </ul>

          <Sub>What it costs</Sub>
          <p>
            The whole official run cost about $357 at list prices. Opus was $221 of it: $37 a group, against $7 for Sol,
            which scores the same. Sol is also the most economical writer: about 44,000 output tokens a pull, against
            roughly 210,000 for Opus and 225,000 for Haiku. Raising the cheap models' reasoning effort didn't help: on the
            same groups, Haiku scored 25 at low, 30 at medium and 32 at high (where 16 replies ran into the output cap);
            Luna scored about 33 at every level.
          </p>

          <Sub>How the parties played</Sub>
          <p>
            Every party organised its own interrupts. Opus and Sol stopped 82% of the casts that can be kicked; the
            other three 68% to 74%. Talking more isn't the same as learning: Opus's party sent about 76 chat lines a pull and
            Haiku's 66, while Luna's sent 16 and Sol's 49. Nearly every pull ended in a wipe (4.6 to 5.3 deaths a pull).
          </p>

          <Sub>Checks on the data</Sub>
          <ul>
            <li>All 93 planned groups were played (84 by the models, 9 by the scripted bot), and all 465 pulls replay exactly from the recorded replies, so anyone can recompute every number for free.</li>
            <li>Each provider served exactly the model that was asked for, on every call.</li>
            <li>No API errors and no refusals. Replies that were unusable or cut off were the models' own: about 0.6% of Sonnet's calls, and Haiku's at high effort when it ran out of output tokens.</li>
            <li>
              One known harness fault, kept as pre-registered and counted by the rule fixed before stage 2: <strong>one
              occurrence</strong> in 127,071 moves. Claude Haiku 5.5, Normal, group 1, pull 4, at 3:44.7, Wren walks through
              the corner of Oruth's throne (a floating-point edge case; it saves about a second and can't trap or harm
              anyone). <Link to="/watch/claude-haiku-5-5/normal/0/4" className={A}>Watch it</Link>.
            </li>
            <li>Interim scores were looked at while stage 2 was playing. Nothing was changed or decided because of them.</li>
          </ul>
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
            healing. It plays through the agents' own interface and blind view and never learns. On 1,000 practice
            seeds outside the official schedule it clears Normal 898 times and +10 only 4 times, each with a second
            or less to spare. A +10 clear exists, but it takes near-perfect play: room for better models to find it.
            Its clears are in the <Link to="/watch" className="underline decoration-accent/50 underline-offset-4">viewer</Link>.
          </p>
          <p>
            +10 was calibrated in pilot runs of GPT-6.2 Sol, on seeds outside the official schedule, so that the
            strongest models would clear it some of the time. That tuning was on an earlier version, where Sol cleared
            some pulls. Later changes (Bone Pyre, shorter melee reach, solid obstacles) made the fight harder, and
            the calibration was not re-run before the freeze; the expert script measures how hard it ended up. Sol is
            also one of the ranked models.
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
