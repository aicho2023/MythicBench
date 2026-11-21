# Unslop audit: replay viewer HUD

Scope: `web/src` (the HUD over the 3D scene, the top bar, the About and Model runs drawers,
the learning panel, layout at narrow widths). The 3D scene, replay engine and sim are untouched.

Screens checked: `?replay=expert-clear&t=118&paused=1` at 1440×900 and 800×900, with and
without the Model runs drawer. Before and after captures are in `docs/design/unslop/`.

## Verdict

Light to moderate slop. The viewer was already built with care (one neutral ramp, IBM Plex,
lucide icons, tabular figures), so this is a polish pass, not a redesign. Product, panels and
their order stay. What was left: an instrument-panel voice copied from every AI dashboard
(uppercase tracked mono labels everywhere), a violet accent that competes with the
violet-lit scene, glass cards, bordered pills in the run list, too many type sizes, and a
layout that only works above ~1130px wide.

## Signs found

### Surfaces and color
- `.card` is frosted glass: `backdrop-filter: blur(14px) saturate(1.2)` plus a 24px shadow (`index.css`). Plain raised surface, hairline, small neutral shadow
- Top bar is a blurred translucent strip (`Controls.tsx` TopBar). Solid surface step
- Violet accent `#a78bfa` (`tailwind.config.js`) used for the learning chip, `#tags`, the legacy checkbox, the pull marker and the learning-notes highlight. Violet is the AI default and also the scene's light color, so the chrome blends into the scene instead of sitting quietly over it. Accent changed to bone (see direction), used in two places
- Role icons get their own neon tints (`#8fb8ff`, `#7dff9a`, `#ff8f7a` in `bits.tsx`) next to a class color dot, so every party row has two competing hues. Icons take the text color; class color is the only hue on a unit
- "Status: Phase 1" box in the About drawer is an amber-bordered, amber-tinted callout. Quiet raised surface
- Muted text `#71717a` is under 4.5:1 on the translucent cards over a bright scene. Raised to `#8b8b93`

### Type
- `.label` is uppercase, tracked (`0.06em`), 10.5px mono, used on every panel title: PARTY, SCORECARD, DAMAGE · PER SEC, AGENT DECISIONS, RUN, RESULT, MODEL RUNS · 10, ABOUT THIS EVAL. Sentence case, 12px sans, no tracking
- Other uppercase strings: `enraged`, `interruptible` / `not kickable`, `in combat` / `up next`, `kick`, `… interrupted` / `… completed` (`BossFrame.tsx`). Sentence case
- Eleven sizes in use: 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, plus 15 to 28. Collapsed to 11 / 12 / 13 / 15 / 20 / 28
- Weight 600 and negative tracking on the 14px wordmark; 600 on the result headline and About title. 500 max, no tracking under 16px
- Italic for the boss yell and `<i>policy</i>` in About, and the italic font file is loaded for it. Removed

### Icons
- Mixed icon sizes (11, 13, 14, 15, 16) and strokes (1.5 default, 2, 2.25, 2.5). Controls 16, inline 14, all at the lucide default stroke except ability glyphs
- `✓` glyph in seed chips (`RunBrowser.tsx` ItemChip). Removed, the green score already says it

### Spacing
- Half steps that are off the 4px grid: `px-3.5`, `py-[5px]`, `space-y-[7px]`, `mt-[3px]`, `pt-[1px]`, `translate-y-[±1px]` nudges, `gap-1.5`/`gap-3.5`. Cards share 12px side padding, rows share one height per list
- Party card uses 12px padding, every other card 14px. One value

### Copy
- `replay viewer` sub-label next to the wordmark, `click a row to rewind`, `show learning` / `meter` toggles in lowercase mono. Short sentence-case labels
- Raid warnings shout: `Requiem of Bones — Interrupt!`, `Soul Rend on X — Defensives!` (`content/display.ts`). Plain `Requiem of Bones · interrupt`
- Floating combat text: `Interrupted!` and a `!` on every crit. Crits are already bigger and gold; the `!` goes
- `Nothing yet. Waiting for the pull.` Fine, kept

### Components
- Run browser meta row: amber-bordered `harness 0.3.0` chip on every current run, violet-bordered `learning · blind · memory off` chip, violet `#tags`. Five colors on one line. Quiet mono text; only a stale harness keeps the warning color, without a border
- `enraged` is a red-bordered uppercase pill. Red text
- Scorecard footer is three mono key/value rows of build metadata. Kept, quieter

### Motion
- `group-hover:scale-110` on the scrubber thumb. Removed
- Two easing curves (`ease-out` on the drawers and result card, default on everything else). One curve, `cubic-bezier(0.22, 1, 0.36, 1)`
- Health bars tween `width`. Kept: it is a number changing, 150ms, a few pixels

### Layout (narrow widths)
- Every HUD cluster is absolutely positioned against a screen corner and scaled with `transform: scale()`, so nothing knows about its neighbours. Below ~1130px the 520px boss frame runs into the party frames and the scorecard; below ~1290px the decision log slides under the transport bar (at 1100 to 1290px wide they overlap)
- Top bar wraps to two lines at 800px: `About this eval`, `Model runs`, the run names and their times all break mid-label
- Drawers sit above the HUD by `z-20` only, while the scaled clusters create their own stacking contexts and the drawer fades in from transparent, so panels show through it while it opens

## Direction

- **Product.** A replay viewer that lets people watch AI models lead a five-person party through a Mythic+-style crypt, and read how each run was scored
- **Character.** Exact, nocturnal, a little dry
- **World.** A raid UI at 2am: dark unit frames, class-colored names, a combat log, candlelight on bone in a crypt
- **Moments.** The 3D scene is the bright element and keeps all the saturated color. In the chrome, the only rich color is game meaning: class colors on names and health bars, the boss bar, amber interruptible casts, and the timeline markers, where each hue means one event
- **Signature.** Every unit name is set in its class color, in every panel, like a WoW combat log. Nothing else in the chrome gets a hue except bone, the accent, which marks what the model learned (new notes, the learning tag)

Decisions that follow from it:

- Graphite ramp, opaque enough to read over the scene: card `rgba(17,17,19,0.88)`, top bar `#0f0f10` at 92%, drawer `#111113`. Hairlines at 8%
- Text roles: `#ededef` / `#a1a1aa` / `#8b8b93`
- Accent: bone `#e6d3a3`, from the crypt. Replaces violet. Used for learning notes, the learning tag and the legacy checkbox; never on buttons. The primary button stays off-white with dark text
- Semantic colors keep one meaning each: green good, red bad or health, amber interruptible / warning, sky blue interrupted
- Timeline markers: the pull marker leaves violet for neutral grey, adds spawn takes the bone-walker color, so the legend reads as game events
- IBM Plex Sans for the interface, Plex Mono for figures and meta. Weights 400 and 500
- Layout: two grids instead of corner-pinned boxes. Top row is party · boss · scorecard; below 1024px the boss frame takes its own row and the side panels sit under it. Bottom row is log · transport; the transport narrows to leave room for the log, and below 1180px it takes its own row with the log above it. Clusters scale with `zoom` so the grid sees their real size
- Top bar: run times and the dungeon name drop out below 1024px, `About this eval` becomes an icon below 768px, nothing wraps

## Not changed, suggested

- A short "How to read this" note in the About drawer (what each panel is, what a good run looks like), in the clocktowerbench spirit. It is new content, so it is left for the copy owner
- The scene's own violet lighting and green pools are out of scope here
