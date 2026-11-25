# Report `/report`

The report is rewritten from scratch, not slot by slot.

## The workflow

1. **Raw material.** The research notes doc has the numbers, patterns,
   real-world mapping, caveats and a suggested outline:
   https://claude.ai/artifact/2U7yaxMAnmV6GCxMWanVAy
2. **You write it** in Google Docs, in your own words.
3. **Export as PDF** and send it.
4. **Claude puts it on the site**:
   - fixes typos, grammar and punctuation only;
   - checks every number against the dataset, and lists any mismatch for you
     to decide on (never changes one silently);
   - rebuilds the tables and figures from the live data, so they can't drift
     from the published results;
   - keeps the citations, references list, reproduce block and BibTeX working.
5. You review the page locally or on a preview link before it merges.

## What can be reused without you writing it

These are generated from the data, so they don't need prose from you. Tell
Claude where each one goes in your draft (e.g. "[Figure: learning curves]").

| Exhibit | What it shows |
| --- | --- |
| Group scores (Figure 1) | Every group's score by model, with mean and 95% interval |
| Results table (Table 3) | Score, interval, first pull, best pull, clears, cost per group |
| Pairwise table (Table 4) | All 21 model comparisons with p-values before and after Holm |
| Learning curves (Figure 2) | Mean score at each pull, per model |
| Bone Pyre table (Table 5) | Groups that soaked, Pyres soaked on pulls 2 to 5 |
| Soak by pull (Figure 3) | Share of Pyres soaked at each pull |
| Death causes (Figure 4) | What killed each model's characters |
| Memory test (Figure 5) | With vs without memory, same seeds |
| Cost table (Table 6) | Cost, tokens, low/medium/high effort |
| Behaviour table (Table 7) | Interrupts, chat lines, deaths per pull |
| Mechanics table (Table 1) | What each enemy ability does and asks |
| Related-work table (Table 8) | MythicBench vs other benchmarks, by design property |

Tables you want gone, just leave out of the draft.

## Things to keep in some form

- The author line and @awstnnnn link.
- The disclosed harness faults and process departures (validity section).
  Dropping them would weaken trust in the results; rewording is fine.
- Citations: write them however you like in the doc (e.g. "(Reflexion)") and
  they get mapped to the existing references.
