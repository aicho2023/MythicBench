// Findings from the official v1 run, quoted on the home page and in the report.
// The tables are computed from the data (site/facts.ts); what's left here is
// prose, and the numbers in it are checked against the data by facts.test.ts.

/** Pulls worth watching: [label, viewer path, what happens]. */
export const MOMENTS: { title: string; path: string; text: string }[] = [
  {
    title: 'The closest anyone came',
    path: '/watch/gpt-6.2-sol/plus10/0/4',
    text: 'GPT-6.2 Sol, group 1, pull 4: the whole party alive at the timer, Oruth at 8.7%. Claude Opus 5.5 came within 9.0% (group 2, pull 2).',
  },
  {
    title: 'Saw it work, then saw it fail',
    path: '/watch/gpt-6-luna/plus10/6/4?t=115',
    text: 'GPT-6 Luna, group 7, pull 4. Ivy calls "stand in its pool!", and she and Wren soak the first Pyre: Wren\'s shield absorbs her whole 11.4k share, and the other three take nothing. The next Pyre goes off with only Ivy inside and kills Wren and Kit. In her notes, Wren writes that the circle "does NOT protect anyone", citing her death: "At the second blast I took 31.8k and died". Next pull, as they pull Oruth, Brask says "Stay out of Bone Pyre".',
  },
  {
    title: 'Found it, lost it, found it again',
    path: '/watch/claude-sonnet-5-5/plus10/2/3',
    text: 'Claude Sonnet 5.5, group 3. The healer notices after pull 2 that the tank took less inside the circle. In pull 3 the whole party soaks once, but nobody writes it down. Only after pull 4\'s wipe do the notes say to stand in it.',
  },
]

/** What the results suggest beyond the game: Section 7 of the report. Each
 * claim restates a result from Sections 5 and 6, and carries their caveats:
 * one task, six groups per model. Covers all seven v1 models (Amendment 3 included). */
export const LESSONS: { id: string; title: string; evidence: string; takeaway: string; section: string }[] = [
  {
    id: 'first-try',
    title: 'A first attempt says little about who will learn',
    evidence: 'On the blind first pull, every model scored about what a fixed-rule bot does. The gap between models opened on the second pull and after.',
    takeaway: 'If an agent is meant to improve with feedback, such as revising its own work, retrying a failed job or picking up a team’s conventions, score it over several rounds of feedback, not one attempt. A one-attempt test would have put these seven models within a few points of each other.',
    section: 'learning',
  },
  {
    id: 'against-habit',
    title: 'Learning a rule that runs against habit is rare',
    evidence: 'Bone Pyre asks players to stand inside a glowing circle, the opposite of what games usually teach. Claude Opus 5.5 and GPT-6.2 Sol learned to soak it in all twelve of their groups, eleven of them after a single wipe. The other five models, from four labs between them, did in 6 of their 42 groups.',
    takeaway: 'Many workflows have a rule like this: an in-house way of doing something that differs from the usual one. Don’t assume an agent will work such a rule out from its failures, even with the evidence in front of it. Either state the rule, or check that the model you use can learn one like it.',
    section: 'pyre',
  },
  {
    id: 'memory',
    title: 'Memory only helps a model that draws the right lesson',
    evidence: 'The pre-registered memory test switched off the debrief, talk and notes for Claude Haiku 5.5 and GPT-6 Luna, and found no clear difference in score. Neither had learned to soak Bone Pyre, so their notes had little of use to carry. The test was not run on the models that did learn.',
    takeaway: 'Giving an agent notes, reflection or a memory store is not a fix by itself: what it keeps is only as good as the lesson it draws. Check whether the stored lessons are right, not just whether there is memory.',
    section: 'memory',
  },
  {
    id: 'knowing-doing',
    title: 'Knowing the plan is not the same as carrying it out',
    evidence: 'In Grok 4.3’s first group, all five agents’ notes after the first wipe say the Pyre must be soaked and name the two players who will do it. Over the next four pulls the party gets two players inside on 2 of 9 Pyres, and across Grok’s groups the Pyre often went off with one player in it, not two. GPT-6.2 Sol names the soak in every group after its first wipe, but gets two agents into the circle in time on about three Pyres in four, while also dodging pools, interrupting casts and holding adds.',
    takeaway: 'What an agent writes about what it will do overstates how reliably it does it, most of all when the plan competes with other demands. Judge agents by what they did, not by their plans or notes.',
    section: 'pyre',
  },
  {
    id: 'consensus',
    title: 'In a team, the lesson that gets written down wins, right or wrong',
    evidence: 'In one GPT-6 Luna group, two players soaked a Pyre and nobody was hurt; the next went off with one player inside and killed two. The notes that followed generalised from the deaths, and the party stopped soaking. In four of DeepSeek V4.1 Flash’s six groups, two or more agents wrote after the first wipe that the Pyre was “unavoidable”; in three of them the claim was still in the notes before the last pull.',
    takeaway: 'Agents that share notes or a memory can settle on a wrong lesson as easily as a right one, and a confident note spreads. Systems that share memory should check lessons against the record, not against how many agents agree.',
    section: 'cases',
  },
  {
    id: 'effort',
    title: 'More thinking and a higher price did not buy learning',
    evidence: 'On the same groups, Claude Haiku 5.5 did worse at low effort and barely better at high, and GPT-6 Luna scored the same at every level. Claude Opus 5.5 and GPT-6.2 Sol learned equally well, but an Opus group cost about five times as much.',
    takeaway: 'Turning up reasoning effort did not make a model learn here; the choice of model did. Among models that can learn a task, compare what each costs.',
    section: 'cost',
  },
]

/** The expert script on 1,000 practice seeds (10001-11000), outside the official schedules. */
export const EXPERT = { seeds: 1000, normal: { clears: 898, score: 79.2 }, plus10: { clears: 4, score: 49.9 } }
