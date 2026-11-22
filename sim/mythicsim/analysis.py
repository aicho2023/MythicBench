"""Analysis export: runs or a results dataset -> small, flat files.

The replays hold everything (every event, every prompt and reply, the
debriefs, the talk, the notes), but they're large, nested JSON. This turns
them into files that are quick to read, load into a spreadsheet or pandas,
or hand to an LLM:

    overview.md         every cell at a glance, and how each one changes pull by pull
    pulls.csv           one row per pull: result, mechanics, deaths, reply problems, cost
    groups.csv          one row per group: its pulls' scores, its group score, when it cleared
    deaths.csv          one row per player death, with what hit them in their last 5 s
    mechanics.csv       one row per mechanic attempt: each kick-able cast, Bone Pyre, Grave Mark
    damage_taken.csv    damage taken per pull, player and ability
    calls.jsonl         every in-fight model call: when, who, why, the reply, the thinking, tokens
    between_pulls.jsonl each pull's debrief, the talk after it, and the notes before and after
    groups/<cell>/<role>-g<N>.md   one group's story, pull by pull: timeline, debrief, talk, notes

Read-only: nothing here changes a run, a replay or a score, so it can keep
improving after the freeze.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

PULL_COLS = ["model", "provider", "effort", "tier", "role", "memory", "group", "pull", "seed", "run_id",
             "outcome", "in_time", "score", "progress_pct", "boss_hp_left_pct", "duration_s", "penalty_s",
             "revives", "deaths", "first_death_s", "first_death", "pack1_cleared_s", "pack2_cleared_s",
             "boss_pulled_s", "boss_kicks", "boss_kickable", "trash_kicks", "trash_kickable", "pyres",
             "pyres_soaked", "pyre_mean_inside", "marks", "mark_allies_hit", "avoidable_damage", "party_dps",
             "healing", "chat_lines", "calls", "input_tokens", "output_tokens", "usd", "refusals",
             "unusable_replies", "truncated_replies", "api_errors", "out_of_calls"]
KEY_COLS = ["model", "effort", "tier", "role", "memory", "group", "pull"]
GROUP_COLS = ["model", "provider", "effort", "tier", "role", "memory", "group", "run_id", "pulls_played",
              "cleared_on", "group_score", "first_score", "best_score", "last_score", "scores", "usd"]
DEATH_COLS = KEY_COLS + ["t_s", "unit", "player_role", "ability", "killer", "last_5s"]
MECH_COLS = KEY_COLS + ["t_s", "mechanic", "caster", "ok", "detail"]
DMG_COLS = KEY_COLS + ["unit", "ability", "amount", "hits"]
# role: ranked (the leaderboard's groups), paired (extra memory-on groups for the
# learning effect), control (memory off), sanity (Normal), effort (a sweep),
# baseline (the scripted commander); from local run folders: campaign (a
# campaign's run) or run (any other run).
ROLE_ORDER = ["ranked", "paired", "control", "sanity", "effort", "baseline", "campaign", "run"]


# ---------------------------------------------------------------------------
# Finding the pulls
# ---------------------------------------------------------------------------

def _load(p: Path) -> dict:
    b = p.read_bytes()
    return json.loads(gzip.decompress(b) if p.name.endswith(".gz") else b)


def from_results(folder: Path) -> tuple[list[dict], int]:
    """Every pull in a published results folder (``leaderboard.json`` + replays)."""
    from .campaign import _inside
    folder = Path(folder)
    board = json.loads((folder / "leaderboard.json").read_text())
    max_pulls = board["protocol"]["max_pulls"]
    efforts = {r["model"]: r.get("effort") for r in board["leaderboard"] + board.get("baselines", [])}
    providers = {r["model"]: r.get("provider") for r in board["leaderboard"] + board.get("baselines", [])}
    refs: list[dict] = []

    def add(cell: dict, base: dict) -> None:
        lists = [("episode_list", base["role"])]
        if cell.get("paired_episode_list"):
            lists.append(("paired_episode_list", "paired"))
        for key, role in lists:
            for ep in cell.get(key) or []:
                for pl in ep["pulls"]:
                    stats = pl.get("stats") or {}
                    refs.append({**base, "role": role, "group": ep["episode"], "pull": pl["pull"],
                                 "run_id": ep.get("run_id", ""), "path": _inside(folder, folder / pl["file"]),
                                 "stats": {**stats, "usd": pl.get("usd", stats.get("usd"))}})

    for row in board["leaderboard"]:
        for tier, cell in row["tiers"].items():
            add(cell, {"model": row["model"], "provider": row["provider"], "effort": row.get("effort"),
                       "tier": tier, "memory": True, "role": "sanity" if cell.get("sanity") else "ranked"})
    for row in board.get("baselines", []):
        for tier, cell in row["tiers"].items():
            add(cell, {"model": row["model"], "provider": row["provider"], "effort": row.get("effort"),
                       "tier": tier, "memory": True, "role": "baseline"})
    for ctl in board.get("controls", []):
        add(ctl, {"model": ctl["model"], "provider": providers.get(ctl["model"]),
                  "effort": efforts.get(ctl["model"]), "tier": ctl["tier"], "memory": False, "role": "control"})
    for cfg in board.get("configs", []):
        for tier, cell in cfg["tiers"].items():
            add(cell, {"model": cfg["model"], "provider": cfg["provider"], "effort": cfg["effort"], "tier": tier,
                       "memory": True, "role": "effort"})
    return refs, max_pulls


def from_runs(runs_dir: Path, select: list[str] | None = None, tag: str | None = None) -> tuple[list[dict], int]:
    """Every pull in local run folders (optionally only some runs: id prefixes or a tag)."""
    from .runs import load_manifests
    refs: list[dict] = []
    max_pulls = 1
    for m in load_manifests(runs_dir):
        if select and not any(m["run_id"].startswith(s) or s in m["run_id"] for s in select):
            continue
        if tag and tag not in (m.get("tags") or []):
            continue
        run = Path(runs_dir) / m["run_id"]
        max_pulls = max(max_pulls, m.get("max_pulls") or 1)
        role = "campaign" if m.get("campaign") else "run"  # a results folder knows the finer roles
        for ep in m.get("episodes") or []:
            ep_file = run / "episodes" / str(ep) / "episode.json"
            if not ep_file.exists():
                continue
            for it in json.loads(ep_file.read_text()).get("items", []):
                src = run / it["file"]
                stats_p = src.with_name(src.stem + ".stats.json")
                refs.append({"model": m.get("model"), "provider": m.get("provider"), "effort": m.get("effort"),
                             "tier": m.get("tier"), "memory": m.get("memory", True), "role": role,
                             "group": ep, "pull": it["pull"], "run_id": m["run_id"], "path": src,
                             "stats": json.loads(stats_p.read_text()) if stats_p.exists() else {}})
    return refs, max_pulls


def _sort_key(r: dict) -> tuple:
    return (str(r["model"]), str(r["effort"]), str(r["tier"]), ROLE_ORDER.index(r["role"]) if r["role"] in ROLE_ORDER
            else 99, r["run_id"], r["group"], r["pull"])


# ---------------------------------------------------------------------------
# One pull
# ---------------------------------------------------------------------------

def _js(v):
    """Numbers written the way JavaScript writes them (27, not 27.0), so this
    export and the website's (web/src/site/exportRuns.ts) give identical files."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, dict):
        return {k: _js(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_js(x) for x in v]
    return v


def _s(ms) -> float | None:
    return None if ms is None else round(ms / 1000, 1)


def _clock(ms: int) -> str:
    return f"{ms // 60000}:{ms % 60000 / 1000:04.1f}"


class Pull:
    """One replay, read once: the facts every output file needs."""

    def __init__(self, ref: dict, rep: dict):
        self.ref, self.rep = ref, rep
        meta = rep["meta"]
        if meta.get("metrics"):
            self.m = meta["metrics"]
        else:
            from .metrics import score
            self.m = score(rep)
        self.meta = meta
        self.units = {u["id"]: u for u in rep.get("units", [])}
        self.events = rep.get("events", [])
        for e in self.events:
            if e["type"] == "spawn" and isinstance(e.get("unit"), dict):
                self.units.setdefault(e["unit"]["id"], e["unit"])
        self.abil = rep.get("abilities", {})
        self.players = [u for u, x in self.units.items() if x.get("kind") == "player"]
        self.boss = next((e.get("boss") for e in self.events if e["type"] == "encounter_start"), None)
        self.packs = {p["id"]: p["name"] for p in (rep.get("arena") or {}).get("packs", [])}
        self._mechanics()

    def name(self, uid) -> str:
        return (self.units.get(uid) or {}).get("name", str(uid))

    def ability(self, aid) -> str:
        return (self.abil.get(aid) or {}).get("name", str(aid))

    def _mechanics(self) -> None:
        """Every kick-able enemy cast (kicked or not), Bone Pyre and Grave Mark, in order."""
        out, pending, marked = [], {}, {}
        mark_hits: dict[int, list[str]] = defaultdict(list)
        for e in self.events:
            t, ty = e["t"], e["type"]
            unit = e.get("unit")
            if ty == "cast_start" and unit not in self.players and e.get("interruptible"):
                pending[unit] = e
            elif ty == "cast_interrupted" and unit in pending:
                s = pending.pop(unit)
                out.append({"t": s["t"], "mechanic": "kick", "caster": unit, "ability": s["ability"],
                            "ok": e.get("reason") == "interrupt", "by": e.get("by"),
                            "detail": f"{self.ability(s['ability'])}"
                                      + (f", kicked by {self.name(e.get('by'))}" if e.get("by") else
                                         f", stopped ({e.get('reason')})")})
            elif ty == "cast_success" and unit in pending and pending[unit]["ability"] == e.get("ability"):
                s = pending.pop(unit)
                out.append({"t": s["t"], "mechanic": "kick", "caster": unit, "ability": s["ability"], "ok": False,
                            "by": None, "detail": f"{self.ability(s['ability'])}, not kicked"})
            elif ty == "death" and unit in pending:
                pending.pop(unit)  # died mid-cast: neither a kick nor a miss
            elif ty == "pyre_detonate":
                inside = e.get("inside") or []
                out.append({"t": t, "mechanic": "bone_pyre", "caster": self.boss, "ok": bool(e.get("soaked")),
                            "inside": inside, "detail": (f"{len(inside)} inside: "
                                                         + ", ".join(self.name(u) for u in inside)) if inside
                            else "nobody inside"})
            elif ty == "aura_apply" and e.get("aura") == "grave_mark":
                marked[t + (e.get("duration_ms") or 0)] = unit
            elif ty == "damage" and e.get("ability") == "grave_mark" and e.get("target") in self.players:
                mark_hits[t].append(e["target"])
        for t, hit in mark_hits.items():
            who = marked.get(t) or next((u for tt, u in marked.items() if abs(tt - t) <= 200), None)
            others = [u for u in hit if u != who]
            out.append({"t": t, "mechanic": "grave_mark", "caster": self.boss, "ok": not others, "marked": who,
                        "hit": others, "detail": f"on {self.name(who)}" + (
                            f", also hit {', '.join(self.name(u) for u in others)}" if others else ", nobody else hit")})
        self.mech = sorted(out, key=lambda x: (x["t"], x["mechanic"]))

    def key(self) -> dict:
        r = self.ref
        return {"model": r["model"], "effort": r["effort"], "tier": r["tier"], "role": r["role"],
                "memory": r["memory"], "group": r["group"], "pull": r["pull"]}

    def deaths(self) -> list[dict]:
        rows = []
        for e in self.events:
            if e["type"] != "death" or e.get("unit") not in self.players:
                continue
            t, u = e["t"], e["unit"]
            hits = Counter()
            for d in self.events:
                if d["type"] == "damage" and d.get("target") == u and t - 5000 < d["t"] <= t:
                    hits[d.get("ability")] += d.get("amount", 0) + d.get("absorbed", 0)
            rows.append({**self.key(), "t_s": _s(t), "unit": u, "player_role": self.units[u].get("role"),
                         "ability": e.get("ability"), "killer": e.get("killer"),
                         "last_5s": "; ".join(f"{self.ability(a)} {n}" for a, n in hits.most_common())})
        return rows

    def damage_taken(self) -> list[dict]:
        tot: dict[tuple, list[int]] = defaultdict(lambda: [0, 0])
        for d in self.events:
            if d["type"] == "damage" and d.get("target") in self.players:
                x = tot[(d["target"], d.get("ability"))]
                x[0] += d.get("amount", 0) + d.get("absorbed", 0)
                x[1] += 1
        return [{**self.key(), "unit": u, "ability": a, "amount": n, "hits": h}
                for (u, a), (n, h) in sorted(tot.items(), key=lambda kv: (kv[0][0], -kv[1][0]))]

    def row(self) -> dict:
        m, st, ev = self.m, self.ref.get("stats") or {}, self.events
        first = next((e for e in ev if e["type"] == "death" and e.get("unit") in self.players), None)
        cleared = {e["pack"]: e["t"] for e in ev if e["type"] == "pack_cleared"}
        boss_pull = next((e["t"] for e in ev if e["type"] == "pull" and e.get("pack") == "boss"),
                         self.meta.get("boss_engaged_ms"))
        kicks = [x for x in self.mech if x["mechanic"] == "kick"]
        bk = [x for x in kicks if x["caster"] == self.boss]
        tk = [x for x in kicks if x["caster"] != self.boss]
        pyres = [x for x in self.mech if x["mechanic"] == "bone_pyre"]
        marks = [x for x in self.mech if x["mechanic"] == "grave_mark"]
        dps = m.get("dps") or {}
        return {
            **{k: self.ref.get(k) for k in ("model", "provider", "effort", "tier", "role", "memory", "group", "pull",
                                            "run_id")},
            "seed": self.meta.get("seed"), "outcome": m.get("outcome"), "in_time": m.get("in_time"),
            "score": m.get("score"), "progress_pct": m.get("progress_pct"),
            "boss_hp_left_pct": m.get("boss_hp_pct_remaining"), "duration_s": m.get("duration_s"),
            "penalty_s": m.get("penalty_s"), "revives": m.get("revives"), "deaths": len(m.get("deaths") or []),
            "first_death_s": _s(first["t"]) if first else None,
            "first_death": f"{first['unit']}: {first.get('ability')}" if first else "",
            "pack1_cleared_s": _s(cleared.get("pack1")), "pack2_cleared_s": _s(cleared.get("pack2")),
            "boss_pulled_s": _s(boss_pull),
            "boss_kicks": sum(x["ok"] for x in bk), "boss_kickable": len(bk),
            "trash_kicks": sum(x["ok"] for x in tk), "trash_kickable": len(tk),
            "pyres": len(pyres), "pyres_soaked": sum(x["ok"] for x in pyres),
            "pyre_mean_inside": round(sum(len(x["inside"]) for x in pyres) / len(pyres), 2) if pyres else None,
            "marks": len(marks), "mark_allies_hit": sum(len(x["hit"]) for x in marks),
            "avoidable_damage": sum((m.get("avoidable_damage_taken") or {}).values()),
            "party_dps": sum(dps.values()) if dps else None,
            "healing": sum((m.get("healing_done") or {}).values()) or None,
            "chat_lines": sum(1 for e in ev if e["type"] == "chat"),
            "calls": st.get("calls", len(self.rep.get("calls") or [])), "input_tokens": st.get("input_tokens"),
            "output_tokens": st.get("output_tokens"), "usd": st.get("usd"), "refusals": st.get("refusals"),
            "unusable_replies": st.get("unusable_replies"), "truncated_replies": st.get("truncated_replies"),
            "api_errors": st.get("api_errors"),
            "out_of_calls": st.get("budget_exhausted"),
        }

    def mechanic_rows(self) -> list[dict]:
        return [{**self.key(), "t_s": _s(x["t"]), "mechanic": x["mechanic"], "caster": x["caster"], "ok": x["ok"],
                 "detail": x["detail"]} for x in self.mech]

    def calls(self, prompts: bool) -> list[dict]:
        out = []
        for c in self.rep.get("calls") or []:
            row = {**self.key(), "t_s": _s(c.get("t")), "agent": c.get("agent"), "why": c.get("why"),
                   "reply": c.get("reply"), "thinking": c.get("thinking") or "",
                   "input_tokens": c.get("input_tokens"), "output_tokens": c.get("output_tokens")}
            if prompts:
                row["prompt"] = c.get("prompt")
            out.append(row)
        return out

    def between(self) -> dict | None:
        p = self.meta.get("progress")
        if not p:
            return None
        return {**self.key(), "debrief": p.get("debrief", ""), "talk": p.get("talk") or [],
                "notes_before": p.get("notes_before") or {}, "notes_after": p.get("notes_after") or {}}

    # -- the story -------------------------------------------------------

    def timeline(self) -> list[str]:
        """The fight as a few dozen readable lines: chat, pulls, Oruth's casts and
        their outcomes, soaks, marks, deaths. No damage numbers."""
        lines: list[tuple[int, str]] = []
        mech_at = {(x["t"], x["caster"]) for x in self.mech if x["mechanic"] == "kick"}
        for e in self.events:
            t, ty, u = e["t"], e["type"], e.get("unit")
            if ty == "chat":
                lines.append((t, f"{self.name(u)}: \"{e.get('text', '')}\""))
            elif ty == "pull":
                what = self.name(self.boss) if e.get("pack") == "boss" else self.packs.get(e.get("pack"), e.get("pack"))
                lines.append((t, f"{self.name(e.get('by'))} pulls {what}"))
            elif ty == "pack_cleared":
                lines.append((t, f"{self.packs.get(e.get('pack'), e.get('pack'))} cleared"))
            elif ty in ("cast_start", "cast_success") and u == self.boss:
                a = e.get("ability")
                if a in ("hollow_strike", "auto_attack") or (ty == "cast_success" and (self.abil.get(a) or {}).get(
                        "cast_ms")):
                    continue  # melee swings, and the end of a cast bar already shown
                if (t, u) in mech_at:
                    continue  # shown with its kick result below
                tgt = e.get("target")
                lines.append((t, f"{self.name(u)}: {self.ability(a)}" + (f" on {self.name(tgt)}" if tgt else "")))
            elif ty == "death" and u in self.players:
                lines.append((t, f"DEATH {self.name(u)} ({self.ability(e.get('ability'))})"))
            elif ty == "revive":
                lines.append((t, f"{self.name(u)} revived (+{_js(_s(e.get('penalty_ms', 0)))} s on the timer)"))
            elif ty == "spawn" and isinstance(u, dict) and u.get("kind") == "add":
                lines.append((t, f"add rises: {u.get('name')}"))
            elif ty == "encounter_end":
                lines.append((t, f"END: {e.get('outcome')}"))
        for x in self.mech:
            caster = self.name(x["caster"])
            if x["mechanic"] == "kick":
                if x["caster"] != self.boss and x["ok"]:
                    continue  # trash kicks that landed are routine; misses are worth seeing
                lines.append((x["t"], f"{caster}: {x['detail']}"))
            elif x["mechanic"] == "bone_pyre":
                lines.append((x["t"], f"Bone Pyre goes off: {x['detail']} -> "
                                      + ("soaked" if x["ok"] else "NOT soaked, whole party hit")))
            else:
                lines.append((x["t"], f"Grave Mark {x['detail']}"))
        # Adds spawn together: one line per wave.
        out, last = [], None
        for t, s in sorted(lines, key=lambda x: x[0]):
            if s.startswith("add rises") and last == (t, s):
                continue
            last = (t, s)
            out.append(f"{_clock(t)} {s}")
        return out


# ---------------------------------------------------------------------------
# The files
# ---------------------------------------------------------------------------

def _cell(r: dict) -> str:
    return f"{r['model']}@{r['effort']}_{r['tier']}" if r.get("effort") else f"{r['model']}_{r['tier']}"


def _csv(rows: list[dict], cols: list[str]) -> str:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if r.get(k) is None else _js(r[k])) for k in cols})
    return buf.getvalue()


def _group_story(pulls: list[Pull], group_row: dict) -> str:
    r = pulls[0].ref
    head = (f"# {r['model']}" + (f" @ {r['effort']}" if r.get("effort") else "") + f", {r['tier']}, "
            f"{r['role']} group {r['group']}" + ("" if r["memory"] else " (memory off)"))
    out = [head, "",
           f"Group score {_js(group_row['group_score'])}; pull scores {group_row['scores']}; "
           + (f"cleared on pull {group_row['cleared_on']}." if group_row["cleared_on"] else "no clear."), ""]
    for p in pulls:
        m = p.m
        out += [f"## Pull {p.ref['pull']}: {m.get('outcome')} at {_js(m.get('duration_s'))} s, score {_js(m.get('score'))}, "
                f"{p.name(p.boss)} at {_js(m.get('boss_hp_pct_remaining'))}% (seed {p.meta.get('seed')})", "",
                "### The fight", "", "```", *p.timeline(), "```", ""]
        b = p.between()
        if not b:
            continue
        if any(b["notes_before"].values()):
            out += ["### Notes going in", ""]
            out += [f"- **{p.name(u)}**: {n}" for u, n in b["notes_before"].items() if n] + [""]
        if b["debrief"]:
            out += ["### The debrief the party read after it", "", "```", b["debrief"], "```", ""]
        said = [x for x in b["talk"] if x.get("message")]
        if said:
            out += ["### The talk", ""]
            out += [f"- r{x.get('round')} **{p.name(x['agent'])}**{' (ready)' if x.get('ready') else ''}: "
                    f"{x['message']}" for x in said] + [""]
    return "\n".join(out) + "\n"


def _by_pull_table(rows: list[dict], max_pulls: int) -> list[str]:
    """For one cell: averages by pull number, the quickest way to see what was learned."""
    out = ["| pull | groups | score | deaths | boss kicks | trash kicks | pyres soaked | mark hit allies | "
           "avoidable dmg |", "|---|---|---|---|---|---|---|---|---|"]

    def pct(a, b):  # the nearest whole percent, a half rounding up (integer math, the same in the browser)
        return f"{a}/{b} ({(200 * a + b) // (2 * b)}%)" if b else "-"

    for k in range(1, max_pulls + 1):
        rs = [r for r in rows if r["pull"] == k]
        if not rs:
            continue
        n = len(rs)
        out.append(f"| {k} | {n} | {sum(r['score'] or 0 for r in rs) / n:.1f} | {sum(r['deaths'] for r in rs) / n:.1f} | "
                   f"{pct(sum(r['boss_kicks'] for r in rs), sum(r['boss_kickable'] for r in rs))} | "
                   f"{pct(sum(r['trash_kicks'] for r in rs), sum(r['trash_kickable'] for r in rs))} | "
                   f"{pct(sum(r['pyres_soaked'] for r in rs), sum(r['pyres'] for r in rs))} | "
                   f"{sum(r['mark_allies_hit'] for r in rs) / n:.1f} | "
                   f"{sum(r['avoidable_damage'] for r in rs) / n:,.0f} |")
    return out


def _overview(source: str, pull_rows: list[dict], group_rows: list[dict], death_rows: list[dict],
              max_pulls: int) -> str:
    cells: dict[tuple, dict] = {}
    for g in group_rows:
        c = cells.setdefault((g["model"], g["effort"], g["tier"], g["role"], g["memory"]), {"groups": []})
        c["groups"].append(g)
    out = [f"# MythicBench analysis: {source}", "",
           f"{len(pull_rows)} pulls in {len(group_rows)} groups. Up to {max_pulls} pulls per group. "
           "Roles: ranked = the leaderboard's groups, paired = extra memory-on groups for the learning effect, "
           "control = memory off, sanity = Normal, effort = an effort sweep, baseline = the scripted commander; "
           "from local run folders, campaign = a campaign's run and run = any other run.", "",
           "## Cells", "",
           "| model | effort | tier | role | memory | groups | mean group score | clears | mean pulls to clear | "
           "$ / group | reply problems / calls |", "|---|---|---|---|---|---|---|---|---|---|---|"]
    for (model, effort, tier, role, mem), c in sorted(cells.items(), key=lambda kv: (
            str(kv[0][0]), str(kv[0][1]), str(kv[0][2]), ROLE_ORDER.index(kv[0][3]) if kv[0][3] in ROLE_ORDER else 99)):
        gs = c["groups"]
        clears = [g["cleared_on"] for g in gs if g["cleared_on"]]
        usd = [g["usd"] for g in gs if g["usd"] is not None]
        prs = [r for r in pull_rows if (r["model"], r["effort"], r["tier"], r["role"], r["memory"]) ==
               (model, effort, tier, role, mem)]
        probs = sum((r["refusals"] or 0) + (r["unusable_replies"] or 0) for r in prs)
        calls = sum(r["calls"] or 0 for r in prs)
        cells_ = [model, effort or "-", tier, role, "on" if mem else "off", len(gs),
                  f"{sum(g['group_score'] for g in gs) / len(gs):.1f}", f"{len(clears)}/{len(gs)}",
                  f"{sum(clears) / len(clears):.1f}" if clears else "-",
                  f"{sum(usd) / len(usd):.2f}" if usd else "-", f"{probs}/{calls}"]
        out.append("| " + " | ".join(str(x) for x in cells_) + " |")
    out += ["", "## Pull by pull", "",
            "Averages over each cell's groups, by pull number. A group that cleared stops, so later pulls "
            "can have fewer groups.", ""]
    for key in sorted(cells, key=lambda k: (str(k[0]), str(k[1]), str(k[2]),
                                            ROLE_ORDER.index(k[3]) if k[3] in ROLE_ORDER else 99)):
        model, effort, tier, role, mem = key
        rows = [r for r in pull_rows if (r["model"], r["effort"], r["tier"], r["role"], r["memory"]) == key]
        out += [f"### {model}" + (f" @ {effort}" if effort else "") + f", {tier}, {role}"
                + ("" if mem else ", memory off"), "", *_by_pull_table(rows, max_pulls), ""]
        ds = [d for d in death_rows if (d["model"], d["effort"], d["tier"], d["role"], d["memory"]) == key]
        if ds:
            top = Counter(d["ability"] for d in ds).most_common(5)
            out += ["Killing blows: " + ", ".join(f"{a} {n}" for a, n in top) + f" ({len(ds)} deaths)", ""]
    return "\n".join(out) + "\n"


README = """# MythicBench analysis export

Made by `python -m mythicsim export` or the website's Export button (the same
files). Every number here is computed from the replays; nothing is new data.
Start with `overview.md`.

| file | one row per |
| --- | --- |
| overview.md | cell (model x effort x tier x role): scores, clears, cost; then averages by pull number |
| pulls.csv | pull |
| groups.csv | group (up to {max_pulls} pulls; ends at its first timed clear) |
| deaths.csv | player death, with the damage they took in their last 5 s |
| mechanics.csv | mechanic attempt: each kick-able enemy cast (ok = kicked), Bone Pyre (ok = soaked), Grave Mark (ok = nobody else hit) |
| damage_taken.csv | pull x player x ability |
| calls.jsonl | in-fight model call: time, agent, why it was asked, its reply and thinking, tokens{prompts} |
| between_pulls.jsonl | pull: the debrief read after it, the talk, and each agent's notes before and after |
| groups/<cell>/<role>-g<N>.md | group: its story, pull by pull |

Columns that need a word:

- `role`: ranked (the leaderboard's groups), paired (extra memory-on groups for
  the learning effect), control (memory off), sanity (Normal), effort (an effort
  sweep), baseline (the scripted commander). Exported from local run folders
  instead: campaign (a campaign's run) or run (any other run); `memory` and
  `effort` still tell the conditions apart.
- `score` is the pull score (0-100); `group_score` is the mean over {max_pulls} pulls
  with a clear carried forward (the MythicBench score is the mean of these).
- `boss_kicks / boss_kickable`: Oruth's kick-able casts that were kicked, of those started.
- `pyres_soaked / pyres`: Bone Pyres with 2+ players inside when they went off.
- `mark_allies_hit`: allies caught by a Grave Mark's blast (0 is perfect).
- `usd` is at list prices, thinking included.

To ask an LLM about it: send `overview.md` first, then the group stories you
care about (`groups/...`), and the CSVs for anything numeric.
"""


def export(refs: list[dict], max_pulls: int, out: Path, source: str, prompts: bool = False,
           make_zip: bool = False) -> dict:
    """Write the analysis files for ``refs`` into ``out``. Deterministic."""
    from .campaign import _episode_scores
    out = Path(out)
    refs = sorted(refs, key=_sort_key)
    pull_rows, death_rows, mech_rows, dmg_rows, calls, between = [], [], [], [], [], []
    groups: dict[tuple, list[Pull]] = defaultdict(list)
    files: dict[str, str] = {}
    for ref in refs:
        p = Pull(ref, _load(ref["path"]))
        pull_rows.append(p.row())
        death_rows += p.deaths()
        mech_rows += p.mechanic_rows()
        dmg_rows += p.damage_taken()
        calls += p.calls(prompts)
        b = p.between()
        if b:
            between.append(b)
        groups[(ref["model"], ref["effort"], ref["tier"], ref["role"], ref["memory"], ref["run_id"], ref["group"])
               ].append(p)
        p.rep = None  # the replay itself is no longer needed: keep memory flat
    group_rows = []
    for key, ps in groups.items():
        ps.sort(key=lambda p: p.ref["pull"])
        items = [{"pull": p.ref["pull"], "score": p.m.get("score") or 0.0, "outcome": p.m.get("outcome")} for p in ps]
        cleared = next((p.ref["pull"] for p in ps if p.m.get("in_time")), None)
        usd = [p.ref["stats"].get("usd") for p in ps]
        r = ps[0].ref
        g = {**{k: r.get(k) for k in ("model", "provider", "effort", "tier", "role", "memory", "group", "run_id")},
             "pulls_played": len(ps), "cleared_on": cleared,
             "group_score": round(_episode_scores(items, max_pulls), 2),
             "first_score": items[0]["score"], "best_score": max(i["score"] for i in items),
             "last_score": items[-1]["score"], "scores": " ".join(f"{i['score']:.1f}" for i in items),
             "usd": round(sum(u for u in usd if u is not None), 4) if any(u is not None for u in usd) else None}
        group_rows.append(g)
        local = f"-{r['run_id'][-4:]}" if r["role"] in ("run", "campaign") else ""  # group numbers repeat across runs
        name = f"groups/{_cell(r)}/{r['role']}{'' if r['memory'] else '-off'}{local}-g{r['group']}"
        files[name + ".md"] = _group_story(ps, g)
    files["README.md"] = README.format(max_pulls=max_pulls, prompts=" (and the full prompt)" if prompts else
                                       " (prompts left out; the command line's `--prompts` adds them)")
    files["overview.md"] = _overview(source, pull_rows, group_rows, death_rows, max_pulls)
    files["pulls.csv"] = _csv(pull_rows, PULL_COLS)
    files["groups.csv"] = _csv(group_rows, GROUP_COLS)
    files["deaths.csv"] = _csv(death_rows, DEATH_COLS)
    files["mechanics.csv"] = _csv(mech_rows, MECH_COLS)
    files["damage_taken.csv"] = _csv(dmg_rows, DMG_COLS)
    files["calls.jsonl"] = "".join(json.dumps(_js(c), ensure_ascii=False, separators=(",", ":")) + "\n" for c in calls)
    files["between_pulls.jsonl"] = "".join(json.dumps(_js(b), ensure_ascii=False, separators=(",", ":")) + "\n"
                                           for b in between)
    if out.exists():
        import shutil
        shutil.rmtree(out)  # a fresh export: no stale group files from an earlier one
    for rel, text in files.items():
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(text)
    if make_zip:
        zpath = out.with_suffix(".zip")
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for rel in sorted(files):
                info = zipfile.ZipInfo(f"{out.name}/{rel}", date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, files[rel])
    return {"pulls": len(pull_rows), "groups": len(group_rows), "files": len(files), "out": str(out)}
