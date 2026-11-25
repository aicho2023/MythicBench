# Home page `/`

Source: `web/src/pages/Home.tsx`. The page is: hero (headline, intro, result,
two buttons, replay clip) then leaderboard, learning chart, Bone Pyre grid,
cost chart, three highlight cards.

Two new sections are proposed below (H-NEW-1, H-NEW-2) to answer friends'
feedback. Write `CUT` under either if you'd rather not have it.

---

## H1. Headline

Big text at the top left. Also the browser tab title.

> Can five AI agents learn from a wipe?

Constraint: under about 50 characters, or it wraps to three lines on a laptop.

**Your version:**


---

## H2. Intro paragraph

Under the headline.

> Five AI agents, each playing one character, team up to clear a dungeon in a
> game like World of Warcraft: two groups of monsters, then a boss, against the
> clock. They go in blind. When the whole party dies (a wipe), they read the
> combat log, talk it over, write their own notes, and try again, up to five
> times.

Must get across: five agents, same model; blind; they fail, review, retry, up
to five times. About 60 words fits beside the clip.

**Your version:**


---

## H3. Result callout

The line with the gold bar on its left, under the intro.

> Across 480 attempts by seven models from four labs, no AI team cleared the
> dungeon. But Claude Opus 5.5 and GPT-6.2 Sol each worked out how to survive
> the boss's party-wide blast in every one of their groups: two players have to
> stand inside the circle. The other five almost never did.

The last sentence links to the report's Bone Pyre section. Mark which words you
want as the link (e.g. with `[brackets]`).

**Your version:**


---

## H4. Buttons

> Watch a run · Read the report

**Your version:**


---

## H5. Clip labels

Small labels on top of the replay clip.

- Top left: "Watch for the glowing circle: players step inside to split the blast."
- Bottom right: "Open in the viewer"

**Your version:**


---

## H-NEW-1. What we measure (proposed new section, after the hero)

Doesn't exist yet. Goal: a visitor knows what the leaderboard number means
before they see it. Facts to draw on are in [README.md](README.md#two-things-to-fix-everywhere-from-friends-feedback).
Suggested length: a short heading and 2 to 4 sentences, or a heading and three
short labeled items (e.g. "Score", "First pull", "Learning").

**Your version (heading + text):**


---

## H6. Leaderboard heading and note

> Leaderboard
>
> (right side) +10, 6 groups per model, up to 5 pulls each
>
> (link) Results in the report

**Your version:**


---

## H6b. Leaderboard key (new, added in the UX pass)

Small text under the table, so the columns make sense without hovering (hover
doesn't exist on phones). Written plainly as a placeholder; yours replaces it.
Each line only shows on screens wide enough to show its column.

> - **Score:** the average over a model's groups. Under 70 measures how far
>   the party got before it died; a clear scores 70 to 100.
> - **Dots and bar:** each dot is one group's score; the bar is the 95%
>   interval, the white tick the average.
> - **First pull:** the blind first attempt, before any wipe to learn from.
> - **Cost per group:** one group of up to five pulls, at list prices,
>   thinking included.
> - **Scripted bot:** fixed rules played through the same controls: it
>   interrupts and steps out of pools, and never learns.

The table also now has a greyed "Scripted bot / Reference, not ranked" row.

**Your version:**


---

## H7. Learning chart heading

> Does it learn between wipes?
>
> (link) Learning in the report

There's no explanation under this chart right now. Want one? If so, write a
sentence on how to read it.

New in the UX pass: Opus and Sol are in colour, the other five in grey, and a
dashed line is the scripted bot. On phones the legend says "The other 5
models". Under the chart there's a new link:

> Watch Claude Opus 5.5's first and second pull side by side →

**Your version:**


---

## H8. Bone Pyre section

> **Learning to stand in the fire**
>
> Bone Pyre's blast hits everyone unless two players stand inside its circle.
> Each square below is one Pyre. After one wipe, Opus and Sol soak most of
> them. The other five almost never do, even when their notes say to.

Under the grid (small text):

> Each line is one group; each square, one Pyre in the order it went off. Click
> one to watch it.

**Your version:**


---

## H9. Cost chart heading

> What a score costs
>
> (link) Cost in the report

**Your version:**


---

## H-NEW-2. Outside the game (proposed new section, before or after Highlights)

Doesn't exist yet. Goal: one or two real-world takeaways a non-gamer cares
about, each naming a real job. Pick from the "Real-world implications" table in
the notes doc: https://claude.ai/artifact/2U7yaxMAnmV6GCxMWanVAy

Suggested length: heading plus 2 or 3 short items, each linking to the
report's section on it.

**Your version (heading + items):**


---

## H10. Highlights heading

> Highlights
>
> (link) All 23

**Your version:**

