// Findings from the official v1 run, quoted on the home page and in the report.
// The scores come from results/v1/leaderboard.json. The behaviour counts
// (Bone Pyre soaks, kicks, chat, closest pulls) were tallied from the same
// dataset's replays; anyone can recount them from web/public/results/v1.

/** Bone Pyre on +10: groups whose party soaked it at least once, and soaked
 * detonations on pulls 2-5. No group soaked on pull 1. */
export const SOAKS: { model: string; groups: string; soaked: string; note?: string }[] = [
  { model: 'claude-opus-5-5', groups: '6 of 6', soaked: '77 of 92', note: 'all after the first wipe' },
  { model: 'gpt-6.2-sol', groups: '6 of 6', soaked: '71 of 95', note: '5 after the first wipe, 1 after the second' },
  { model: 'deepseek-flash', groups: '1 of 6', soaked: '7 of 53' },
  { model: 'claude-sonnet-5-5', groups: '1 of 6', soaked: '6 of 48' },
  { model: 'grok-4.3', groups: '2 of 6', soaked: '3 of 50' },
  { model: 'gpt-6-luna', groups: '2 of 12', soaked: '5 of 117' },
  { model: 'claude-haiku-5-5', groups: '0 of 12', soaked: '0 of 93' },
]

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

/** How each party played on +10 (all its memory-on groups): share of kickable casts
 * interrupted, party-chat lines and deaths per pull. */
export const BEHAVIOUR: { model: string; kicks: string; chat: number; deaths: number }[] = [
  { model: 'claude-opus-5-5', kicks: '82%', chat: 76, deaths: 4.6 },
  { model: 'gpt-6.2-sol', kicks: '82%', chat: 49, deaths: 4.6 },
  { model: 'gpt-6-luna', kicks: '74%', chat: 16, deaths: 5.0 },
  { model: 'deepseek-flash', kicks: '73%', chat: 61, deaths: 5.2 },
  { model: 'claude-sonnet-5-5', kicks: '68%', chat: 36, deaths: 5.1 },
  { model: 'grok-4.3', kicks: '70%', chat: 10, deaths: 5.3 },
  { model: 'claude-haiku-5-5', kicks: '70%', chat: 66, deaths: 5.2 },
]

/** What the results suggest beyond the game: shown as cards on the home page
 * (title + short) and as Section 7 of the report (evidence + takeaway). Each
 * claim restates a result from Sections 5 and 6, and carries their caveats:
 * one task, six groups per model. Covers all seven v1 models (Amendment 3 included). */
export const LESSONS: { id: string; title: string; short: string; evidence: string; takeaway: string; section: string }[] = [
  {
    id: 'first-try',
    title: 'A first attempt says little about who will learn',
    short: 'On the blind first pull every model played about the same. The gap opened only after the first failure, where a one-attempt test can’t see it.',
    evidence: 'On the blind first pull, every model scored about what a fixed-rule bot does. The gap between models opened on the second pull and after.',
    takeaway: 'If an agent is meant to improve with feedback, such as revising its own work, retrying a failed job or picking up a team’s conventions, score it over several rounds of feedback, not one attempt. A one-attempt test would have put these seven models within a few points of each other.',
    section: 'learning',
  },
  {
    id: 'against-habit',
    title: 'Learning a rule that runs against habit is rare',
    short: 'Standing in the fire goes against every gamer’s instinct. After one wipe, Claude Opus 5.5 and GPT-6.2 Sol learned it in every group. The other five almost never did.',
    evidence: 'Bone Pyre asks players to stand inside a glowing circle, the opposite of what games usually teach. Claude Opus 5.5 and GPT-6.2 Sol learned to soak it in all twelve of their groups, eleven of them after a single wipe. The other five models, from four labs between them, did in 6 of their 42 groups.',
    takeaway: 'Many workflows have a rule like this: an in-house way of doing something that differs from the usual one. Don’t assume an agent will work such a rule out from its failures, even with the evidence in front of it. Either state the rule, or check that the model you use can learn one like it.',
    section: 'pyre',
  },
  {
    id: 'memory',
    title: 'Memory only helps a model that draws the right lesson',
    short: 'Switching off the debrief and notes made no clear difference to the two models that never learned the key mechanic.',
    evidence: 'The pre-registered memory test switched off the debrief, talk and notes for Claude Haiku 5.5 and GPT-6 Luna, and found no clear difference in score. Neither had learned to soak Bone Pyre, so their notes had little of use to carry. The test was not run on the models that did learn.',
    takeaway: 'Giving an agent notes, reflection or a memory store is not a fix by itself: what it keeps is only as good as the lesson it draws. Check whether the stored lessons are right, not just whether there is memory.',
    section: 'memory',
  },
  {
    id: 'knowing-doing',
    title: 'Knowing the plan is not the same as carrying it out',
    short: 'In one Grok 4.3 group, every agent’s notes named who would stand in the Pyre; they managed it on 2 of the next 9. Even GPT-6.2 Sol did on about three in four.',
    evidence: 'In Grok 4.3’s first group, all five agents’ notes after the first wipe say the Pyre must be soaked and name the two players who will do it. Over the next four pulls the party gets two players inside on 2 of 9 Pyres, and across Grok’s groups the Pyre often went off with one player in it, not two. GPT-6.2 Sol names the soak in every group after its first wipe, but gets two agents into the circle in time on about three Pyres in four, while also dodging pools, interrupting casts and holding adds.',
    takeaway: 'What an agent writes about what it will do overstates how reliably it does it, most of all when the plan competes with other demands. Judge agents by what they did, not by their plans or notes.',
    section: 'pyre',
  },
  {
    id: 'consensus',
    title: 'In a team, the lesson that gets written down wins, right or wrong',
    short: 'Parties argued away a right answer after one bad outcome, or agreed on a wrong one and kept it. Agreement between agents is not evidence that they are right.',
    evidence: 'In one GPT-6 Luna group, two players soaked a Pyre and nobody was hurt; the next went off with one player inside and killed two. The notes that followed generalised from the deaths, and the party stopped soaking. In four of DeepSeek V4.1 Flash’s six groups, two or more agents wrote after the first wipe that the Pyre was “unavoidable”; in three of them the claim was still in the notes before the last pull.',
    takeaway: 'Agents that share notes or a memory can settle on a wrong lesson as easily as a right one, and a confident note spreads. Systems that share memory should check lessons against the record, not against how many agents agree.',
    section: 'cases',
  },
  {
    id: 'effort',
    title: 'More thinking and a higher price did not buy learning',
    short: 'Raising the cheaper models’ reasoning effort didn’t help, and the two models that learned were five times apart in cost.',
    evidence: 'On the same groups, Claude Haiku 5.5 did worse at low effort and barely better at high, and GPT-6 Luna scored the same at every level. Claude Opus 5.5 and GPT-6.2 Sol learned equally well, but an Opus group cost about five times as much.',
    takeaway: 'Turning up reasoning effort did not make a model learn here; the choice of model did. Among models that can learn a task, compare what each costs.',
    section: 'cost',
  },
]

/** The expert script on 1,000 practice seeds (10001-11000), outside the official schedules. */
export const EXPERT = { seeds: 1000, normal: { clears: 898, score: 79.2 }, plus10: { clears: 4, score: 49.9 } }
