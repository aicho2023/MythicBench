"""Checks every quote on the Highlights page against the published replays.

    python3 scripts/check_highlights.py

Each quote in web/src/content/highlights.json must appear word for word (pieces
separated by "…" are checked one by one) in the place it says it comes from:
- chat: a chat line by that character in the pull, within a second of `t`
- thinking: that character's recorded thinking or reply in the pull
- debrief talk / notes: that character's talk or notes in the same group,
  from the debrief before or after the pull
Exits non-zero if any quote is not found.
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPLAYS = ROOT / "web/public/results/v1/replays"
SOURCE = ROOT / "web/src/content/highlights.json"


def load(model: str, tier: str, memory: bool, episode: int, pull: int) -> dict | None:
    folder = REPLAYS / model / tier / ("" if memory else "memory-off")
    f = folder / f"ep{episode}-pull{pull}.json.gz"
    return json.loads(gzip.decompress(f.read_bytes())) if f.exists() else None


def norm(s: str) -> str:
    return " ".join(s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').split())


def texts(h: dict, q: dict) -> list[str]:
    who = q["who"].lower()
    mem = h.get("memory", True)
    here = load(h["model"], h["tier"], mem, h["episode"], h["pull"])
    if here is None:
        raise FileNotFoundError(f"no replay for {h['id']}")
    if q["where"] == "chat":
        t = q.get("t")
        return [e["text"] for e in here["events"] if e["type"] == "chat" and e.get("unit") == who
                and (t is None or abs(e["t"] / 1000 - t) <= 1.0)]
    if q["where"] == "thinking":
        return [c.get(k) or "" for c in here["calls"] if c.get("agent") == who for k in ("thinking", "reply")]
    out: list[str] = []
    for p in (h["pull"] - 1, h["pull"], h["pull"] + 1):
        r = here if p == h["pull"] else load(h["model"], h["tier"], mem, h["episode"], p) if p >= 1 else None
        prog = (r or {}).get("meta", {}).get("progress") or {}
        if q["where"] == "debrief talk":
            out += [m["message"] for m in prog.get("talk", []) if m.get("agent") == who]
        else:
            out += [(prog.get(k) or {}).get(who, "") for k in ("notes_before", "notes_after")]
    return out


def main() -> int:
    items = json.loads(SOURCE.read_text())
    bad = 0
    for h in items:
        for q in h["quotes"]:
            pool = [norm(x) for x in texts(h, q)]
            pieces = [norm(p) for p in q["text"].split("…") if len(p.strip()) > 3]
            ok = any(all(p in x for p in pieces) for x in pool)
            if not ok:
                bad += 1
                print(f"NOT FOUND  {h['id']}  {q['who']} ({q['where']}): {q['text'][:80]}")
    print(f"{sum(len(h['quotes']) for h in items) - bad} quotes found, {bad} not found, in {len(items)} highlights")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
