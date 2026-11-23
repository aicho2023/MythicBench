// Findings from the official v1 run, quoted on the home page and in the report.
// The scores come from results/v1/leaderboard.json. The behaviour counts
// (Bone Pyre soaks, kicks, chat, closest pulls) were tallied from the same
// dataset's replays; anyone can recount them from web/public/results/v1.

/** Bone Pyre on +10: groups whose party soaked it at least once, and soaked
 * detonations on pulls 2-5. No group soaked on pull 1. */
export const SOAKS: { model: string; groups: string; soaked: string; note?: string }[] = [
  { model: 'claude-opus-5-5', groups: '6 of 6', soaked: '77 of 92', note: 'all after the first wipe' },
  { model: 'gpt-6.2-sol', groups: '6 of 6', soaked: '71 of 95', note: '5 after the first wipe, 1 after the second' },
  { model: 'claude-sonnet-5-5', groups: '1 of 6', soaked: '6 of 48' },
  { model: 'gpt-6-luna', groups: '2 of 12', soaked: '5 of 117' },
  { model: 'claude-haiku-5-5', groups: '0 of 12', soaked: '0 of 116' },
]

/** Pulls worth watching: [label, viewer path, what happens]. */
export const MOMENTS: { title: string; path: string; text: string }[] = [
  {
    title: 'The closest anyone came',
    path: '/watch/gpt-6.2-sol/plus10/0/4',
    text: 'GPT-6.2 Sol, group 1, pull 4: the whole party alive at the timer, Oruth at 8.7%. Claude Opus 5.5 came within 9.0% (group 2, pull 2).',
  },
  {
    title: 'Right answer, talked out of it',
    path: '/watch/gpt-6-luna/plus10/6/4',
    text: 'GPT-6 Luna, group 7, pull 4. Ivy calls "stand in its pool!", she and Wren soak the Pyre, and the other three take no damage. In the notes afterwards, Wren, who stood in it and took nothing, writes that the circle "does NOT protect anyone". Next pull, Brask opens with "Stay out of Bone Pyre".',
  },
  {
    title: 'Found it, lost it, found it again',
    path: '/watch/claude-sonnet-5-5/plus10/2/3',
    text: 'Claude Sonnet 5.5, group 3. The healer notices after pull 2 that the tank took less inside the circle. In pull 3 the whole party soaks once, but nobody writes it down. Only after pull 4\'s wipe do the notes say to stand in it.',
  },
]
