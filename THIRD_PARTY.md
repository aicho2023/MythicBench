# Credits and third-party material

MythicBench's code is MIT-licensed (see `LICENSE`). It builds on other
people's work, credited here.

## Art

The characters, animations and dungeon pieces are from **KayKit** by
**Kay Lousberg** ([kaylousberg.com](https://www.kaylousberg.com)). They are
released under CC0 (public domain), so credit isn't required, but it's given
gladly. The packs are:

| Pack | Version | Folder |
| --- | --- | --- |
| KayKit: Adventurers Character Pack | 2.0 | `web/public/assets/kaykit/adventurers` |
| KayKit Character Pack: Skeletons | 1.1 | `web/public/assets/kaykit/skeletons` |
| KayKit: Character Animations | 1.1 | `web/public/assets/kaykit/animations` |
| KayKit: Dungeon Asset Pack | 1.1 | `web/public/assets/kaykit/dungeon` |

Each folder keeps the pack's original `License.txt`. To support the artist,
buy a pack on [itch.io](https://kaylousberg.itch.io/) or back KayKit on
Patreon.

## Software

The viewer is built with:
- [three.js](https://threejs.org/) (MIT);
- [React Three Fiber](https://github.com/pmndrs/react-three-fiber), [drei](https://github.com/pmndrs/drei) and [postprocessing](https://github.com/pmndrs/postprocessing) (MIT);
- [React](https://react.dev/) (MIT) and [Zustand](https://github.com/pmndrs/zustand) (MIT);
- [Tailwind CSS](https://tailwindcss.com/) (MIT);
- [Lucide](https://lucide.dev/) icons (ISC);
- [Vite](https://vitejs.dev/) and [Vitest](https://vitest.dev/) (MIT).

The simulator uses only the Python standard library. Its tests use pytest and
jsonschema.

## Fonts

IBM Plex Sans and IBM Plex Mono, by IBM, and Inter, by Rasmus Andersson, all under
the SIL Open Font License 1.1 (via Fontsource).

## Inspiration

- **[Clocktower Bench](https://clocktowerbench.com/)** by Dwarkesh Patel. It
  showed what a game-based LLM eval can look like when it's done carefully:
  equal settings for every model, honest uncertainty, and a site people
  actually want to read.
- **World of Warcraft's Mythic+ dungeons**, the format this benchmark is
  modelled on: timed runs, trash packs, interrupts, affixes, and learning a
  boss over repeated pulls.

## Not affiliated with Blizzard

MythicBench is an independent fan-made research project. It is not
affiliated with, endorsed or sponsored by Blizzard Entertainment.
World of Warcraft and Mythic+ are trademarks of Blizzard Entertainment, Inc.
All names, numbers, encounters and art in MythicBench are original or come
from the CC0 packs above; no Blizzard assets or data are used.
