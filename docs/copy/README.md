# Copy rewrite workbook

The site's text is being rewritten by hand, page by page. This folder holds one
file per page. Each file lists every piece of text on that page as a **slot**:
where it appears, what it says now, what it has to get across, and a blank for
your version.

## How a page goes

1. Open the page's file and write your version under each slot. Rough is fine.
   Skip a slot to keep the current text, or write `CUT` to remove it.
2. Send it over (paste in chat, or commit the file).
3. Claude puts your words on the site, changing only:
   - typos, grammar and punctuation;
   - a number that doesn't match the dataset (flagged to you first, never
     changed silently);
   - line breaks needed to fit the layout.
4. You check the page locally (`cd web && npm run dev`) or on a preview link,
   then it merges.

Claude does not reword your sentences for style. If something reads unclear,
it gets flagged as a question, not rewritten.

## Order

Highest traffic first. Status is updated as pages land.

| # | Page | File | Status |
| --- | --- | --- | --- |
| 1 | Home `/` | [01-home.md](01-home.md) | done |
| 2 | About `/about` | [02-about.md](02-about.md) | waiting on your draft |
| 3 | Highlights `/highlights` | [03-highlights.md](03-highlights.md) | waiting on your draft |
| 4 | Party `/party` | [04-party.md](04-party.md) | waiting on your draft |
| 5 | Small pages, footer, share cards | [05-small-bits.md](05-small-bits.md) | waiting on your draft |
| 6 | Report `/report` | [06-report.md](06-report.md) | you write it in Google Docs, send the PDF |
| 7 | Video | [video/](video/) | you send a script |
| 8 | README (GitHub) | `README.md` at the repo root | later, after the site |

## Two things to fix everywhere (from friends' feedback)

**1. Say what we measure.** A visitor should be able to answer "what does the
score mean?" from the home page alone. The fact sheet:

- The study measures whether a team of five agents plays better after it fails.
- Score per attempt (a "pull"): 0 to 70 for how far the party got before dying,
  70 to 100 for a clear (more for a faster one). Nobody cleared, so every v1
  score is "how far did they get."
- A model's score: the average over its 6 groups of up to 5 pulls.
- Two separate things go into that average: how well a model plays blind
  (first pull), and how much it improves afterwards (pulls 2 to 5).
- The behavior that shows a lesson was learned: soaking Bone Pyre (2+ players
  stand inside the circle).

**2. Say what it means outside the game.** Each claim should name a real job,
not "workflows" in general. The research notes doc has a table of patterns
mapped to real-world examples, with how sure we are of each:
https://claude.ai/artifact/2U7yaxMAnmV6GCxMWanVAy

## Words to avoid

Friends' main complaint was that the text "sounds like AI." These are the
habits that most often cause that, as a checklist for reviewing your own draft
(and for Claude, when fixing grammar, to not reintroduce):

- Grouping things in threes by reflex ("fast, fair and checkable").
- "Not X, but Y" and "It's not just X, it's Y" sentence shapes.
- Colon reveals ("The answer: no.") and em-dash asides used for drama.
- Words like *delve, crucial, robust, landscape, tapestry, nuanced, showcase,
  leverage, seamless, testament, notably, ultimately*.
- Ending a paragraph with a summary line that restates it.
- Uniform sentence length. Real writing mixes short and long.
