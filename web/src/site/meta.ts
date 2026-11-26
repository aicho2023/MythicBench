// Per-page titles and share cards. Used at runtime (document.title) and at build
// time: vite.config.ts writes a copy of index.html per route with these tags, so
// link previews on X, Slack and Discord work without running JavaScript.

export interface PageMeta { path: string; title: string; description: string }

const DESCRIPTION = 'An LLM eval: five agents, one per character, run a Mythic+-style dungeon they have never seen, '
  + 'talk it over after each wipe, and try again. Leaderboard, replays of every pull, and the write-up.'

export const PAGES: PageMeta[] = [
  { path: '/', title: 'MythicBench: Can AI Agents Learn How to Defeat MMORPG Dungeons?', description: DESCRIPTION },
  { path: '/watch', title: 'Watch a run | MythicBench', description: 'Replays of every pull in the benchmark, in 3D, with every decision the model made.' },
  { path: '/highlights', title: 'Highlights | MythicBench', description: 'The best moments from the official run: breakthroughs, arguments, clutch saves and spectacular wipes, each a click from the replay.' },
  { path: '/report', title: 'Report | MythicBench', description: 'How MythicBench works, what it measures, and what the models did.' },
  { path: '/party', title: 'The Party | MythicBench', description: 'Every character and ability in MythicBench, the enemies of the Hollow Vault, and the affixes.' },
  { path: '/compare', title: 'Side by side | MythicBench', description: 'Two MythicBench replays on one clock, seen from above.' },
  { path: '/about', title: 'About | MythicBench', description: 'Why MythicBench exists, what it tests, how a run works, and who made it.' },
  { path: '/changelog', title: 'Changelog | MythicBench', description: 'What changed in the MythicBench game and harness, version by version.' },
]

export const OG_IMAGE = '/og.jpg'

/** The report's old addresses, which still open it. */
const ALIASES: Record<string, string> = { '/paper': '/report', '/commentary': '/report' }

export function metaFor(path: string): PageMeta {
  const top = '/' + (path.split('/')[1] ?? '')
  const found = PAGES.find((p) => p.path === (ALIASES[top] ?? top))
  // Only /watch has sub-pages; any other deeper or unknown path is the not-found page.
  if (!found || (top !== '/watch' && path !== top)) return { path, title: 'Page not found | MythicBench', description: DESCRIPTION }
  return found
}
