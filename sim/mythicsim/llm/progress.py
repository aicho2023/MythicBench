"""Progression: repeated pulls, learning between pulls, like a WoW group.

An *episode* is what a group does with a new key: pull, wipe, talk it over,
try again. Each pull:

1. Five agents play the run, one per character, each with its own notes in
   its rules (blind mode: nothing about the boss is given up front).
2. A factual combat-log summary of the pull is built from the event log
   (``debrief.py``). Every agent gets the same one, like a shared log.
3. The party talks: agents take turns in party order, each seeing its own
   notes, the log, and the talk so far, until every agent says it's ready (or
   ``TALK_ROUNDS`` rounds pass).
4. Each agent writes its own notes for the next pull. They are private and are
   the only thing it carries into the next pull.

Nothing in steps 3 and 4 tells the agents what to learn or how: the prompts
only say what is happening and what to reply with.

The episode ends at the first *timed* clear (the boss dead within the timer)
or after ``max_pulls``. An over-time kill is a depleted key: it scores, but the
group goes again. Every pull uses its own seed, so timers differ: what
transfers is understanding, not memorized timings.

``memory=False`` is the control condition: no talk and no notes, so every pull
looks like pull 1. Comparing memory on with memory off on the same seeds
isolates what learning adds.
"""

from __future__ import annotations

import json
import math
import re
import statistics as st
from dataclasses import dataclass, field

from .. import content as C
from ..engine import Encounter
from ..metrics import score
from .clients import ChatClient, ClientError
from .debrief import debrief_text
from .policy import PARTY_IDS, Agent, BrainStats, make_llm_policies

NOTES_WORD_CAP = 350
MESSAGE_WORD_CAP = 150
TALK_ROUNDS = 3


def pull_seed(episode: int, pull: int) -> int:
    """Seed of a pull. Disjoint from the 0..9999 single-fight seeds."""
    return 10_000 + episode * 100 + pull


def _cap(text: str, words: int) -> str:
    w = text.split()
    return text.strip() if len(w) <= words * 1.2 else " ".join(w[:words]) + " …"


def _json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    try:
        d = json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        return None
    return d if isinstance(d, dict) else None


def _talk_lines(talk: list[dict]) -> str:
    names = {m.id: m.name for m in C.PARTY}
    said = [f"  {names[x['agent']]} ({x['agent']}): {x['message']}" for x in talk if x["message"]]
    return "\n".join(said) if said else "  (nobody has spoken yet)"


def _review(pull: int, notes: str, debrief: str) -> str:
    return (f"THE PULL (PULL {pull}) IS OVER.\n\n"
            f"YOUR NOTES GOING INTO PULL {pull}:\n{notes.strip() or '(none)'}\n\n"
            f"COMBAT LOG SUMMARY OF PULL {pull} (everyone in the party has this):\n{debrief}\n\n")


def _count(acc: BrainStats | None, reply) -> None:
    if acc is None:
        return
    acc.calls += 1
    acc.input_tokens += reply.input_tokens
    acc.output_tokens += reply.output_tokens
    acc.cache_read_tokens += reply.cache_read_tokens
    acc.cache_write_tokens += reply.cache_write_tokens
    acc.cached_calls += reply.cached
    acc.truncated_replies += reply.truncated
    acc.refusals += reply.refused


def team_talk(client: ChatClient, agents: dict[str, Agent], notes: dict[str, str], debrief: str, pull: int,
              scope: str, problems: list[str], acc: BrainStats | None = None) -> list[dict]:
    """The party talks before the next pull, one agent at a time in party
    order, until everyone is ready. Returns the transcript."""
    talk: list[dict] = []
    ready: set[str] = set()
    for rnd in range(1, TALK_ROUNDS + 1):
        for uid in PARTY_IDS:
            user = (_review(pull, notes.get(uid, ""), debrief)
                    + f"PARTY TALK (before pull {pull + 1}, round {rnd} of at most {TALK_ROUNDS}):\n{_talk_lines(talk)}\n\n"
                    + "It's your turn to speak. The talk ends when everyone is ready.\n"
                    + 'Reply with ONLY a JSON object: {"message": "<what you say to the party, or \\"\\" to say nothing>", '
                    + '"ready": <true if you have nothing more to discuss>}')
            try:
                reply = client.complete(agents[uid].system, user, tag=f"{scope}|talk|{rnd}|{uid}")
            except ClientError as err:
                if err.fatal:
                    raise
                problems.append(f"talk {uid} round {rnd}: {err}")
                if acc is not None:
                    acc.api_errors += 1
                continue
            _count(acc, reply)
            d = _json(reply.text)
            if d is None:
                problems.append(f"talk {uid} round {rnd}: no usable JSON")
                if acc is not None:
                    acc.unusable_replies += 1
                continue
            msg = _cap(str(d.get("message") or ""), MESSAGE_WORD_CAP)
            talk.append({"round": rnd, "agent": uid, "message": msg, "ready": bool(d.get("ready")),
                         "thinking": reply.thinking, "input_tokens": reply.input_tokens,
                         "output_tokens": reply.output_tokens})
            if d.get("ready"):
                ready.add(uid)
            else:
                ready.discard(uid)
        if ready >= set(PARTY_IDS):
            break
    return talk


def write_notes(client: ChatClient, agent: Agent, notes: str, debrief: str, talk: list[dict], pull: int,
                scope: str, acc: BrainStats | None = None) -> tuple[str, str | None]:
    """One agent's own notes for the next pull. On any failure the old notes are kept."""
    user = (_review(pull, notes, debrief)
            + f"WHAT THE PARTY SAID:\n{_talk_lines(talk)}\n\n"
            + f"WRITE YOUR NOTES for pull {pull + 1}. They replace your current notes and are the only thing you "
            + f"will have from this pull and this talk when the next pull starts. At most {NOTES_WORD_CAP} words.\n"
            + 'Reply with ONLY a JSON object: {"notes": "<your notes>"}')
    try:
        reply = client.complete(agent.system, user, tag=f"{scope}|notes|{agent.uid}")
    except ClientError as err:
        if err.fatal:
            raise
        if acc is not None:
            acc.api_errors += 1
        return notes, f"notes {agent.uid}: {err}"
    _count(acc, reply)
    d = _json(reply.text)
    new = d.get("notes") if d else None
    if not isinstance(new, str) or not new.strip():
        if acc is not None:
            acc.unusable_replies += 1
        return notes, f"notes {agent.uid}: no usable notes in the reply"
    return _cap(new, NOTES_WORD_CAP), None


def cleared(metrics: dict) -> bool:
    """A clear is a timed clear: the boss dead with the timer not run out."""
    return metrics["outcome"] == "victory" and bool(metrics.get("in_time", True))


@dataclass
class PullResult:
    pull: int
    seed: int
    replay: dict
    stats: dict
    notes_before: dict[str, str]
    notes_after: dict[str, str]
    debrief: str
    talk: list[dict] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    @property
    def metrics(self) -> dict:
        return self.replay["meta"]["metrics"]

    @property
    def problem(self) -> str | None:
        return "; ".join(self.problems[:3]) if self.problems else None


@dataclass
class EpisodeResult:
    episode: int
    pulls: list[PullResult] = field(default_factory=list)

    @property
    def killed_on(self) -> int | None:
        return next((p.pull for p in self.pulls if cleared(p.metrics)), None)


def run_episode(client: ChatClient, episode: int, *, max_pulls: int = 5, memory: bool = True,
                knowledge: str = "blind", interval_ms: int = 4000, max_calls: int = 300,
                tier: str = C.DEFAULT_TIER, mode: str = "boss", on_pull=None, parallel: bool = True,
                scope: str = "") -> EpisodeResult:
    result = EpisodeResult(episode)
    notes: dict[str, str] = {uid: "" for uid in PARTY_IDS}
    for k in range(1, max_pulls + 1):
        seed = pull_seed(episode, k)
        tag = f"{scope}e{episode}p{k}"
        notes_in = dict(notes) if memory else {uid: "" for uid in PARTY_IDS}
        policies, party = make_llm_policies(client, interval_ms=interval_ms, max_calls=max_calls,
                                            knowledge=knowledge, notes=notes_in, pull=k, tier=tier,
                                            mode=mode, scope=tag, parallel=parallel)
        if mode == "dungeon":
            from ..dungeon import DungeonRun
            rep = DungeonRun(seed, policies, f"llm:{client.spec}", tier).run()
        else:
            rep = Encounter(seed, policies, f"llm:{client.spec}", tier).run()
        rep["meta"]["metrics"] = score(rep)
        db = debrief_text(rep)
        problems: list[str] = []
        notes_out = dict(notes_in)
        talk: list[dict] = []
        between = BrainStats()
        done = cleared(rep["meta"]["metrics"])
        if memory and not done and k < max_pulls:
            talk = team_talk(client, party.agents, notes_in, db, k, tag, problems, between)
            for uid in PARTY_IDS:
                notes_out[uid], problem = write_notes(client, party.agents[uid], notes_in[uid], db, talk, k, tag,
                                                      between)
                if problem:
                    problems.append(problem)
        rep["meta"]["progress"] = {"episode": episode, "pull": k, "memory": memory, "knowledge": knowledge,
                                   "tier": tier, "agents": "per-character",
                                   "notes_before": notes_in, "notes_after": notes_out, "talk": talk, "debrief": db}
        rep["agents"] = {uid: {"system": a.system} for uid, a in party.agents.items()}
        rep["calls"] = party.calls
        stats = party.stats_dict()
        stats["in_pull"] = {k_: stats[k_] for k_ in ("calls", "input_tokens", "output_tokens")}
        stats["between_pulls"] = {k_: v for k_, v in between.as_dict().items() if k_ not in ("problems", "triggers")}
        for k_ in ("calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cached_calls",
                   "unusable_replies", "truncated_replies", "api_errors", "refusals"):
            stats[k_] += getattr(between, k_)  # totals cover every call made for this pull
        stats["problems"] = (stats["problems"] + problems)[:20]
        pr = PullResult(k, seed, rep, stats, notes_in, notes_out, db, talk, problems)
        result.pulls.append(pr)
        if on_pull:
            on_pull(result, pr)
        notes = notes_out
        if done:
            break
    return result


# ---------------------------------------------------------------------------
# Statistics across episodes
# ---------------------------------------------------------------------------

# Two-sided 95% Student t quantiles by degrees of freedom. With 3 episodes the
# multiplier is 4.30, not 1.96: a normal interval would be over 2x too narrow.
_T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262,
        10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101,
        19: 2.093, 20: 2.086, 25: 2.060, 30: 2.042, 40: 2.021, 60: 2.000, 120: 1.980}


def t95(df: int) -> float:
    if df < 1:
        raise ValueError("need at least 2 samples")
    known = [d for d in _T95 if d <= df]
    return _T95[max(known)] if df < 120 else 1.96


def ci95(xs: list[float]) -> list[float] | None:
    """Student-t 95% interval for the mean of independent samples (episodes)."""
    if len(xs) < 2:
        return None
    m = st.mean(xs)
    h = t95(len(xs) - 1) * st.stdev(xs) / math.sqrt(len(xs))
    return [round(m - h, 1), round(m + h, 1)]


def diff_ci95(a: list[float], b: list[float]) -> list[float] | None:
    """Welch 95% interval for mean(a) - mean(b)."""
    if len(a) < 2 or len(b) < 2:
        return None
    va, vb = st.variance(a) / len(a), st.variance(b) / len(b)
    d = st.mean(a) - st.mean(b)
    se = math.sqrt(va + vb)
    if se == 0:
        return [round(d, 1), round(d, 1)]
    df = (va + vb) ** 2 / ((va * va) / (len(a) - 1) + (vb * vb) / (len(b) - 1))
    h = t95(max(1, int(df))) * se
    return [round(d - h, 1), round(d + h, 1)]


def curve(ep: EpisodeResult, max_pulls: int) -> list[float]:
    """Score at each pull index. After a timed clear the episode is over, so
    that score carries forward (an early clear shouldn't be punished for stopping)."""
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
        return next((p.pull for p in self.pulls if cleared(p.metrics)), None)


def summarize_items(items: list[dict], max_pulls: int) -> dict:
    """``summarize`` from a run manifest's items (used when rescoring saved runs)."""
    eps: dict[int, _Episode] = {}
    for it in sorted(items, key=lambda i: (i["episode"], i["pull"])):
        eps.setdefault(it["episode"], _Episode(it["episode"], [])).pulls.append(
            _Pull(it["pull"], {"score": it["score"], "outcome": it["outcome"], "in_time": it.get("in_time", True)}))
    return summarize(list(eps.values()), max_pulls)


def summarize(episodes: list[EpisodeResult], max_pulls: int) -> dict:
    curves = [curve(e, max_pulls) for e in episodes]
    clears = [e.killed_on for e in episodes]
    firsts = [c[0] for c in curves]
    bests = [max(c) for c in curves]
    prog = [st.mean(c) for c in curves]
    cleared_eps = [k for k in clears if k is not None]
    return {
        "episodes": len(episodes), "max_pulls": max_pulls,
        # Clears are timed clears. Pulls-to-clear is only defined for episodes
        # that cleared (the rest are censored), so it's reported with the count.
        "kill_rate": round(len(cleared_eps) / len(episodes), 3),
        "pulls_to_kill": clears,
        "pulls_to_kill_mean": round(st.mean(cleared_eps), 2) if cleared_eps else None,
        "first_pull_score_mean": round(st.mean(firsts), 1), "first_pull_score_ci95": ci95(firsts),
        "best_score_mean": round(st.mean(bests), 1),
        # Progression score (0-100): mean pull score over the whole episode, a
        # timed clear carrying forward, so learning faster scores higher.
        "progression_score_mean": round(st.mean(prog), 1), "progression_score_ci95": ci95(prog),
        "progression_scores": [round(x, 2) for x in prog],
        "curve_mean": [round(st.mean(c[k] for c in curves), 1) for k in range(max_pulls)],
        # Leaderboard-compatible fields (the run browser shows these).
        "score_mean": round(st.mean(prog), 1),
        "win_rate": round(len(cleared_eps) / len(episodes), 3),
    }
