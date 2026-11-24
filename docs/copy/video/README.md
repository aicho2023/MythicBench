# Video

The old video's writing read as AI-generated, so the script is being redone by
hand. This folder is the kit for that: a script template, and a list of every
replay moment worth filming, with the exact link and timestamp.

I couldn't find the existing video or its script in the repo. If it lives
somewhere (a file, a YouTube or X link, an editing project), send it over and
I'll add its current script and shot list here, so you can see what's being
replaced.

## How this goes

1. Write the script in [script.md](script.md): what's on screen and what's
   said, scene by scene. Rough is fine.
2. Pick shots from the list below, or describe what you want and I'll find it
   in the replays.
3. I fix grammar only, check every number against the dataset, and prepare the
   clips (exact links and timestamps; I can try recording them headlessly, or
   you screen-record from the viewer).

## Filming from the viewer

- Open any link below on `mythicbench.com` (or `localhost:5173` with
  `cd web && npm run dev`).
- `?t=106` starts at 1:46. Space plays and pauses, arrow keys seek 5 s, keys 1
  to 4 set the speed.
- `/compare` puts two replays on one clock, seen from above. The preset is
  Opus group 2, blind pull 1 against pull 2: the clearest before/after in the
  study.
- Each highlight also has a still in `web/public/stills/<id>.jpg`.

## Shot list: the 23 highlights

Group and pull are 1-based (g1 p1 = group 1, pull 1). The URL uses 0-based
group numbers, as the viewer does.

| Moment | Model | Link | Starts at | What happens (first line) |
| --- | --- | --- | --- | --- |
| Saw it work, then saw it fail | Luna g7 p4 | `/watch/gpt-6-luna/plus10/6/4?t=115` | 1:55 | Ivy calls for the party to stand in the Pyre. |
| Nobody was inside the circle | Opus g1 p1 | `/watch/claude-opus-5-5/plus10/0/1?t=106` | 1:46 | On the first, blind pull, Wren sees Bone Pyre's circle appear and tells everyone to stay out of it. |
| Same clue, opposite conclusion | Sonnet g2 p4 | `/watch/claude-sonnet-5-5/plus10/1/4?t=150` | 2:30 | Sonnet's party reads the same evidence Opus's did: the Pyre went off with nobody inside and hit everyone. |
| The empty circle, read backwards | Haiku g3 p1 | `/watch/claude-haiku-5-5/plus10/2/1` | debrief only | The debrief tells Haiku's party that Bone Pyre went off with nobody inside and still hit all five of them. |
| Step in NOW, 1.5 seconds | Opus g3 p3 | `/watch/claude-opus-5-5/plus10/2/3?t=92` | 1:32 | A Pyre lands while the party is spread out, and with 1.6 seconds left only Rook, the tank, is inside. |
| The closest anyone came | Sol g1 p4 | `/watch/gpt-6.2-sol/plus10/0/4?t=225` | 3:45 | All five of Sol's agents are alive when the 4:15 timer runs out, with Oruth at 8.7% health. |
| Did everything right, ran out of clock | Sol g4 p3 | `/watch/gpt-6.2-sol/plus10/3/3?t=225` | 3:45 | Sol's party gets the mechanics right: every Bone Pyre soaked, all 11 Requiems interrupted, one death in the last six seconds. |
| Rook tests the solo soak | Sol g3 p2 | `/watch/gpt-6.2-sol/plus10/2/2?t=88` | 1:28 | After the first wipe, Rook proposes an experiment: he'll stand in the Pyre alone with his defensive and a shield while everyone else stays out. |
| Lesson learned too well | Opus g1 p5 | `/watch/claude-opus-5-5/plus10/0/5?t=184` | 3:04 | After pull 4 the whole party writes the same rule into its notes: get into every Bone Pyre, even if that means standing in a Desecrate pool. |
| The healer flees to the front door | Opus g5 p1 | `/watch/claude-opus-5-5/plus10/4/1?t=160` | 2:40 | With the rest of the party dead, Ivy runs from the boss room all the way back to the dungeon entrance, two adds chasing her, healing herself for a full minute. |
| Out of kicks, 0.2 seconds to spare | Sol g6 p5 | `/watch/gpt-6.2-sol/plus10/5/5?t=12` | 0:12 | The Bone Chanter restarts Grave Volley the moment it's interrupted. |
| Luna's one breakthrough | Luna g10 p5 | `/watch/gpt-6-luna/plus10/9/5?t=133` | 2:13 | Luna's parties agree group after group that the Pyre hits everyone no matter what. |
| Four kicks, zero left | Opus g1 p1 | `/watch/claude-opus-5-5/plus10/0/1?t=4` | 0:04 | Seconds into the very first pull, all four players with an interrupt use it on the same caster within 3.4 seconds. |
| “Correction: I have no defensive either” | Haiku g7 p4 | `/watch/claude-haiku-5-5/plus10/6/4` | debrief only | In the debrief, Ivy asks the two melee players to use their defensive cooldowns for the next Pyre. |
| Joining Rook in the Pyre, almost | Sol g2 p2 | `/watch/gpt-6.2-sol/plus10/1/2?t=240` | 4:00 | Twenty seconds left, Oruth at about 17%. |
| A misread number rewrites the plan | Sol g3 p4 | `/watch/gpt-6.2-sol/plus10/2/4?t=186` | 3:06 | Four of Sol's agents pick the same spot to soak the Pyre, and Oruth's Desecrate pools, aimed at players, land on all of them at once. |
| Everyone thought someone else would kick | Sonnet g6 p3 | `/watch/claude-sonnet-5-5/plus10/5/3?t=20` | 0:20 | With notes full of plans for Oruth, the party wipes on the first trash pack in 37 seconds. |
| The healer who wouldn't quit | Luna g12 p1 | `/watch/gpt-6-luna/plus10/11/1?t=20` | 0:20 | Four of the five die to the first trash pack within three seconds. |
| One Pyre kills all five | Luna g8 p3 | `/watch/gpt-6-luna/plus10/7/3?t=136` | 2:16 | Brask begs for an emergency heal before the Pyre. |
| Found it, lost it, found it again | Sonnet g3 p3 | `/watch/claude-sonnet-5-5/plus10/2/3?t=112` | 1:52 | After pull 2, the healer notices the tank took less damage inside the circle. |
| Half the party says run, half steps in | DeepSeek g2 p2 | `/watch/deepseek-flash/plus10/1/2?t=110` | 1:50 | As the first Bone Pyre appears, Ivy announces she is moving in to soak it, while Wren tells Brask and Kit to step out. |
| The plan worked once | Grok g1 p2 | `/watch/grok-4.3/plus10/0/2?t=158` | 2:38 | After the first wipe, all five of Grok 4.3's agents write the same plan into their notes: Brask and Kit soak Bone Pyre. |
| Unavoidable, they agreed | DeepSeek g1 p2 | `/watch/deepseek-flash/plus10/0/2?t=100` | 1:40 | After the first wipe, four of DeepSeek V4.1 Flash's five agents write that Bone Pyre can't be avoided. |

## Numbers that work on screen

Short enough to read in two seconds. All checked against the v1 dataset; the
notes doc has the full list:
https://claude.ai/artifact/2U7yaxMAnmV6GCxMWanVAy

- 480 attempts, 0 clears
- 7 models, 4 labs
- First try: every model 31 to 37 points. After that, two pull ahead.
- Opus and Sol learned the trick in 12 of 12 groups. The rest: 6 of 42.
- Closest anyone came: boss at 8.7%
- Opus, pull 1 to pull 2: 36.9 to 52.5
- Same score, a fifth of the price (Sol vs Opus)
- Even a hand-written expert clears 4 in 1,000
