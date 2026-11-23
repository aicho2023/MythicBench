// The public changelog (/changelog): what changed in the game and the harness,
// newest first. Add an entry for every release, protocol amendment or harness
// change. The versions are the ones runs record (HARNESS_VERSION in
// sim/mythicsim/llm/__init__.py, SIM_VERSION in engine.py, CONTENT_VERSION in
// content.py); results from different versions are never compared as one.

export interface Versions { harness: string; sim: string; content: string }

export interface ChangelogEntry {
  /** Anchor on the page, e.g. /changelog#v1.0.0 */
  id: string
  date: string // YYYY-MM-DD
  title: string
  /** release: new code; protocol: how the official run is done; docs: text only */
  kind: 'release' | 'protocol' | 'docs'
  /** The versions that play after this entry (left out when nothing that plays changed). */
  versions?: Versions
  /** Git tag, linked to GitHub. */
  tag?: string
  summary: string
  items: string[]
}

const V1: Versions = { harness: '1.0.0', sim: '0.11.0', content: '1.8.0' }

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: 'amendment-2',
    date: '2026-11-23',
    title: 'Stage 1 review and pre-registration amendment 2',
    kind: 'protocol',
    summary: 'Stage 1 of the official run was checked for harness faults before stage 2. Nothing that plays changed.',
    items: [
      'Stage 1 played 15 groups (75 pulls), and all 75 replay exactly from the recorded replies.',
      'No crashes, API errors, refusals or broken prompts. Unusable or cut-off replies were model errors and count against the model.',
      'One harness fault: in one pull a character standing exactly on the throne\'s edge walked through it, because floating-point arithmetic put her 4e-16 m inside. It saves about a second of walking and can\'t trap or harm anyone.',
      'The fault was judged immaterial and deliberately not fixed, so every v1 group plays the same code. Every occurrence in the final data is counted and listed in the report.',
    ],
  },
  {
    id: 'v1.0.1',
    date: '2026-11-22',
    title: 'v1.0.1: the analysis, tightened',
    kind: 'docs',
    tag: 'v1.0.1',
    summary: 'Pre-registration amendment 1, made after an outside review and before any official data. The code that plays is unchanged from v1.0.0.',
    items: [
      'One model is called better than another only where their scores on the same seeds, group by group, differ clearly: a paired test, corrected (Holm) for comparing every pair.',
      'Clear rates come with exact (Clopper-Pearson) intervals.',
      'The restart on reserve seeds, used if a harness fault is found, is now a pinned protocol of its own.',
      'The model ids each provider actually served are recorded and checked.',
      'The limitations say how the difficulty was calibrated.',
    ],
  },
  {
    id: 'v1.0.0',
    date: '2026-11-22',
    title: 'v1.0.0: frozen for the official run',
    kind: 'release',
    versions: V1,
    tag: 'v1.0.0',
    summary: 'The code the v1 protocol plays, after seven outside reviews. Any change from here is a new version and new runs.',
    items: [
      'Melee reach is 1.5 m and interrupts 2.5 m, edge to edge, so a hit looks like a hit.',
      'Oruth\'s throne and the rooms\' pillars are solid, and moves route around them. Oruth stays in his room; if he can\'t reach his target from it, he fights the nearest player he can reach.',
      'A melee character in reach of its target follows it a little on its own, never into a pool. The "safe" step is judged as the move really goes, and "stop" is a real halt.',
      'The rules state mechanics, not tactics: no suggested standing spots, and the affix texts say what happens, not what to do.',
      'Every provider answer is checked field by field. Spend is held on disk before each request, and model text is cleaned before it goes into another prompt.',
    ],
  },
  {
    id: 'development',
    date: '2026-11',
    title: 'Before v1: development builds',
    kind: 'release',
    summary: 'Harness 0.3 to 0.14. Runs made on these versions are not comparable with v1 and are not on the leaderboard.',
    items: [
      'The full dungeon run: two trash packs, then Oruth, on one timer (0.5).',
      'Two difficulties, Normal and +10, with affixes on +10 (0.6, 0.8).',
      'Blind play: the agents know their own abilities, the map and the affixes, and nothing about the enemies (0.4).',
      'Five agents, one per character, with party chat; between pulls a party talk and each agent\'s own notes, with no guidance on what to learn (0.9).',
      'Orders every 4 seconds of game time and an 8,000-token output cap (0.7). Party chat: one line of 120 characters per character every 10 seconds (0.11, 0.12).',
      'Bone Pyre, a circle that has to be stood in (0.14).',
    ],
  },
]
