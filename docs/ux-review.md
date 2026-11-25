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

## Fixed in the second pass

Each checked in a production build at 1440×900, 1280×720 and on a 390 px
phone with touch.

1. **Leaderboard key.** A short key under the table says what Score, the dots
   and bar, First pull, Cost and the bot mean. Each line shows only where its
   column does. The "First pull" hover tooltip is gone. (Placeholder wording,
   listed in `docs/copy/01-home.md` as H6b.)
2. **The scripted bot is visible.** A greyed "Scripted bot, reference, not
   ranked" row in the leaderboard, and a dashed line on the learning chart.
   Visitors still don't see the bot's replays in the run browser (`bot` in
   `results.ts` is kept separately from `baselines`).
3. **Learning chart.** Models that a paired test separates from at least one
   other (`clearLeaders`: Opus and Sol in v1) keep their colours; the rest
   share one grey and light up on hover. On phones the legend groups them as
   "The other 5 models". The memory chart in the report is unchanged.
4. **Plain `/watch`** opens the top model's best pull at the stretch the home
   clip loops (Opus, group 2, pull 2, from 2:26), with a dismissible hint about
   the glowing circle that hides itself after 20 seconds.
5. **Viewer crowding.** At most three chat bubbles, newest first, fading out.
   A bubble that would land in the top band (boss frame, warnings) or under a
   panel is dropped. The version details in the scorecard fold behind
   "Versions and reproduce", which gives the learning panel about 80 px back.
   The chat log and learning panel fade at the bottom edge, so a clipped line
   reads as "scroll for more".
6. **Side by side** is linked under the home learning chart and in the
   report's Figure 2 caption. It opens 3 s before the first party pulls Oruth,
   and name labels are drawn last and steered clear of every dot and other
   label.
7. **Highlights** is a two-column grid (about 9,000 px, down from 20,500).
   Each card shows a four-line summary and its first quote, with "Read more"
   opening the full story across both columns. The filter rows are labelled.
8. **Home page weight.** The 3D clip now waits for the page to finish loading
   and the browser to go idle, and data-saver browsers keep the still. This
   changes when the bytes load, not how many: about 12 MB uncompressed. The
   compressed size on the live host hasn't been checked.

Smaller ones:
- Bone Pyre grid on touch screens: a tap shows that Pyre's details with a
  "Watch this Pyre" button, so a near miss costs nothing. The legend explains
  the grey dash ("never reached Oruth").
- Learning chart on touch: a tap shows that pull's values.
- Report sidebar marks the section you're in.
- Cost chart: the bot label moved to the right end, under the line, and
  shortens to "Bot" on phones.
- Viewer learning panel tabs fit on one line ("Talk" instead of "Party talk").
- Phone menu dims the page behind it; tapping the dimmed area closes it.

## Fixed in the third pass

- Oruth's floating health bar drops under his feet whenever the HUD warnings
  would cover it.
- The first-visit hint opens with the replay paused and a Play button; it
  disappears as soon as the replay plays, so it never covers a running fight.
- Side-by-side names try above, below, right and left of their dot before
  stepping further out, and draw a thin leader line when they do.

## Previously open (now fixed)

- When Oruth is near the top of the screen, his floating health bar can sit
  under the HUD warnings ("Desecrate: move out of the pools"). It's a world
  plate that follows him, so moving it would hide him.
- On a small laptop the first-visit hint card covers part of the lower arena
  for up to 20 seconds.
- Side-by-side labels can step a little way above their dot when three
  players stand together.
