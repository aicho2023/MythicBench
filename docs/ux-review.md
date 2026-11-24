# UX review, November 2026

Every page checked at 1440×900, 1280×720, 900 (tablet) and 390 (phone), from
a production build. No console errors and no sideways scrolling anywhere.
Wording is out of scope here; it's being rewritten by hand (`docs/copy/`).

## Fixed in this pass

- **Chat showed names twice** ("[Wren]: Wren: I'll kick…"). Models often start
  their own chat line with their character's name. The viewer's chat log,
  speech bubbles and phone drawer now drop that repeated name. The recorded
  replies are unchanged (`chatText` in `web/src/hud/bits.tsx`).
- **404 page had the home page's tab title.** It now reads "Page not found",
  and the report's old addresses (`/paper`, `/commentary`) get the report's
  title.
- **The report had no contents list below 1280 px wide** (phones, tablets, small
  laptops) on a page about 24,000 px long. It now has a collapsible "Contents"
  under the header that closes when you pick a section.
- **Learning panel numbers wrapped mid-list** ("22.8K 284K 234K 83.8K" then
  "269K" on the next line). The row of values now stays whole and drops below
  its label when it doesn't fit.

## To fix, most important first

### 1. A visitor can't tell what the score means
The leaderboard shows Score, a dot strip, First pull and Cost with no key. The
only explanation of "First pull" is a hover tooltip, which doesn't exist on
phones. Covered by the "What we measure" slot in `docs/copy/01-home.md`; also
worth one line of small text under the table once that wording exists.

### 2. The scripted bot is invisible, but the headline claim depends on it
The text says five models "score about what a fixed-rule bot scores (32.5)."
The bot only appears in the cost chart. It's missing from the leaderboard and
the learning chart, where that comparison would be seen. Suggest a dashed grey
line at 32.5 on the learning chart (the original design doc planned one) and
a greyed reference row in the leaderboard. This was hidden on purpose, so it's
your call.

### 3. The learning chart is a tangle below 37
Five lines overlap between 30 and 37, and the colours pair up (two greens, two
blues). The story is "two lines climb, five stay flat," but it reads as noise.
Suggest Opus and Sol in colour, the other five in one grey, with hover to pick
out any line.

### 4. "Watch a run" opens on the dullest moment
`/watch` opens Opus group 1, pull 1 at 0:01: the entrance corridor, with five
speech bubbles covering the screen. Suggest opening on the same stretch the
home clip loops (Sol's best pull, a Pyre soak), with one short hint about what
to watch for.

### 5. The viewer is crowded at common laptop sizes
At 1280×720: speech bubbles cover each other, the boss health bar and the
damage numbers; the chat log and learning panel are cut off at the bottom. At
1440×900 the objective banner sits on top of the bubbles. Possible fixes: cap
bubbles at two or three, fade older ones sooner, or keep them out of the top
band.

### 6. The best evidence of learning isn't linked
`/compare` with no arguments shows Opus group 2, blind pull 1 against pull 2 on
one clock. It's the clearest before-and-after on the site, and nothing a
visitor sees links to it (only the viewer's learning panel does, for other
pairs). It also opens paused, on two near-empty maps with overlapping name
labels. Suggest linking it from the home learning section and the report, and
starting at the boss.

### 7. Highlights is about 20,500 px long
Each of the 23 cards is full width, with a large image and every quote. Suggest
a grid of compact cards (the home page already has that version) that expand
or open the replay. The two rows of filter chips (kind, model) have no labels.

### 8. The home page is heavy on desktop
Before you scroll, the 3D clip pulls about 12 MB uncompressed (models,
textures, the replay). Phones already get a still image. Suggest showing the
still first and loading 3D after the page is idle, and checking the compressed
size on the live host.

### 9. Smaller things
- Bone Pyre grid on phones: squares are about 6 px, but the note says "Click
  one to watch it." Too small to tap.
- Hover-only tooltips (`title=`) on the leaderboard and charts don't work on
  touch.
- The report's sidebar contents doesn't mark which section you're in.
- Cost chart on phones: the "Scripted bot, 32.5" label sits on top of two dots.
- Viewer learning panel: the character tabs wrap ("Wren" alone on a second
  line).
- The phone menu opens over the page without dimming what's behind it.
