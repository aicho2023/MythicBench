# MythicBench — Session Handoff

_Last updated: 2026-11-21. Written for a new Claude Code session on the
owner's local machine, picking up from a cloud session._

**Start here:** read this file, then `README.md` and `docs/ARCHITECTURE.md`.

---

## 1. What this project is

MythicBench is an open-source benchmark asking: **can better training data
teach a small AI model to be a better MMORPG dungeon teammate?** It's inspired
by WoW Mythic+ but is entirely original (names, art, numbers).

Guiding principle from the owner: *make it look like a delightful little
fantasy game, but architect it like a serious AI research platform.*

The owner's three goals for the project:
1. **Approachable** to anyone — researchers and "regular dudes in Idaho."
2. **Technically impressive** — push benchmarks forward, prove something cool.
3. **Scientifically rigorous** — nobody can poke holes in the benchmark or results.

## 2. About the owner (how to work with them)

- Data scientist; writes Python. Building front-end skills (Jekyll/Flask for a
  startup). Very interested in LLMs/ML and in becoming an **evals engineer**.
- **Explain the *why* behind decisions** as you go — they want to learn.
  Recommend one approach rather than surveying options.
- Plans to eventually host this as a subpage under "research" on a revamped
  personal website. Local-only for now (Vercel or similar later).
- **IP caution is a hard requirement:** avoid anything that could draw a
  cease-and-desist from Blizzard. Keep names original but make the WoW
  inspiration obvious ("oh, that's basically Kick"). No Blizzard assets, logos,
  or exact ability names. (We already renamed "Fan of Blades" → Scatterblades
  and "Raise Dead" → Summon the Restless for being too close.)

## 3. Current state

### Done
- **Phase 1 (visual prototype)** — complete and merged to `main` via
  [PR #1](https://github.com/aicho2023/MythicBench/pull/1).
- **KayKit art integration** — on branch `claude/magical-keller-cxqgkq`,
  [PR #3](https://github.com/aicho2023/MythicBench/pull/3), **open, not yet
  merged**. It contains the owner's asset commit from
  [PR #2](https://github.com/aicho2023/MythicBench/pull/2) plus the
  integration, so merging #3 lands both.

### Results (content 0.2.0, showcase seed 42)
| Run | Outcome | Score | Interrupts | Deaths |
|---|---|---|---|---|
| Expert bots | Kill in 2:47 | 87.1 | 11/11 | 0 |
| Competent bots | Wipe to enrage at 3:19 (boss 3.8%) | 67.3 | 10/13 | 5 |
| Sloppy bots | Wipe at 1:22 (boss 62%) | 26.8 | 3/5 | 5 |

Over 200 seeds at +12 (score 0–100, 95% CI): expert 87.5 (86.8–88.2),
competent 72.3 (70.2–74.5), sloppy 14.9 (14.3–15.4). Win rates 99.5% / 68.5% /
0%. ~0.45 s per headless fight.

Score (`metrics.run_score`, v2): wipe = 70 × share of boss removed; kill = 70 +
30 × speed (full speed with ≥25% of the timer left).

**Difficulty is two tiers (content 1.5.0):**
- Normal: 0.95× enemy health, 0.9× damage, no affixes.
- +10: 0.98× health, 1.15× damage, plus three affixes:
  - Restless Graves;
  - Marrowburst;
  - Hollow Tyrant, which includes Grave Mark (a spread mark that detonates on
    allies within 6 m).
- Both tiers run on a 4:15 timer (`Tier.limit_ms`).

The first cheap models cleared the earlier, softer +10 on their first blind
pull, which left no room to measure learning, so both tiers were made harder.
Over 200 seeds:

| Tier | Expert | Competent | Sloppy |
| --- | --- | --- | --- |
| +10 | 0% | 0% | 0% |
| Normal | 100% | 77% | 0% |

Content 1.5.0 tuned +10 against real models, not the bots: on content 1.4.0
(0.85× health), GPT-6.2 Sol cleared 2 of 5 blind first pulls, and two of
the misses ended with Oruth under 3%. That leaves a five-pull group
almost sure to clear, with no room to measure learning or for better models.
+10 enemy health went to 0.98× (about +15%): a clean pull should clear, a
death usually costs the timer. The bots now run out of time on +10 (expert
54.6, competent 42.5, sloppy 9.4); they rank skill, they don't set the
ceiling. Scripted commander over 30 seeds: 49.2 on +10, 63.3 on Normal.
Check on 1.5.0: Sol cleared 1 of 2 blind first pulls (78.4, with 18 s to
spare; the other ran out of time with Oruth at 7.1%).

Content 1.6.0 / sim 0.6.0: Bone Pyre, a soak. Every ~28 s Oruth marks a
circle (r 2.5 m) 5 to 9 m from him; 6 s later it goes off. With 2+ players
inside they split 20,000; otherwise it hits the whole party for 30,000 (tier
damage applies). Generic MMO sense says step out of glowing circles, so it
has to be learned from the combat log; that's the point. The "safe" move and
the in-pool alarm ignore it, every agent is woken when one appears, and the
debrief lists each detonation with who stood inside. The scripted commander
never soaks: 32.5 on +10 (no clears), 55.4 on Normal, over 60 seeds (sim 0.7.0).

Content 1.7.0 / sim 0.9.0 / harness 1.0.0-rc.6: melee reach 1.5 m and kicks
2.5 m (were 3 m and 4 m), so a hit looks like one in the viewer. At 3 m,
melee hit from a median 1.3 m between bodies. Three reflexes keep it
playable at a call every few seconds:
- a melee character in reach of its target follows it if it drifts (up to
  3 m, `C.FOLLOW_M`), never into or through a pool; any ordered move ends
  this until it's back in reach;
- "safe" keeps the reach of the first attack, not of a standing kick;
- a taken melee spot shifts to a free spot still in reach of that foe, and
  Oruth's chase does the same for his target.
Commander: 32.4 on +10 and 54.9 on Normal over 60 seeds, against 32.5 and
55.4 before. At 1 m reach, Normal fell to about 50.

Sim 0.10.0: solid obstacles (`C.OBSTACLES`): Oruth's throne (with the strip
behind it, too narrow for him, so nobody hides there) and two pillars in each
side room, where the viewer draws them. A move routes around them through
corner waypoints (`Encounter.route`, multi-leg moves in `Unit.path`), for
players and enemies alike; a destination inside one is pushed out; Bone Pyre
never lands on the throne. The entrance corridor also now joins its room
across its full width (it was a wall off-centre, and Sol's melee got stuck
there in every pull of the first reach check).

Fifth review (harness 1.0.0-rc.7, sim 0.11.0, content 1.8.0): a chase checks
its whole route before committing (`reachable_spot`: another spot in reach if
an obstacle blocks the first; Oruth had stalled behind his throne with Soul
Rend pending); stay-in-reach follows only the target it's in contact with
(`LLMPolicy.contact`), only straight, and the sim re-checks the step as it
really resolves (`Action.keep_reach`, `guarded_step_ok`); "safe" judges the
route it will really walk (`route_path`, shared by the engine and the
policy); "stop" is a real halt (`Action("stop")`); rules and affix texts
state mechanics, not tactics. Commander: 32.4 on +10, 55.0 on Normal.

Sixth review (same versions; nothing was recorded on them in between):
Oruth's final spot and every point of his route stay inside his room
(`reachable_route`, executed as checked by `walk_route`); if he can't reach
his target from inside it, he fights the nearest player he can reach until he
can (`reachable_victim`); "safe" hands the sim ranked candidates
(`Action.options`) and it takes the first whose real move (wall clip, taken
spot, obstacles) ends clear of every pool, keeping reach and a clean route
where promised (`pick_option`). Commander: 32.4 on +10, 54.6 on Normal.
Seventh review: a chase endpoint must be in attack reach of the target (a
legal spot at the room's edge out of reach of a tank in the corridor isn't a
way to fight it), so Oruth turns on someone he can reach; the state shows who
he's fighting (`Unit.victim`) while `target` stays the tank he goes back to.
Commander: 32.7 on +10, 54.5 on Normal.

The scripted bots (expert, competent, sloppy) are gone. Their dodge planner
lives on in `dodge.py` (the "safe" move); tests and the viewer's reference
replays use the scripted commander instead.

Sim 0.5.0 / content 1.4.0: Oruth walks after his target when it's out of
his melee reach (after a 3 s rise from his throne when pulled), enemies take
free spots like players, and bodies are 0.6 m.

Sim 0.4.0 (after the pre-run audit): a run ends at its timer (revive
penalties included) and a clear needs Oruth and every pack dead. Before,
a kill up to 60 s late scored 70 and counted; most of the old +10 "clears"
(25%) were late, so the timed rate is 8%. The scripted commander (same
interface as the agents, fixed rules): 53.2 on +10, 62.2 on Normal over 16
seeds, no timed clears.

Sim 0.3.0 gave units bodies: a player never ends a move inside another unit
(`Encounter.free_spot`). That cost melee some uptime, so Normal's enemy
health went from 1.0× to 0.95× to keep its clear rates where they were.

The
old `--level` key levels are gone; runs made with them show as "+N (old)".

### Pending from the owner
- They said they **have questions before continuing** — ask for them first.
- Decide whether to merge PR #3.

## 4. How to run

```bash
cd web && npm install && npm run dev        # viewer at http://localhost:5173
cd web && npm test && npm run typecheck     # 8 viewer tests
cd web && npm run build                     # production build
cd web && npm run replays                   # regenerate replays from the sim
cd sim && pip install -e ".[dev]" && python -m pytest   # 11 sim tests
cd sim && python -m mythicsim run --policy expert --seed 7
cd sim && python -m mythicsim bench --policy sloppy --runs 200
```

Requirements: Node 18+, Python 3.10+ (sim is pure standard library;
`pytest`/`jsonschema` only for tests).

### Useful URL parameters (viewer)
| Param | Effect |
|---|---|
| `?replay=sloppy-wipe` | pick a replay (`expert-kill` / `competent-enrage` / `sloppy-wipe`) |
| `&t=123&paused=1` | jump to second 123, paused (shareable moments) |
| `&speed=2` | playback speed |
| `&cam=7,5,8&look=0,2.5,-1` | camera position / target (close-ups) |
| `&art=procedural` | force the built-in placeholder art |
| `&nofx=1` | disable post-processing (debugging) |

Keyboard: space = play/pause, ←/→ = ±5 s, 1–4 = speed.

## 5. Repository map

```
schema/replay.schema.json     THE contract between sim and viewer (event log format)
sim/mythicsim/
  content.py                  All rules as data: classes, abilities, auras, boss, party
  engine.py                   Deterministic 100 ms tick loop -> event log; observe()/Action
  policies.py                 ScriptedPolicy + Skill profiles (EXPERT, SLOPPY)
  metrics.py                  Scores computed ONLY from the event log
  __main__.py                 CLI: run / bench (95% CIs) / generate (SHOWCASE_SEED = 42)
sim/tests/test_replays.py     Determinism, schema, hp consistency, no-acting-dead
web/src/
  replay/types.ts             TS mirror of the schema (keep in sync by hand)
  replay/engine.ts            Event-sourced state-at-time-t, snapshots, markers
  replay/engine.test.ts       Viewer == simulator checks (loads real replays)
  replay/store.ts             zustand playback store, deep links, useHud()/frameState()
  scene/Scene.tsx             Canvas, lights, camera, bloom, playback driver
  scene/Units.tsx             One actor per unit: position, facing, auras, cast circles
  scene/pose.ts               Unit state -> Pose (mode, k, since, ...)
  scene/avatars.tsx           Procedural fallback rigs (chibi party, boss, skeleton)
  scene/kaykit/assets.ts      Model URLs, weapon loadouts, scales
  scene/kaykit/clips.ts       Pose -> KayKit animation clip + playhead
  scene/kaykit/KayKitAvatar.tsx  Skinned model, weapons on handslot bones, boss dressing
  scene/kaykit/Dungeon.tsx    KayKit walls, banners, torches, pillars, gates, statues
  scene/Arena.tsx             Floor, dais, throne, braziers, ghosts, motes (+ fallback decor)
  scene/Effects.tsx           Desecrate pools, projectiles, bursts
  hud/*                       Party/boss frames, timer, meter, warnings, decisions, controls
web/public/replays/           Generated replays + index.json (committed; CI checks freshness)
web/public/assets/kaykit/     KayKit CC0 packs (glTF/GLB only)
docs/                         ARCHITECTURE.md, ASSETS.md, media/, this file
.github/workflows/ci.yml      pytest + replay-freshness diff + typecheck/test/build
```

## 6. Invariants — do not break these

These are what make the benchmark trustworthy. Tests enforce most of them.

1. **Determinism.** All sim randomness flows from seeded `random.Random`
   (engine RNG + one per bot, seeded `f"{seed}:{unit_id}:{skill}"`). Same seed +
   policy ⇒ byte-identical replay.
2. **The event log is the only output.** Viewer and metrics derive from the
   replay file alone. `damage`/`heal` events carry resulting `hp`.
3. **Policies see only `Encounter.observe()`** (a JSON-able dict) and return
   `Action`s. Never give a policy engine internals — LLMs must be judged on the
   same footing as bots.
4. **Viewer visuals are a pure function of replay time.** Poses, projectiles,
   floating text, pool swirls, KayKit clip playheads, ambient motes — all from
   `t`, never wall-clock. (Only cosmetic smoothing — facing damping and the
   120 ms clip cross-fade — uses real time.)
5. **Schema changes** must update `schema/replay.schema.json`,
   `web/src/replay/types.ts`, and regenerate replays (`npm run replays`).
   Bump `SIM_VERSION` / `CONTENT_VERSION` when rules change.
6. **Changing `content.py` or policies changes replays** — regenerate and
   commit them, or CI's freshness check fails.

## 7. Gotchas already discovered (save yourself the debugging)

- **Replays must match across machines.** CI regenerates them on Linux. Never
  use `math.hypot/cos/sin/...` in the sim (last-bit differences between CPUs
  flip decisions); a test enforces this. Policies must break ties deliberately:
  float-noise tie-breaks in the dodge planner once swung the expert win rate
  between ~2% and ~100%.
- **Python 3.10+ for the sim.** The owner's system `python3` is 3.8; use the
  `mythicbench` conda env.

- **Black screen with bloom:** drei `<Sparkles>` divides by distance-to-centre
  in its shader → Infinity → bloom spreads NaN over the whole frame. Removed;
  use the custom `Motes` in `Arena.tsx`. Also never let opacity go negative
  (same symptom) — clamp fades to `[0, 1]`.
- **React StrictMode runs effects twice in dev** — `loadIndex` is guarded by a
  module flag; deep-link params applied once.
- **GLTFLoader strips `.` from node names** (`handslot.r` → `handslotr`). Use
  `findBone()` in `KayKitAvatar.tsx`.
- **three.js `position` is read-only** — use `.position.set()`, not
  `Object.assign`.
- **KayKit 2.0:** characters ship without animations; all share the 23-bone
  `Rig_Medium` skeleton, so clips from `animations/.../Rig_Medium_*.glb` drive
  everyone. Weapons are separate glTFs attached to `handslot` bones.
- **Replay epilogue:** viewer duration = `meta.duration_ms + 4000` so death
  animations play; the dungeon timer freezes at the kill/wipe.
- **Playwright screenshots in headless Chromium** (software GL) need ~20+ s
  for KayKit assets to load; locally on a real GPU it's ~1 s. In the cloud we
  launched with `--use-gl=angle --use-angle=swiftshader`.

## 8. Encounter design (quick reference)

Boss **Oruth the Unburied** (1.5M HP, on a dais at `(0,-2)`):
- *Requiem of Bones* — 3 s interruptible party-wide damage + DoT, every 16 s → **kick it**
- *Soul Rend* — 2 s tank buster + DoT, every 24 s → **defensive / shield**
- *Desecrate* — pools under 3 non-tanks, 1.5 s arm, persist 40 s → **move**
- *Summon the Restless* at 70%/35% — 3 Bonewalkers target the healer → **taunt & swap**
- *Hollow Fury* hard enrage at 3:15: ramping party-wide damage every second

Party: Rook (Guardian/tank), Ivy (Lightweaver/healer), Brask
(Berserker), Kit (Shadowblade), Wren (Ranger — future panda). Kick order:
Brask → Kit → Wren → Rook. Full WoW-analogy table in `README.md`.

## 9. Known limitations / tech debt

- Expert bots win 99.5%. That's fine because the score keeps rewarding
  faster kills, but stronger-than-expert play shows up as kill time, not win rate.
- The scripted bots' "inattentive" dodge still notices pools in time with a
  fast reaction, so dodge attention barely affects the expert; reaction speed does.
- No mana, threat tables, line of sight, or boss movement.
- `types.ts` is hand-mirrored from the JSON Schema (could be generated).
- JS bundle ~1.1 MB; runtime asset download ~9 MB; ~8 MB of unused KayKit files
  in the repo (Rig_Large, Mannequin, duplicate animation copies).
- Dungeon props pop in slightly after characters on first load.
- Crypt-gate glow is hidden behind KayKit's closed red door (cosmetic).

## 9b. LLM harness (Phase 2, started)

- `sim/mythicsim/llm/`: `clients.py` (stdlib HTTP for Anthropic/OpenAI, a
  `mock` model, and `CachedClient`, which records replies to
  `runs/cache/*.jsonl` (a campaign: `runs/cache/<protocol>/`) so runs replay
  exactly; each recording is tagged by episode, pull, agent and call number,
  so identical prompts in different episodes are sampled separately;
  `--offline` makes a missing recording a fatal error), `prompt.py` (rules per
  character → system prompt, obs → that character's state text with party
  chat, strict reply parsing), `policy.py` (`Party`: five `Agent`s, one per
  character, all the same model, each with its own rules, notes and orders),
  `progress.py` (pulls; between pulls a party talk in turns until everyone is
  ready, then private notes per agent; no guidance on what to learn).
- **Call cadence (harness 0.10.0), per agent:**
  - every 4 s of game time (`ROUTINE_MS`), plus triggers routed to who they
    concern: kickable casts to the four interrupters, other boss casts to
    everyone, a trash cast to its target and the healer, new pools to anyone
    within 4 m, adds/pulls/deaths to everyone, low health to that character
    and the healer, Grave Mark to the marked and those near them;
  - a 0.5 s minimum gap, except for casts; same-tick calls run in parallel;
  - capped at 300 calls per agent per pull.
  The game is paused while the agents think.
- **Audit fixes (Nov 22):** Student-t intervals; only timed kills are clears
  (an over-time kill scores 70 and the episode goes on); learning effect =
  memory on minus memory off on the same seeds; versions in the campaign key;
  incomplete cells unranked; a paid campaign refuses uncommitted code
  (`--allow-dirty` for pilots); no OpenAI JSON mode (one reply contract).
- **Equal settings:**
  - an 8,000-token output cap per call (`MAX_OUTPUT_TOKENS`);
  - one effort for every model (`protocol/v1.json`);
  - Anthropic uses adaptive thinking with summaries, which are stored in the
    recordings;
  - refusals are counted, and there is no model fallback.
- **Official protocol:** `protocol/v1.json`. `campaign` plays it and can be
  resumed; each episode is marked finished by `episodes/E/episode.json`.
  `results` writes `results/v1/leaderboard.json` and the gzipped replays
  (`sim/mythicsim/campaign.py`).
- **Interrupts in a priority list** only fire on an interruptible cast, so
  standing orders don't waste them.
- **CLI:** `python -m mythicsim llm --model provider:model --seeds 0-4 [--name] [--tag]`.
  - Each invocation is a run: `runs/<run_id>/` (`sim/mythicsim/runs.py`), with
    a `manifest.json` (config, `HARNESS_VERSION`, prompt hash, git commit,
    summary), `seeds/seed-N.json`, and a line in `runs/registry.jsonl`.
  - `python -m mythicsim runs list|show|rm|publish|import-legacy`.
  - The viewer reads `web/public/replays/local/catalog.json` (git-ignored) and
    shows a Model runs drawer (`web/src/hud/RunBrowser.tsx`).
  - Bump `HARNESS_VERSION` (`sim/mythicsim/llm/__init__.py`) whenever what the
    model sees or can do changes.
- **Keys:** `.env` at the repo root (copy `.env.example`).
- **Money (`sim/mythicsim/spend.py`):**
  - `PRICES` holds list prices per model (as of `PRICES_AS_OF`). A paid model
    without a price is refused unless `--price-in/--price-out` is given.
  - The client stack is `tally(CachedClient(meter(model)))`:
    - the inner `CostMeter` sees only real API calls. It enforces
      `--budget-usd` (default $20) and appends every call to
      `runs/spend.jsonl`;
    - the outer one measures the run's list-price cost (`summary.cost_usd`,
      `usd_per_fight`), which is the number to report next to scores.
  - The project cap is `MYTHICBENCH_TOTAL_BUDGET_USD` (default $500). A run's
    budget shrinks to whatever is left of it.
  - When the budget runs out, the run ends with status `stopped`. It keeps the
    seeds or episodes that finished; a half-played episode is dropped from the
    summary so it can't bias pulls-to-kill.
  - `runs spend [--backfill]` shows the totals. `--backfill` adds estimates for
    runs made before the log existed.
- **Prompt size:** ~1.6k tokens of rules (prompt-cached by the provider;
  OpenAI with `prompt_cache_key`) and ~0.3–0.5k of state per call.
- **Fairness decisions from the first live runs (2026-11-21):**
  - Queued interrupts react after 350 ms, the expert bot's reaction time, not instantly.
  - `move_to: "safe"` uses the bots' dodge planner (`policies.find_safe_spot`).
    Without it, every model, including gpt-5.4, died to pools: they couldn't
    find spots that are both clear of a pool and in melee range from raw
    coordinates. gpt-5.4-mini went from ~25 to ~88.
  - Each character's state line says "STANDING IN POOL … (x m from centre)":
    perception that's obvious on screen.
  - A character in an armed pool triggers a new call. A resent move always
    executes. `self`/`party` target aliases and `{"x","z"}` moves are
    accepted. Orders for dead characters are ignored.
  - Billing, auth, and bad-request errors stop the run. Output budget is 16k
    because thinking shares it.
- **First results on the final harness (2026-11-21):** claude-haiku-5-5,
  seed 0: kill, score 121.2, no deaths, 12/12 kicks. gpt-5.4-mini, seeds 0–4:
  mean 74.8 (95% CI 56–94), 0 wins, two near misses (boss at 1–3%). It fails
  mostly on adds (no taunt or swap) and occasional pools. gpt-4.1-mini,
  seeds 0–2: ~23 (herds the party onto one spot). Reference bots on seeds 0–4:
  expert 133.5, competent 94.5, sloppy 17.0.
- **Run-to-run variance is large:** gpt-5.4-mini scored 130.6, then 60.9, on
  the same seed. Report many seeds, ideally repeated.
- **OpenAI prompt caching (investigated, not fixable cheaply):** with our
  ~1.8k-token shared rules prefix, OpenAI's automatic cache hits only when the
  varying text after it is short.
  - Hits: ~100 tokens of varying text. Intermittent: ~260 tokens. Never: our
    real 500–700 tokens of state.
  - Reproduced with `prompt_cache_key` and with `prompt_cache_retention: 24h`.
  - Fixing it would mean restructuring the prompt (e.g. sending state diffs in
    a running conversation), which changes what the model sees. Deferred.
  - Anthropic caching works (~70% of input tokens are cache reads).
- **Effort / thinking (measured on one game prompt):**
  - claude-haiku-5-5: default 9.5 s per call and ~1.6k thinking tokens;
    `@none` 4.4 s and 0; `@low` 6.8 s; `@high` 12.1 s.
  - gpt-5.4-mini: default does no reasoning (2.1 s); `@low` 9 s and ~1k
    reasoning tokens; `@medium` 44 s and ~6.7k.
  - So the earlier gpt-5.4-mini results were without reasoning.
  - Each effort is a separate configuration (`model@effort`).
- **Speed:** `--workers N` runs seeds in parallel threads (tested identical to
  sequential).
- **claude-haiku-5-5@none, seeds 0–3, 4 workers:** 4/4 kills, mean 117.9
  (110.2 / 126.8 / 106.1 / 128.6; expert ~131, competent ~102). 4 min 20 s
  wall-clock for all four fights. ~105 calls, ~415k input (295k cache reads)
  and ~55k output tokens per fight.
- **Observed cost and speed:** claude-haiku-5-5 thinks heavily (~1.9k output
  tokens per call, ~8 s per call, ~19 min per fight). gpt-5.4-mini makes
  ~100–130 calls per fight at ~2.7k input / ~0.3k output tokens each.

## 9d. Dungeon run (PR D)

- `--mode dungeon` (the default) on run, bench, llm, and progress. Content
  0.3.0, harness 0.5.0.
- Layout: entrance (0, 84) → Bone Chapel (0, 54, Chapel pack: 4 Bonewalkers +
  Bone Chanter) → Ossuary (0, 30, Ossuary pack: 3 Bonewalkers + Marrow Mender)
  → throne room. 4:30 timer.
- 200 seeds: expert 89.0, competent 74.6, sloppy 30.8 (clear rates 97% / 62% /
  0%).
- The LLM rules gain a dungeon section (map, packs, trash tooltips, which blind
  mode hides, pulling, resting, scoring). The state shows pack status and
  enemies not yet pulled. New triggers: pack pulled, pack cleared, Oruth
  woke. `move_to: "next"` walks the route.
- Debrief: pull and clear times, trash casts interrupted, revives.
- Viewer: `CryptRun` builds the rooms and corridors from `replay.arena`.
  `FollowParty` keeps the camera (and the sun) on the party. `PackFrame` shows
  before the boss. The scorecard shows progress, pack status, and revive
  penalties.

## 9c. Learning over pulls (PR C)

- `sim/mythicsim/llm/progress.py`: `run_episode` plays a pull, then `debrief.py`
  (a factual report built only from the event log), then a reflection call
  (`REFLECT_SYSTEM`, which returns `{"notes": …}`, capped at ~350 words).
  The notes go into the next pull's system prompt (`prompt.notes_section`).
  Pull seeds come from `pull_seed(episode, pull)` = 10000 + 100·episode + pull.
  An episode stops at the first kill.
- `knowledge="blind"` (`prompt._boss_section`, `render_state`) drops all boss
  tooltips, pool details, add thresholds, the enrage warning, and the
  next-ability timers. The "full" text is byte-identical to before, so its
  prompt hash is unchanged.
- `--memory off` is the control (no notes and no reflection calls; every pull
  sees the pull-1 rules).
- Metrics (`summarize`):
  - kill rate and pulls-to-kill (max+1 if never killed);
  - learning gain = mean of the last 2 pulls minus mean of the first 2;
  - AUC = mean score across pulls;
  - curve_mean per pull.
  - After a kill, the kill score carries forward.
- Replays carry `meta.progress`: notes_before, notes_after, and the debrief.
  Files go to `runs/<id>/episodes/E/pull-K.json`.
- Viewer: `web/src/hud/LearningPanel.tsx` (shown in place of the meter for
  progression replays) and episode strips in `RunBrowser.tsx`. Deep link:
  `?run=<id>&episode=E&pull=K`.

## 10. Suggested next steps

1. Get the owner's questions answered; merge PR #3 if approved.
2. **Panda ranger** (owner wants Wren as a panda-inspired ranger): e.g. tint the
   Ranger model and attach panda ears/eye patches to the `head` bone.
3. **Phase 2 — LLM agents & evals:** the harness is built (see 9b). Next:
   - First real runs (Anthropic + OpenAI); read the replays, then iterate on
     the prompt and cadence.
   - Multi-seed evaluation with confidence intervals; held-out seeds.
   - Done (0.9.0): five separate agents with party chat replaced the single
     commander.
   - Track illegal/invalid actions as a metric.
4. **Phase 3:** expert trajectory generation → SFT a small open model (HF
   Transformers + TRL) → preference optimization / RL.
5. **Phase 4:** public leaderboard, side-by-side failure replays, host under
   the owner's personal site (`vite.config.ts` already uses `base: './'`).
