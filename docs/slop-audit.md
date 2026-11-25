# Vibe-code audit, November 2026

Two questions: does the site *look* AI-generated, and does the code? Copy is
out of scope here (it's being rewritten by hand, see `docs/copy/`).

## Verdict

**Light slop.** The site already has a real design direction
(`docs/design/site-direction.md`): one graphite ramp, one bone accent, IBM Plex,
lucide icons, tabular figures, sentence case, no glows, no gradient text, no
emoji, no looping animation. The replay viewer went through an unslop pass
earlier (`docs/design/unslop-audit.md`). What's left is drift: the system
exists, but parts of the code stopped using it. That's a polish pass, not a
redesign.

The biggest "made by AI" signal on the site is still the writing, which is
already being handled.

## Design slop

| # | Sign | Where | Fix |
| --- | --- | --- | --- |
| D1 | **Rainbow category tags.** Eight highlight kinds get eight hues (amber, orange, sky, green, red, pink, indigo, yellow), on cards that also carry a model colour dot. Two colour systems on one card, and the kinds' colours mean nothing. | `pages/Highlights.tsx` `KIND_COLOR` | Kinds in one neutral text style; colour stays for models only |
| D2 | **16 font sizes** (11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32, 40, 44, 52 px) against a design doc that specifies about 8. Mostly one-off `text-[17px]` / `text-[22px]` choices. | across `pages/`, `site/` | Snap to the scale in `site-direction.md`; add the sizes as Tailwind tokens so they can't drift again |
| D3 | **Raw hex colours bypassing the tokens.** 38 distinct hex values in components. `#ededef` is typed 17 times though it *is* the `fg` token; `#c4c4ca` and `#d4d4d8` are two near-identical light greys used as a fourth and fifth text colour. | `site/`, `pages/`, `hud/` | Use the tokens; fold the near-duplicates into `fg` / `fg-muted` |
| D4 | **Stock Tailwind semantic colours.** `good` / `bad` / `warn` are Tailwind's default green-400, red-400 and amber-400, at full strength. That out-of-the-box palette is a recognisable "Tailwind template" tell. | `tailwind.config.js` | Toned values (e.g. `#4cc38a`, `#e5484d`) that sit inside the graphite ramp |
| D5 | **Hover zoom on cards.** Highlight card images scale up on hover and the play button grows 10%. | `pages/Highlights.tsx` | A colour or border step on hover, nothing that moves |
| D6 | **Coloured glow behind each character** on the party page: a radial wash in the character's colour. It's borderline: the character render is meant to be the page's one rich moment, so this one could stay. | `pages/Party.tsx` stage | Keep, or replace with a neutral floor shadow; your call |
| D7 | **Five hand-built tooltips** that look the same but are separate copies with slightly different widths (220, 232, 248, 260 px) and shadows. | `charts.tsx`, `PullGrid.tsx`, `PyreGrid.tsx`, `HeatTables.tsx`, cost chart | One shared `Tooltip` component |

Not slop, and worth keeping: the CI strip as the signature detail, the 3D
replay as the one bright element on the home page, the quiet chrome around it,
and the gold `#ffd479` ability-tooltip text (a deliberate nod to WoW
tooltips).

## Code smells

| # | Sign | Where | Why it matters |
| --- | --- | --- | --- |
| C1 | **Numbers typed by hand next to a dataset that can compute them.** The Bone Pyre table, the behaviour table and the expert-script figures are hard-coded, and so are figures in the report's prose. One had already drifted: the report said 28% of Sol's deaths were to Desecrate while Figure 4, computed from the same data, showed 27%. Fixed in this pass. | `content/findings.ts`, `pages/Report.tsx` prose | The next dataset change will silently break more of them. Compute from `insights/v1.json` (as the heat tables already do), or add a test that checks each typed number against the data |
| C2 | **No linter.** There's no ESLint config and no `lint` script, yet the code carries `eslint-disable` comments for rules nothing runs. | `web/package.json` | Add ESLint with `react-hooks`; it would also catch the effect-dependency workarounds in `Compare.tsx` and `CallInspector.tsx` |
| C3 | **Duplicated helpers.** Two `useWidth` hooks, two `PARTY_CHAT` constants, two `clock()` formatters next to a shared `fmtTime`. | `charts.tsx` + `PullGrid.tsx`, `Panels.tsx` + `MobileMoment.tsx`, `Highlights.tsx` + `exportRuns.ts` | Classic generated-code drift: each file solved the same problem again. One copy each |
| C4 | **Leftovers from before the official run.** The sample-data notice on the home page, the GPT-6.2 Sol "pilot pull" featured replay (and its fallback path in the store), the scripted-bot showcase replays (2.1 MB) and the sample dataset (1.6 MB) all still ship to visitors, though the official results replaced them. | `pages/Home.tsx` `SampleNotice`, `site/config.ts` `FEATURED`, `replay/store.ts`, `public/replays/`, `public/results/sample/` | Dead paths to maintain and bytes nobody needs. The sample dataset is used by tests, so move it out of `public/` rather than delete it |
| C5 | **A 730-line page component** with the whole report as JSX, including tables. | `pages/Report.tsx` | Fine for now; when your rewritten report lands, put the prose in MDX (the project already has the MDX plugin) and keep only the live tables and figures in TSX |
| C6 | **DOM queries inside the viewer's animation loop.** The bubble and boss-plate placement I added in the UX pass reads panel positions from the DOM every frame. It's cheap (about six elements), but it couples the 3D overlay to the HUD's class names. | `hud/WorldOverlay.tsx` | Fine to keep; if it ever shows up in a profile, measure the panels on resize instead |
| C7 | **An AI session handoff in the public repo.** `docs/HANDOFF.md` is a note from one Claude session to the next. It's stale (it describes the project as "can better training data teach a small AI model…", and an unmerged PR #3), and it includes notes about you personally: your job, your startup and your career goals. | `docs/HANDOFF.md` | Delete it, or move it out of the repo. It's the most obviously AI-written file a visitor could open |

The Python simulator wasn't audited in depth. A quick scan found no TODOs, five
broad `except` clauses and no oversized functions worth flagging.

## What was done

| # | Outcome |
| --- | --- |
| D1 | Highlight kinds are plain text. Model colours on the highlights page now come from the results (a hand-typed copy of the model list there would have given any new model Haiku's colour) |
| D2 | 16 font sizes down to 12: section headings 20, page titles 28 / 32 everywhere, the one display size kept for the home question |
| D3 | `src/site/tokens.ts` holds every interface colour; `tailwind.config.js` reads it, and code that needs a value imports it. No interface hex is typed in a component any more. Game colours (classes, schools, enemies, pools, the gold tooltip text) are named in `content/display.ts` |
| D4 | `good` / `bad` / `warn` / `info` toned: `#4cc38a`, `#e5484d`, `#e2a336`, `#6cb8e6` |
| D5 | No hover zoom; the play button changes colour instead |
| D6 | Kept on purpose: the character render is the party page's one rich moment, and the wash is its light |
| D7 | One `Tip` component (`site/Tooltip.tsx`), one width, one shadow |
| C1 | Tables 5 and 7 are computed from `insights/v1.json` (`site/facts.ts`). `site/facts.test.ts` recomputes nine numbers the prose states and fails if a sentence and the data disagree. The expert-script figures come from the simulator, not the published data, so they stay typed |
| C2 | ESLint (TypeScript recommended plus the rules of hooks), `npm run lint`, run in CI. It found two warnings, both fixed |
| C3 | One `useWidth`, one `PARTY_CHAT`, one time formatter |
| C4 | The pilot clip and its fallback paths, and the pre-launch sample notice, are gone. The sample dataset moved to `web/test-data/` (tests use it; it no longer deploys). **Correction:** `public/replays/` is not a leftover. CI's determinism check regenerates it, the report links the expert's clears in it, and nothing there downloads unless opened |
| C5 | Waits for the report rewrite, as planned |
| C6 | Kept |
| C7 | `docs/HANDOFF.md` deleted. It's still in the git history; removing it from there means rewriting history, which needs your go-ahead |
