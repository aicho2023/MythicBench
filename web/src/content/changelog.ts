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
    id: 'site-polish',
    date: '2026-11-24',
    title: 'Site: new highlights, the party page and next steps',
    kind: 'docs',
    summary: 'Three highlights from the Grok 4.3 and DeepSeek V4.1 Flash runs, a redesigned party page, and a lighter home page. Nothing that plays changed, and no score moved.',
    items: [
      'Highlights: three new moments from the two added models, each checked word for word against its replay. "Eureka" is now "Breakthrough".',
      'The party page shows one character or enemy at a time, with its abilities below.',
      'Report: a Next steps section and an author line. Home: a clearer cost chart with the scripted bot as a reference line.',
    ],
  },
  {
    id: 'amendment-3-results',
    date: '2026-11-24',
    title: 'Results: Grok 4.3 and DeepSeek V4.1 Flash',
    kind: 'docs',
    versions: V1,
    summary: 'The two models added by Amendment 3 have played all their groups. The leaderboard, charts, report and data now cover seven models from four labs.',
    items: [
      'Grok 4.3 scores 32.4 and DeepSeek V4.1 Flash 33.4, level with Claude Sonnet 5.5, Claude Haiku 5.5 and GPT-6 Luna. Neither cleared, and neither learned to soak Bone Pyre: Grok\'s parties soaked 3 of 65 Pyres, DeepSeek\'s 7 of 64.',
      'Pairwise comparisons are now corrected for all 21 pairs, as pre-registered. Opus is clearly ahead of GPT-6 Luna, Claude Sonnet 5.5 and Grok 4.3, and Sol of GPT-6 Luna and DeepSeek V4.1 Flash. Opus and Sol over Claude Haiku 5.5, clear among five models, fall short under the stricter correction; neither score changed.',
      'DeepSeek V4.1 Flash had 6.6% of its replies cut off at the 8,000-token cap every model shares, far more than any other model. They count against it, and the report says so.',
      'All 525 pulls replay exactly from the published recordings. The five earlier models\' results are unchanged.',
    ],
  },
  {
    id: 'beyond-the-game',
    date: '2026-11-24',
    title: 'Report: what carries over beyond the game',
    kind: 'docs',
    summary: 'A new section on what the results suggest beyond the game, and edits throughout the report.',
    items: [
      'New Section 7, "Beyond the game": six results that look likely to hold wherever agents are meant to learn from feedback, each with its evidence and caveats. They also appear on the home page.',
      'Edits to the introduction, related work and conclusion, and to the reference list.',
    ],
  },
  {
    id: 'amendment-3',
    date: '2026-11-23',
    title: 'Pre-registration amendment 3: two more labs',
    kind: 'protocol',
    summary: 'Grok 4.3 and DeepSeek V4.1 Flash join v1, on the same frozen game, prompt and seeds. Their results are not in yet.',
    items: [
      'Each plays six ranked +10 groups at medium effort through its lab\'s own API, exactly as the first five models did.',
      'The code adds only the new API clients and their prices; what models see and how they are scored is unchanged, so the harness stays 1.0.0 and the published results stand.',
      '"Medium" maps to each lab\'s own setting: Grok\'s reasoning effort medium, and DeepSeek\'s high (its documented equivalent).',
      'Gemini 3.8 Flash was tested and dropped before playing: its notes were never valid JSON, so it would have played every pull with no memory. Qwen4-Max was dropped for lack of API access.',
      'xAI\'s API can\'t cap Grok\'s reasoning, so the 8,000-token cap the other models live under is applied when its replies are read.',
    ],
  },
  {
    id: 'claims-pass',
    date: '2026-11-23',
    title: 'Report claims matched to the evidence',
    kind: 'docs',
    summary: 'Wording changes after an outside review. Nothing that plays changed, and no score moved.',
    items: [
      'The abstract no longer says both leaders are clearly ahead of the other three: GPT-6.2 Sol\'s lead over Claude Sonnet 5.5 falls just short after correction. It gives the scores instead.',
      'The memory test is described as what it measured: the debrief, talk and notes together, on Claude Haiku 5.5 and GPT-6 Luna only, with no clear benefit.',
      'The "safe" fault: the 16 cancelled casts are the one counted consequence; its total effect on scores was not measured. The throne fault is described as kept by an amendment after stage 1.',
      'The GPT-6 Luna case now tells the whole pull: the soak worked, the next Pyre killed two, and the notes carried the wrong lesson.',
    ],
  },
  {
    id: 'safe-fault',
    date: '2026-11-23',
    title: 'Disclosed: a second harness fault in "safe"',
    kind: 'docs',
    summary: 'Found while reviewing v1 replays. Disclosed in the report; nothing that plays changed, and no score moved.',
    items: [
      'The rules say "safe" steps to the nearest spot clear of the pools. An agent already clear but out of reach of its target, with no dry spot in reach, was moved to another clear spot instead of staying put, and could shuffle back and forth while it kept sending "safe".',
      'In the 420 pulls the models played it happened 2,567 times, almost all to GPT-6 Luna (1,726) and Claude Haiku 5.5 (820). Only 16 of those moves cut a cast short.',
      'v1 keeps the fault, since its code is frozen. The fix comes with the next harness version.',
    ],
  },
  {
    id: 'report-related-work',
    date: '2026-11-23',
    title: 'Highlights, related work and a corrected Pyre count',
    kind: 'docs',
    summary: 'Text and site changes only; nothing that plays changed, and no score moved.',
    items: [
      'A highlights page: 20 moments from the v1 replays, each quote checked word for word against the replay it comes from.',
      'The report gains a related-work section with 37 references and a comparison with other agent and game benchmarks.',
      "Correction: Claude Haiku 5.5's Bone Pyre count now covers pulls 2 to 5 like every other model's (0 of 93, was 0 of 116).",
    ],
  },
  {
    id: 'v1-results',
    date: '2026-11-23',
    title: 'Official v1 results',
    kind: 'protocol',
    summary: 'Stage 2 finished and the v1 results are published: the leaderboard, every pull as a replay, and the recorded replies behind them.',
    items: [
      'All 93 planned groups played (84 by five models, 9 by the scripted bot); all 465 pulls replay exactly from the recordings.',
      'Every call was served by the model asked for. No API errors or refusals.',
      'One occurrence of the known throne fault in 127,071 moves, the one found in stage 1, listed in the report.',
      'The pre-registration\'s stage 2 record discloses that interim scores were looked at during stage 2, and that the +10 calibration predates the freeze.',
    ],
  },
  {
    id: 'expert-script',
    date: '2026-11-23',
    title: 'The expert script: proof a clear is possible',
    kind: 'release',
    summary: 'A scripted party that knows the fight, added as the golden standard. Nothing the models see or play changes: harness, sim and content versions are the same.',
    items: [
      'It plays through the agents\' own interface and blind view: it reads the same text and sends the same orders, every 4 seconds of game time. Only its rules know the fight.',
      'Two players soak Bone Pyre, a marked player walks clear, nobody walks through a pool, the tank saves Ironhide for Soul Rend, and the healer attacks only when nobody needs healing.',
      'On 1,000 practice seeds (outside the official schedules) it clears Normal 898 times and +10 4 times, each +10 clear with a second or less to spare.',
      'Its clears on both difficulties are in the viewer, under "Golden standard".',
    ],
  },
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
