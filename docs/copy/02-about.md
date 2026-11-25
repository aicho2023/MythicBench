# About page `/about`

Source: `web/src/pages/About.tsx`. One column of sections. Each section is a
heading plus a few paragraphs or a list. Section headings are listed as their
own slot so you can rename or cut them.

---

## A1. Title and intro

> **About MythicBench**
>
> MythicBench tests whether a team of AI agents can learn something hard and
> new from its own failures. The task is a boss fight.

**Your version:**


---

## A2. "Why a dungeon"

> Most agent benchmarks give a model one attempt at a task and score the
> result. Real work rarely goes like that. You try, it goes wrong, you work out
> why, and you try again. MythicBench measures that loop.
>
> A Mythic+ style dungeon suits it well. It needs five roles working together.
> Some of its mechanics punish instinct. It runs on a timer. And failure is
> cheap and easy to read: every wipe leaves a combat log, and the next pull
> shows whether anything was learned.

Good place for the "what does this mean for real work" point too.

**Your version:**


---

## A3. "How a run works" (numbered list of 4, then a paragraph)

> 1. **Five agents, one model.** Five copies of the same model each play one
>    character: a tank, a healer and three damage dealers.
> 2. **They go in blind.** Nobody tells them what the boss does. They see what
>    their character would see, and can talk in party chat.
> 3. **They pull.** Every few seconds of game time, each agent sends its
>    orders: where to move, what to cast, and on whom. The game waits while
>    they think.
> 4. **After a wipe, they debrief.** They read the combat log, talk it over,
>    and each rewrites its own notes. Those notes are all they carry into the
>    next pull.
>
> A group gets up to five pulls, each on a new random seed, so it has to learn
> the mechanics, not memorise timings. Every model plays six fresh groups.

**Your version:**


---

## A-NEW. What the score means (proposed new section, after "How a run works")

Doesn't exist yet. This is the natural home for a fuller "what we measure"
explanation than the home page has room for. Fact sheet:
[README.md](README.md#two-things-to-fix-everywhere-from-friends-feedback) and
the "What we measure" table in the notes doc.

**Your version:**


---

## A4. "For WoW players"

> Think of a fresh key in a dungeon you've never run, with no guide. Each
> character has an interrupt, a defensive and a cooldown. The party page lists
> every ability, and the replay viewer shows unit frames, the combat log and
> every order the agents gave.
>
> - **Two trash packs.** One has a caster to kick, the other a healer to kill first.
> - **Oruth the Unburied.** A cast to kick, a tank buster, pools, a soak, adds and a hard enrage.
> - **+10.** Graves that heal the undead, stacking damage on every trash kill, and more adds, on a 4:15 timer.
>
> The names, numbers and art are original. The design is meant to feel familiar.

Keep "party page" and "replay viewer" somewhere in it; they're links.

**Your version:**


---

## A5. "Fair and checkable" (list of 6)

> - Every model gets the same rules, seeds, reasoning effort and call budget,
>   all fixed in a public pre-registration before the run.
> - Every model reply is recorded, so every pull replays exactly and every
>   number can be recomputed.
> - A memory-off control plays the same seeds without the debrief, to measure
>   what carrying lessons across wipes is worth.
> - One model is called better than another only when it scores higher on the
>   same seeds, by a margin a statistical test supports.
> - Problems found after the run are disclosed, in the report and the
>   changelog.
> - Anyone can rebuild the leaderboard for free from the recorded replies: the
>   README shows how.

**Your version:**


---

## A6. "Questions" (three Q&As)

> **Don't the models already know World of Warcraft?**
> They know the genre. The dungeon is original, so no guide to it exists. But
> its mechanics are familiar types, so the benchmark tests applying general
> game knowledge as well as learning from scratch.
>
> **Is it fair to make an AI play in real time?**
> It doesn't have to. The game pauses while the agents think, so reply speed
> never matters. Orders come every few seconds of game time rather than every
> global cooldown, which makes the fight about decisions, not reflexes.
>
> **Why does nobody clear +10?**
> It is hard on purpose. Even the expert script clears it rarely, and only with
> near-perfect play. That leaves room for stronger models to show progress, and
> a known solution for them to find.

Add or drop questions freely. Ones friends asked would be the best ones to add.

**Your version:**


---

## A7. "Who made this"

> MythicBench is built and run by Austin. Follow along, or get in touch, on X
> at @awstnnnn.

**Your version:**


---

## A8. "Support MythicBench"

> MythicBench is a personal project, and every run is paid for out of pocket:
> the official run of seven models cost several hundred dollars in API fees.
> Donations go straight into running more models, stronger ones, and harder
> experiments.
>
> (button) Venmo @ach1492

Fact: the official run cost about $445 at list prices.

**Your version:**


---

## A9. "Credits"

Mostly factual, probably fine as is, but here it is:

> - Characters, animations and dungeon art: KayKit by Kay Lousberg, released under CC0
> - The format of this site is inspired by Clocktower Bench by Dwarkesh Patel
> - Built with three.js, React Three Fiber, React, Tailwind CSS and Lucide icons; type is IBM Plex
>
> Full list and licenses: THIRD_PARTY.md. The code is MIT-licensed.

**Your version:**

