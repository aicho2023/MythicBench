"""Progression: repeated pulls on one boss, learning between pulls.

An *episode* is what a raid team does on a new boss: pull, wipe, talk about
what happened, try again. Each pull:

1. The party plays the fight with the current NOTES in its rules (blind mode:
   nothing about the boss is given up front).
2. A factual debrief is built from the event log (``debrief.py``).
3. One *reflection* call turns (old notes + debrief) into updated notes.

The episode ends at the first kill or after ``max_pulls``. Every pull uses its
own seed, so boss timers differ: what transfers is understanding of the
mechanics, not memorized timings.

``memory=False`` is the control condition: notes are wiped between pulls, so
every pull looks like pull 1. If memory-on improves and memory-off doesn't,
the improvement comes from learning, not from luck or seed difficulty.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from ..engine import Encounter
from ..metrics import score
from .clients import ChatClient, ClientError
from .debrief import debrief_text
from .policy import make_llm_policies

NOTES_WORD_CAP = 350


def pull_seed(episode: int, pull: int) -> int:
    """Seed of a pull. Disjoint from the 0..9999 single-fight seeds."""
    return 10_000 + episode * 100 + pull


REFLECT_SYSTEM = f"""You lead a five-person party learning a dungeon boss over repeated attempts ("pulls"). After each pull you get a factual combat-log debrief. Update your team's NOTES so the next pull goes better.

Write what a good raid leader would keep:
- what each boss ability does and roughly when it happens (as far as you have actually observed),
- what killed people and why,
- concrete instructions for next pull (who interrupts what and in what order, when to use defensives, how to handle adds, how to avoid ground effects, cooldown timing),
- what worked and should be kept.

Only claim what the debriefs support; mark guesses as guesses. Keep the notes under {NOTES_WORD_CAP} words: replace stale points rather than piling up history.

Reply with ONLY a JSON object: {{"notes": "<your updated notes, plain text or markdown>"}}"""


def reflect(client: ChatClient, notes: str, debrief: str, pull: int) -> tuple[str, str | None]:
    """Returns (new notes, problem or None). On any failure the old notes are kept."""
    user = (f"NOTES BEFORE PULL {pull}:\n{notes.strip() or '(none yet: this was the first pull)'}\n\n"
            f"DEBRIEF OF PULL {pull}:\n{debrief}\n\nReply with the JSON containing your updated notes.")
    try:
        reply = client.complete(REFLECT_SYSTEM, user)
    except ClientError as err:
        if err.fatal:
            raise
        return notes, f"reflection call failed: {err}"
    m = re.search(r"\{.*\}", reply.text, re.S)
    try:
        new = json.loads(m.group(0))["notes"] if m else None
    except (json.JSONDecodeError, KeyError, TypeError):
        new = None
    if not isinstance(new, str) or not new.strip():
        return notes, "reflection reply had no usable notes"
    words = new.split()
    if len(words) > NOTES_WORD_CAP * 1.2:  # hard cap with a little slack
        new = " ".join(words[: NOTES_WORD_CAP]) + " …"
    return new.strip(), None


@dataclass
class PullResult:
    pull: int
    seed: int
    replay: dict
    stats: dict
    notes_before: str
    notes_after: str
    debrief: str
    problem: str | None = None

    @property
    def metrics(self) -> dict:
        return self.replay["meta"]["metrics"]


@dataclass
class EpisodeResult:
    episode: int
    pulls: list[PullResult] = field(default_factory=list)

    @property
    def killed_on(self) -> int | None:
        return next((p.pull for p in self.pulls if p.metrics["outcome"] == "victory"), None)


def run_episode(client: ChatClient, episode: int, *, max_pulls: int = 8, memory: bool = True,
                knowledge: str = "blind", interval_ms: int = 2000, max_calls: int = 300,
                level: int = 12, on_pull=None) -> EpisodeResult:
    result = EpisodeResult(episode)
    notes = ""
    for k in range(1, max_pulls + 1):
        seed = pull_seed(episode, k)
        notes_in = notes if memory else ""
        policies, brain = make_llm_policies(client, interval_ms=interval_ms, max_calls=max_calls,
                                            knowledge=knowledge, notes=notes_in or None, pull=k, level=level)
        rep = Encounter(seed, policies, f"llm:{client.spec}", level).run()
        rep["meta"]["metrics"] = score(rep)
        db = debrief_text(rep)
        problem = None
        notes_out = notes_in
        won = rep["meta"]["metrics"]["outcome"] == "victory"
        if memory and not won and k < max_pulls:
            notes_out, problem = reflect(client, notes_in, db, k)
        rep["meta"]["progress"] = {"episode": episode, "pull": k, "memory": memory, "knowledge": knowledge, "level": level,
                                   "notes_before": notes_in, "notes_after": notes_out, "debrief": db}
        pr = PullResult(k, seed, rep, brain.stats.as_dict(), notes_in, notes_out, db, problem)
        result.pulls.append(pr)
        if on_pull:
            on_pull(result, pr)
        notes = notes_out
        if won:
            break
    return result


# ---------------------------------------------------------------------------
# Metrics across episodes
# ---------------------------------------------------------------------------

def curve(ep: EpisodeResult, max_pulls: int) -> list[float]:
    """Score at each pull index. After a kill the episode is over, so the kill
    score carries forward (an early kill shouldn't be punished for stopping)."""
    out, last = [], 0.0
    for k in range(1, max_pulls + 1):
        p = next((x for x in ep.pulls if x.pull == k), None)
        last = p.metrics["score"] if p else last
        out.append(round(last, 1))
    return out


@dataclass
class _Pull:
    pull: int
    metrics: dict


@dataclass
class _Episode:
    episode: int
    pulls: list

    @property
    def killed_on(self) -> int | None:
        return next((p.pull for p in self.pulls if p.metrics["outcome"] == "victory"), None)


def summarize_items(items: list[dict], max_pulls: int) -> dict:
    """``summarize`` from a run manifest's items (used when rescoring saved runs)."""
    eps: dict[int, _Episode] = {}
    for it in sorted(items, key=lambda i: (i["episode"], i["pull"])):
        eps.setdefault(it["episode"], _Episode(it["episode"], [])).pulls.append(
            _Pull(it["pull"], {"score": it["score"], "outcome": it["outcome"]}))
    return summarize(list(eps.values()), max_pulls)


def summarize(episodes: list[EpisodeResult], max_pulls: int) -> dict:
    import math
    import statistics as st

    def ci(xs):
        if len(xs) < 2:
            return None
        h = 1.96 * st.stdev(xs) / math.sqrt(len(xs))
        return [round(st.mean(xs) - h, 1), round(st.mean(xs) + h, 1)]

    curves = [curve(e, max_pulls) for e in episodes]
    ptk = [e.killed_on if e.killed_on is not None else max_pulls + 1 for e in episodes]
    firsts = [c[0] for c in curves]
    bests = [max(c) for c in curves]
    early = [st.mean(c[:2]) for c in curves]
    late = [st.mean(c[-2:]) for c in curves]
    gain = [l - e for e, l in zip(early, late)]
    auc = [st.mean(c) for c in curves]
    return {
        "episodes": len(episodes), "max_pulls": max_pulls,
        "kill_rate": round(sum(e.killed_on is not None for e in episodes) / len(episodes), 3),
        "pulls_to_kill_mean": round(st.mean(ptk), 2), "pulls_to_kill_ci95": ci(ptk),
        "pulls_to_kill": ptk,
        "first_pull_score_mean": round(st.mean(firsts), 1),
        "best_score_mean": round(st.mean(bests), 1),
        "learning_gain_mean": round(st.mean(gain), 1), "learning_gain_ci95": ci(gain),
        # Progression score (0-100): mean pull score over the whole episode, a
        # kill carrying forward, so learning faster scores higher.
        "progression_score_mean": round(st.mean(auc), 1), "progression_score_ci95": ci(auc),
        "auc_mean": round(st.mean(auc), 1), "auc_ci95": ci(auc),
        "curve_mean": [round(st.mean(c[k] for c in curves), 1) for k in range(max_pulls)],
        # Leaderboard-compatible fields (the run browser shows these).
        "score_mean": round(st.mean(auc), 1),
        "win_rate": round(sum(e.killed_on is not None for e in episodes) / len(episodes), 3),
    }
