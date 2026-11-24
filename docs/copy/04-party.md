# Party page `/party`

Source: `web/src/pages/Party.tsx`. The ability names and their tooltips come
from the game itself (`sim/mythicsim/content.py`) and are what the agents read
in their prompts, so **they are not on this list**: changing them would change
the benchmark. Only the page's own text is.

---

## P1. Title and intro

> **The party and the dungeon**
>
> Every character and enemy, and what each ability does. Each character is
> played by its own AI agent, which sees the same tooltips for its party. The
> enemies' abilities it has to learn by fighting them.

**Your version:**


---

## P2. Party section

> **The party**
>
> Five characters, each played by a copy of the same model.

Footnote (numbers filled in from the game):

> Most abilities trigger a 1 s global cooldown. Melee range is 1.5 m from
> the target's edge. Moving cancels a cast in progress.

**Your version:**


---

## P3. One-line blurb per character

| Character | Current |
| --- | --- |
| Rook (tank) | Holds the boss and the packs. Kicks, taunts loose adds onto himself, and has one big defensive. |
| Ivy (healer) | The only healer. Single-target heals, a heal over time, a shield, and a group heal for the big hits. No kick. |
| Brask (melee) | Melee damage with a cleave for packs and a kick. |
| Kit (melee) | Melee damage, an area attack for packs, and a fast kick that is off the global cooldown. |
| Wren (ranged) | Ranged damage, a ranged kick, and Wild Roar: haste for the whole party. |

**Your versions:**

- Rook:
- Ivy:
- Brask:
- Kit:
- Wren:

---

## P4. Enemies section

> **Enemies**
>
> The Hollow Vault: two packs of undead, then Oruth. The agents start without
> any of this.

Footnote:

> On +10, Hollow Tyrant makes Oruth summon adds three times (at 80%, 50% and
> 25% health) and adds Grave Mark.

**Your version:**


---

## P5. One-line blurb per enemy

| Enemy | Current |
| --- | --- |
| Bonewalker | The melee undead in both packs. It chases whoever it is attacking. On +10 each one that dies leaves a grave. |
| Bone Chanter | The caster in the first pack. Its Grave Volley hits the whole party, so someone has to kick it. |
| Marrow Mender | The healer in the second pack. Kill it first, or it keeps the others standing. |
| Oruth | The last boss. A cast to kick, a tank buster, pools, adds, a hard enrage, and Bone Pyre: the circle you have to stand in. |

**Your versions:**

- Bonewalker:
- Bone Chanter:
- Marrow Mender:
- Oruth:

---

## P6. Difficulty section

> **Difficulty and affixes**
>
> The score is on +10; Normal is a check. Affixes are always visible to the
> agents, as in the game. Watch a run to see them in play.

"Watch a run" is a link.

**Your version:**

