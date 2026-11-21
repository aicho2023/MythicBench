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

### Results (content 0.2.0, showcase seed 13)
| Run | Outcome | Score | Interrupts | Deaths |
|---|---|---|---|---|
| Expert bots | Kill in 2:50 | 124.8 | 11/11 | 0 |
| Competent bots | Wipe to enrage at 3:19 (boss 15%) | 84.6 | 11/13 | 5 |
| Sloppy bots | Wipe at 1:41 (boss 68%) | 31.7 | 4/7 | 5 |

Over 200 seeds (score, 95% CI): expert 121.3 (119.9–122.7), competent 101.7
(98.7–104.8), sloppy 21.5 (20.7–22.3). Win rates 97.5% / 65% / 0%.
~0.45 s per headless fight. Score = % boss HP removed, or 100 + seconds left on
a kill (see `metrics.run_score`).

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
  __main__.py                 CLI: run / bench (95% CIs) / generate (SHOWCASE_SEED = 13)
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

Boss **Mortisar, the Hollow King** (1.5M HP, on a dais at `(0,-2)`):
- *Requiem of Bones* — 3 s interruptible party-wide damage + DoT, every 16 s → **kick it**
- *Soul Rend* — 2 s tank buster + DoT, every 24 s → **defensive / shield**
- *Desecrate* — pools under 3 non-tanks, 1.5 s arm, persist 40 s → **move**
- *Summon the Restless* at 70%/35% — 3 Bonewalkers target the healer → **taunt & swap**
- *Hollow Fury* hard enrage at 3:15: ramping party-wide damage every second

Party: Bramble (Guardian/tank), Lumi (Lightweaver/healer), Grokka
(Berserker), Nyx (Shadowblade), Bao (Ranger — future panda). Kick order:
Grokka → Nyx → Bao → Bramble. Full WoW-analogy table in `README.md`.

## 9. Known limitations / tech debt

- Expert bots still win 97.5%. That's fine because the score keeps
  rewarding faster kills, but stronger-than-expert play would mostly show up as
  kill time, not win rate.
- The scripted bots' "inattentive" dodge still notices pools in time with a
  fast reaction, so dodge attention barely affects the expert; reaction speed does.
- No mana, threat tables, line of sight, or boss movement.
- `types.ts` is hand-mirrored from the JSON Schema (could be generated).
- JS bundle ~1.1 MB; runtime asset download ~9 MB; ~8 MB of unused KayKit files
  in the repo (Rig_Large, Mannequin, duplicate animation copies).
- Dungeon props pop in slightly after characters on first load.
- Crypt-gate glow is hidden behind KayKit's closed red door (cosmetic).

## 10. Suggested next steps

1. Get the owner's questions answered; merge PR #3 if approved.
2. **Panda ranger** (owner wants Bao as a panda-inspired ranger): e.g. tint the
   Ranger model and attach panda ears/eye patches to the `head` bone.
3. **Phase 2 — LLM agents & evals:**
   - An `LLMPolicy` implementing `act(obs) -> list[Action]` (observation → prompt,
     tool/JSON action schema, stated reason → `decision` event).
   - Decision cadence (e.g. per GCD) and a latency/"thinking budget" model.
   - Multi-seed evaluation with confidence intervals; held-out seeds.
   - Track illegal/invalid actions as a metric.
4. **Phase 3:** expert trajectory generation → SFT a small open model (HF
   Transformers + TRL) → preference optimization / RL.
5. **Phase 4:** public leaderboard, side-by-side failure replays, host under
   the owner's personal site (`vite.config.ts` already uses `base: './'`).
