// The site's colours, in one place. tailwind.config.js reads this file for its classes
// (text-fg, bg-surface, ...), and code that needs a colour as a value (SVG fills, inline
// styles, canvas) imports it from here, so the two can't drift apart.
//
// Game colours (classes, spell schools, enemies) live in content/display.ts: they belong
// to the dungeon, not to the interface.

export const COLOR = {
  // Graphite surfaces; the 3D scene supplies the colour.
  bg: '#0a0a0c',
  surface: '#111113',
  raised: '#1a1a1d',
  /** Behind a replay image or clip before it loads: the crypt's own darkness. */
  scene: '#0d0a18',
  // Three text roles, and one step below them for marks that are switched off.
  fg: '#ededef',
  fgMuted: '#a1a1aa',
  fgFaint: '#8b8b93',
  off: '#5c5c66',
  line: 'rgba(255,255,255,0.08)',
  // Bone, from the crypt: marks what a model learned. Used rarely.
  accent: '#e6d3a3',
  // Semantic colours mean one thing each, toned to sit inside the graphite ramp.
  good: '#4cc38a',
  bad: '#e5484d',
  warn: '#e2a336',
  info: '#6cb8e6',
} as const
