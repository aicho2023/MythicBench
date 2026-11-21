# Art assets

The viewer uses the **KayKit** packs (CC0, by Kay Lousberg) committed under
`web/public/assets/kaykit/`. If those files are missing — or you add
`?art=procedural` to the URL — it falls back to the procedural placeholder art
built in code (`web/src/scene/avatars.tsx`, `web/src/scene/Arena.tsx`).

## How the KayKit integration works

- `web/src/scene/kaykit/assets.ts` — which model each unit uses, weapon loadouts, scales.
- `web/src/scene/kaykit/clips.ts` — which animation clip plays for each action
  (e.g. Throat Punch → `Melee_Unarmed_Attack_Punch_A`).
- `web/src/scene/kaykit/KayKitAvatar.tsx` — clones the skinned model, attaches
  weapons to the `handslot` bones, and sets each clip's playhead from **replay
  time** every frame, so pause/scrub stay deterministic.
- `web/src/scene/kaykit/Dungeon.tsx` — walls, pillars, gates, clutter, statues.

Every character shares the 23-bone `Rig_Medium` skeleton, so one animation
library drives heroes and skeletons alike. Characters are picked by the
`units[].model` field the simulator writes into each replay.

## KayKit packs to download (CC0, free / pay-what-you-want)

| Pack | Use | Link |
| --- | --- | --- |
| Character Pack: Adventurers | the five party members | https://kaylousberg.itch.io/kaykit-adventurers |
| Character Animations | shared walk / attack / cast / death clips | https://kaylousberg.itch.io/kaykit-character-animations |
| Character Pack: Skeletons | Mortisar (scaled-up Skeleton Warrior) + Bonewalkers + statues | https://kaylousberg.itch.io/kaykit-skeletons |
| Dungeon Remastered Pack | floors, walls, pillars, doors, props | https://kaylousberg.itch.io/kaykit-dungeon-remastered |

(The original *Dungeon Pack* — https://kaylousberg.itch.io/kaykit-dungeon-pack —
also works; Remastered is the newer version.)

## How to (re)add them

1. Download each pack from itch.io (choose $0 if you like).
2. Copy the **glTF/GLB** files (not FBX/OBJ) into:
   ```
   web/public/assets/kaykit/adventurers/
   web/public/assets/kaykit/animations/
   web/public/assets/kaykit/skeletons/
   web/public/assets/kaykit/dungeon/
   ```
   Include each pack's `License.txt`.
3. Commit them. The viewer picks them up automatically.

## Rules we follow

- Only original or properly licensed assets. No ripped game models, textures,
  icons, music, or logos.
- Icons come from [Lucide](https://lucide.dev) (ISC license).
- Fonts: Cinzel and Nunito via `@fontsource` (SIL Open Font License).
