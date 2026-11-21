# Design direction: the public site

Scope: the pages around the replay viewer (`/`, `/paper`, `/about`, and the header and
footer shared with `/watch`). The viewer HUD went through an unslop pass already
(`unslop-audit.md`); these pages are new, so this is a direction to build to, not an audit.
It extends the HUD direction rather than inventing a second one.

## Direction

- **Product.** A public benchmark that shows how well AI models lead a five-person party
  through a Mythic+-style crypt they have never seen, and how much they learn between wipes.
  For WoW players on tech Twitter, ML researchers, and people deciding whether the author
  can do careful work
- **Character.** Exact, nocturnal, a little dry
- **World.** A raid UI at 2am, a combat log, candlelight on bone in a crypt. And a paper:
  figures with error bars, footnoted claims, a BibTeX block
- **Moments.** Two. The live 3D replay in the home hero, framed like a window into the crypt:
  it carries all the saturated color. And the learning-curves chart, the one chart that is
  clearly the biggest thing on the page, where each hue is one model and the scripted bots
  are dashed grey rules behind them
- **Signature.** The confidence interval drawn as a thin bar on a 0 to 100 track, wherever a
  score appears with its 95% CI. Bone (the accent) marks the mean tick on the leading row and
  nothing else in the tables

## Decisions that follow

- Same tokens as the HUD (`tailwind.config.js`): graphite ramp `bg` / `surface` /
  `surface-raised`, three text roles `fg` / `fg-muted` / `fg-faint`, hairlines at 8%. Bone
  `#e6d3a3` is the only chrome accent. No new colors in the chrome
- Model series colors come from one fixed categorical order (`MODEL_COLORS` in
  `src/site/results.ts`), assigned by the model's position in the protocol, never by rank, so
  a model keeps its color on every chart. Validated for the dark surface: adjacent pairs pass;
  all pairs at 7 series do not, so every line and dot is also direct-labeled with the model
  name, and hovering a model dims the others
- Scripted bots are reference marks: neutral grey, dashed, labeled expert / competent / sloppy
- IBM Plex Sans for text, Plex Mono for figures, run ids and meta. Weights 400 and 500.
  Sizes: 12 meta, 13 captions, 15 body (paper body 16 for long reading), 20 section, 28 page
  title, 44 to 52 the home question (32 on mobile)
- Sentence case everywhere. No uppercase tracked labels, no "·" separators, no exclamation
  marks, no trailing periods on short strings
- Layout: content capped at 1200px with 24px gutters (16px on phones). Home hero is an
  asymmetric split, the question and two actions on the left, the framed replay on the right
  at more than half the width. Below it: leaderboard, then the learning curves at full width,
  then the cost scatter at two thirds with its note beside it
- Every chart has a short "How to read this" note under it, in secondary text
- Tables: header in muted 12px, rows 48px, numbers right-aligned in mono with tabular
  figures; the bot rows sit under a quiet divider, in secondary text
- Motion: hover is a color or surface step at 150ms on the shared curve. No entrance
  animations on these pages
