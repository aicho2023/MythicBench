# Small pages, footer and share cards

The leftovers: short text on the changelog and side-by-side pages, the footer
on every page, and the titles and descriptions that show when someone shares a
link on X, Slack or Discord.

---

## S1. Share cards (`web/src/site/meta.ts`)

These matter more than they look: the description is what people see in a
link preview before they ever click. Keep each title under about 60
characters and each description under about 160.

| Page | Title now | Description now |
| --- | --- | --- |
| `/` | MythicBench: can five AI agents learn from a wipe? | An LLM eval: five agents, one per character, run a Mythic+-style dungeon they have never seen, talk it over after each wipe, and try again. Leaderboard, replays of every pull, and the write-up. |
| `/watch` | Watch a run \| MythicBench | Replays of every pull in the benchmark, in 3D, with every decision the model made. |
| `/highlights` | Highlights \| MythicBench | The best moments from the official run: breakthroughs, arguments, clutch saves and spectacular wipes, each a click from the replay. |
| `/report` | Report \| MythicBench | How MythicBench works, what it measures, and what the models did. |
| `/party` | The party \| MythicBench | Every character and ability in MythicBench, the enemies of the Hollow Vault, and the affixes. |
| `/compare` | Side by side \| MythicBench | Two MythicBench replays on one clock, seen from above. |
| `/about` | About \| MythicBench | How MythicBench works, for WoW players and for ML people, how to run it yourself, and credits. |
| `/changelog` | Changelog \| MythicBench | What changed in the MythicBench game and harness, version by version. |

**Your versions** (only the ones you want to change):

- `/` title:
- `/` description:
- `/report` description:
- others:

---

## S2. Footer (every page)

> MythicBench is an independent project, not affiliated with or endorsed by
> Blizzard Entertainment. World of Warcraft and Mythic+ are trademarks of
> Blizzard Entertainment, Inc. Art: KayKit by Kay Lousberg (CC0).

This is a legal disclaimer, so it should stay plain. Change only if you want
to.

**Your version:**


---

## S3. Changelog intro (`/changelog`)

> What changed in the game and the harness, newest first. Results from
> different versions are never mixed.

The entries themselves (`web/src/content/changelog.ts`, 200 lines) are a
technical record. Rewrite them later if you want; they're low traffic.

**Your version:**


---

## S4. Side-by-side intro (`/compare`)

Two variants: the preset comparison linked from the home page, and any other
pair.

> Claude Opus 5.5, group 2: the blind first pull against the second, after one
> debrief. Two replays on one clock, seen from above.

> Two replays on one clock, seen from above. The view follows each party.

**Your versions:**


---

## S5. Interface text added in the UX pass

Short labels and one hint, written plainly so the fixes could ship. Rewrite
any of them.

| Where | Text now |
| --- | --- |
| Replay viewer, first visit to plain `/watch` (dismissible card) | "{model, group, pull}, one of the best pulls in the benchmark. Watch the glowing circle on the floor: with two or more players inside, its blast is split between them; with fewer, it hits the whole party." |
| Replay viewer, scorecard | "Seed 70102" and a "Versions and reproduce" toggle (the version list is folded now) |
| Replay viewer, learning panel | The first tab is "Talk" (was "Party talk"), so the tabs fit on one line |
| Highlights, filter rows | "Kind" and "Model" labels |
| Highlights, cards | "Read more (4 quotes)" / "Show less" |
| Home, Bone Pyre grid legend | "never reached Oruth" (the grey dash) |
| Home, Bone Pyre grid on phones | "Tap one for details." and a "Watch this Pyre" button in the popup |
| Home, cost chart on phones | "Bot, 32.5" (desktop keeps "Scripted bot, 32.5") |
| Report, Figure 2 caption | adds "the dashed line is the scripted bot" and the side-by-side link |
| Report, phones and tablets | a "Contents" dropdown |

**Your versions:**


---

## Not on this list, on purpose

- **Ability names and tooltips** (party page, viewer): the agents read these
  exact words in their prompts. Changing them changes the benchmark.
- **Agent quotes** in highlights and the report: the models' own words.
- **Replay viewer labels** (`web/src/hud/`): short UI labels like "Pause",
  "Learning", "Orders". Happy to list them if you want a pass, but they read
  as interface, not prose.
