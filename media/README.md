# MythicBench media

Everything here is rendered from the published replays by
`web/scripts/media.mjs` (see the main README). Every line of chat on screen is
verbatim from the replay it plays over. Videos are 1280×720, H.264, silent, with
captions, so they work muted in a feed.

## Launch video

`launch/mythicbench-launch.mp4`: about 40 seconds. One Claude Opus 5.5 group goes
from failure to the fix, followed by a model that never finds it and the result:

1. Five AI agents. One boss they've never seen.
2. **Pull 1, blind.** Wren: "stay out of it." Nobody stands in the Pyre, and it hits everyone.
3. **The debrief.** Rook: "…the log shows nobody was inside the circle. I think it has to be soaked."
4. **Pull 2.** Wren: "Everyone stack in it!" All five inside, and the blast is split five ways.
5. Two of seven models learned this. The other five almost never did.
6. **GPT-6 Luna, pull 3.** Nobody inside, and all five die.
7. The Pyre grid from the site, with every Pyre in every group.
8. mythicbench.com

## Highlight clips

| File | Model | What happens |
|---|---|---|
| `clips/step-in-now.mp4` | Claude Opus 5.5, group 3, pull 3 | The tank is alone in the Pyre with 1.5 s left and calls the party in. Three make it. |
| `clips/nobody-inside.mp4` | Claude Opus 5.5, group 1, pull 1 | The blind first pull: the party stays out of the glowing circle, and it kills Brask. |
| `clips/saw-it-fail.mp4` | GPT-6 Luna, group 7, pull 4 | Two soak the first Pyre and nobody is hurt. The next has one player inside and kills two, and the party decides the circle is useless. |
| `clips/pyre-kills-five.mp4` | GPT-6 Luna, group 8, pull 3 | Nobody stands in the circle, and one Pyre kills all five. |

## Share card

`share-card.jpg` is the same image as `web/public/og.jpg`, the preview X, Slack
and Discord show for the link.

## Suggested posts

**Launch (with the launch video)**

> Can five AI agents learn from a wipe?
>
> MythicBench: five copies of one model run a Mythic+-style dungeon blind. They
> wipe, read the combat log, talk it over and try again.
>
> 7 models, 480 attempts, 0 clears. Only Claude Opus 5.5 and GPT-6.2 Sol learned
> to stand in the circle.
>
> Every pull is replayable: mythicbench.com

**Thread, one post each**

- On the blind first pull, every model scores about what a scripted bot does. The gap opens after the first wipe. (home page learning chart)
- Knowing isn't doing. In Grok 4.3's first group, all five agents wrote that the Pyre must be soaked and named who would stand in it. They managed it on 2 of 9 Pyres. (`clips/saw-it-fail.mp4` shows the same gap in Luna)
- Told a rule up front (Grave Mark: "get away from the group"), every model follows it 78 to 99% of the time. What the other five lacked was the lesson, not the footwork.
- Opus and Sol tie on score, but an Opus group costs about five times as much. (home page cost chart)
- Pre-registered, every model reply recorded, and the leaderboard rebuilds offline for free. (link to the report)

**For WoW players (r/wow, r/CompetitiveWoW), with `clips/pyre-kills-five.mp4` or `clips/saw-it-fail.mp4`**

> I made AI agents pug a Mythic+ key. Most of them never learn to soak.

## Adding music

The launch video is cut to "Rise of Kings" (`Epic_Cinematic_Music_No_Copyright_Rise_of_Kings.mp3`,
2:35), in two versions. The track isn't stored in the repository. With it next to the video:

**A, "the drop":** the song starts at 0:29.75, so its breakdown plays while the agents move
into the circle and the music comes back full as the blast splits five ways (24.0 s).

```bash
ffmpeg -ss 29.75 -t 46 -i track.mp3 -i launch/mythicbench-launch.mp4 \
  -filter_complex "[0:a]afade=t=in:st=0:d=1.2,afade=t=out:st=43:d=3[a]" \
  -map 1:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest launch/mythicbench-launch-music-A.mp4
```

**B, "the build":** the song plays from the top: a quiet intro, the soft build under the
blind wipe, and the first big hit as pull 2 starts.

```bash
ffmpeg -t 45.45 -i track.mp3 -i launch/mythicbench-launch.mp4 \
  -filter_complex "[0:a]adelay=550|550,afade=t=out:st=43:d=3[a]" \
  -map 1:v -map "[a]" -c:v copy -c:a aac -b:a 192k -t 46 launch/mythicbench-launch-music-B.mp4
```

These timings are for the 46.0 s cut (pulls 1 and 2 held about 2 s after each blast). If the
video's timing changes, the payoff moment moves too: it's when "All five inside" appears.
