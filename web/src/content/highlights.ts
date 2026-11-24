import data from './highlights.json'

// Moments from the official v1 replays worth seeing without a deep dive, shown
// on /highlights and on the home page. Every quote is verbatim from the
// replay file it points to (chat events, the debrief talk, the agents' notes or
// their recorded thinking); `t` is where the viewer opens, in seconds.

export type HighlightKind = 'eureka' | 'argument' | 'clutch' | 'teamwork' | 'blunder' | 'funny' | 'reasoning' | 'record'

export interface Quote {
  who: string
  where: 'chat' | 'debrief talk' | 'notes' | 'thinking'
  /** seconds into the pull, for chat and thinking */
  t?: number | null
  text: string
}

export interface Highlight {
  id: string
  title: string
  kind: HighlightKind
  model: string
  tier: string
  memory?: boolean
  /** 0-based, as in the data and URLs */
  episode: number
  pull: number
  /** where the viewer opens, in seconds; null opens the pull at the start */
  t: number | null
  summary: string
  quotes: Quote[]
  /** a number that makes it a record, e.g. "Oruth at 8.7%" */
  stat?: string
  /** still from the viewer at the moment, under web/public/stills/ (default <id>.jpg) */
  image?: string
}

export const KIND_LABEL: Record<HighlightKind, string> = {
  eureka: 'Breakthrough', argument: 'Argument', clutch: 'Clutch', teamwork: 'Teamwork',
  blunder: 'Blunder', funny: 'Funny', reasoning: 'Reasoning', record: 'Record',
}

/** Edit highlights.json; `python3 scripts/check_highlights.py` checks every quote against the replays. */
export const HIGHLIGHTS: Highlight[] = (data as Highlight[]).map((h) => ({ image: `stills/${h.id}.jpg`, ...h }))

/** The viewer address for a highlight, opening at its moment. */
export function highlightPath(h: Highlight): string {
  const mem = h.memory === false ? '/memory-off' : ''
  const q = h.t != null ? `?t=${h.t}` : ''
  return `/watch/${encodeURIComponent(h.model)}/${h.tier}${mem}/${h.episode}/${h.pull}${q}`
}
