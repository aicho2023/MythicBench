# Art assets

Today every character and prop is built procedurally in code
(`web/src/scene/avatars.tsx`, `web/src/scene/Arena.tsx`), so the repo ships no
image or model files and has no licensing questions.

## KayKit packs to download (CC0, free / pay-what-you-want)

| Pack | Use | Link |
| --- | --- | --- |
| Character Pack: Adventurers | the five party members | https://kaylousberg.itch.io/kaykit-adventurers |
| Character Animations | shared walk / attack / cast / death clips | https://kaylousberg.itch.io/kaykit-character-animations |
| Character Pack: Skeletons | Mortisar (scaled-up Skeleton Mage) + Bonewalkers | https://kaylousberg.itch.io/kaykit-skeletons |
| Dungeon Remastered Pack | floors, walls, pillars, doors, props | https://kaylousberg.itch.io/kaykit-dungeon-remastered |

(The original *Dungeon Pack* — https://kaylousberg.itch.io/kaykit-dungeon-pack —
also works; Remastered is the newer version.)

## How to add them

1. Download each pack from itch.io (choose $0 if you like).
2. Copy the **glTF/GLB** files (not FBX/OBJ) into:
   ```
   web/public/assets/kaykit/adventurers/
   web/public/assets/kaykit/animations/
   web/public/assets/kaykit/skeletons/
   web/public/assets/kaykit/dungeon/
   ```
   Include each pack's `License.txt`.
3. Commit them. Then the viewer can be switched from procedural rigs to the GLB
   models: each rig only needs to implement the same pose contract used by
   `animateHumanoid` (`idle / walk / attack / shoot / cast / dead`).

The simulator already names each unit's intended model (`Knight`, `Mage`,
`Barbarian`, `Rogue`, `Rogue_Hooded`, `Skeleton_Mage`, `Skeleton_Minion`) in
the replay's `units[].model` field.

## Rules we follow

- Only original or properly licensed assets. No ripped game models, textures,
  icons, music, or logos.
- Icons come from [Lucide](https://lucide.dev) (ISC license).
- Fonts: Cinzel and Nunito via `@fontsource` (SIL Open Font License).
