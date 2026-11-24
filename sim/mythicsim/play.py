"""Play it yourself: a person takes one character's seat; the expert script
plays the other four.

The person plays by the agents' rules. The game pauses whenever that
character's agent would have been asked (every 4 s of game time, and at once
when something concerns it), shows the same state, and takes the same JSON
orders, read by the same parser. Nothing here changes the game or the
harness: the fight is the frozen v1 simulation, and a seat played by the
expert itself gives a byte-identical replay (tests/test_play.py).

How the pause works without threads (so it runs in a browser, in Pyodide):
the engine asks the party for orders at the end of each tick. ``SeatRun``
settles that ask itself, just before the policies act, and if the person is
among those asked it stops the tick there, with nothing yet acted on. The
person's answer resumes the same tick: the asked agents (the person's
included) are answered in party order, exactly as Party.ask does, and the
tick goes on.

Results played here are never mixed with the benchmark's: the seats are
people's, the seeds come from their own range, and the replays say so.
"""

from __future__ import annotations

import json

from . import content as C
from .dungeon import DungeonRun
from .engine import TICK_MS, Encounter
from .llm.clients import Reply
from .llm.debrief import debrief_text
from .llm.expert import ExpertScript
from .llm.policy import PARTY_IDS, LLMPolicy, Party, add_chat_events
from .llm.prompt import CHAT_COOLDOWN_MS, render_state, system_prompt
from .metrics import score

PLAY_VERSION = "1.0.0"
# Seeds for people's games: their own range, far from the benchmark's
# (official, reserve and practice seeds are all below 10 million).
SEED_BASE = 50_000_000


def play_seed(game: int, pull: int) -> int:
    return SEED_BASE + game * 10 + pull


class SeatClient:
    """The expert for every seat but the person's, whose reply is handed in."""

    def __init__(self, seat: str):
        self.seat = seat
        self.expert = ExpertScript()
        self.spec = "play:expert+you"
        self.answer: str | None = None

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        if tag.split("|")[-2:-1] == [self.seat]:
            text, self.answer = self.answer or "{}", None
            return Reply(text, 0, 0, 0.0)
        return self.expert.complete(system, user, tag)


class SeatParty(Party):
    """A Party that stops before answering an ask the person is part of."""

    seat: str
    waiting: tuple[dict, list] | None = None

    def ask(self, obs, asks):
        if self.client.answer is None and any(a.uid == self.seat for a, _ in asks):
            self.waiting = (obs, asks)  # nothing changed yet: Party.ask does all of it on resume
            return
        self.waiting = None
        super().ask(obs, asks)

    def prompt_for(self, obs: dict, why: list[str]) -> str:
        """The text the person's agent would get now (Party.ask builds the same)."""
        a = self.agents[self.seat]
        age = None if a.last_call_t is None else (obs["t"] - a.last_call_t) / 1000
        ready_in = 0 if a.last_said is None else max(0, a.last_said + CHAT_COOLDOWN_MS - obs["t"])
        return (render_state(obs, a.uid, a.gcd, age, self.knowledge, list(self.chat), ready_in)
                + "\nYOUR CURRENT ORDERS:\n" + a.describe_orders()
                + f"\nWHY YOU ARE BEING ASKED NOW: {'; '.join(why)}.\nReply with the JSON orders for {a.uid}.")


class SeatRun(DungeonRun):
    """DungeonRun, with a tick that can stop just before the policies act."""

    def __init__(self, seed, policies, label, tier, party: SeatParty):
        super().__init__(seed, policies, label, tier)
        self.party = party
        self.paused = False

    def run_policies(self) -> None:
        if not self.paused:
            # What LLMPolicy.act does for the first living character, before anyone acts:
            # it sets that agent's GCD and lets the party ask whoever needs asking.
            ps = [p for p in self.players() if p.id in self.policies]
            if ps:
                obs = self.observe(ps[0])
                self.party.agents[ps[0].id].gcd = obs["self"].get("gcd_ms", 0)
                self.party.tick(obs)
                if self.party.waiting:
                    self.paused = True
                    return
        else:
            obs, asks = self.party.waiting
            self.party.ask(obs, asks)  # with the answer in hand, as if never stopped
            self.paused = False
        super().run_policies()  # every agent has been asked this tick: they only follow orders

    def step(self) -> None:
        if self.paused:  # resuming the tick that stopped
            self.run_policies()
            self.rest_tick()
            return
        self.check_aggro()
        Encounter.step(self)
        if not self.paused:
            self.rest_tick()


class Game:
    """One pull, played a decision at a time.

    ``start()`` and ``answer(text)`` play on to the next time the person is
    asked (or to the end) and return what to show, as a dict."""

    def __init__(self, seat: str, seed: int, tier: str = "normal", pull: int = 1):
        if seat not in PARTY_IDS:
            raise ValueError(f"seat must be one of {PARTY_IDS}")
        self.seat, self.seed, self.tier, self.pull = seat, seed, C.TIERS[tier].id, pull
        self.client = SeatClient(seat)
        self.party = SeatParty(self.client, knowledge="blind", pull=pull, tier=self.tier, mode="dungeon",
                               scope=f"play|s{seed}", parallel=False)
        self.party.seat = seat
        policies = {uid: LLMPolicy(uid, self.party) for uid in PARTY_IDS}
        self.run = SeatRun(seed, policies, f"play:{seat}+expert", self.tier, self.party)
        self.sent = 0  # events already handed out
        self.replay: dict | None = None
        self.decisions = 0

    def start(self) -> dict:
        r = self.run
        r.roster = [r.unit_json(u) for u in r.units.values()]
        r.intro()
        return self._play_on()

    def answer(self, text: str) -> dict:
        if not self.run.paused:
            raise RuntimeError("not waiting for an answer")
        self.client.answer = text
        self.decisions += 1
        return self._play_on()

    def _play_on(self) -> dict:
        r = self.run
        while r.outcome is None:
            r.step()
            if r.paused:
                return self._ask()
            if r.cleared():
                r.outcome = "victory"
            elif not r.players():
                r.outcome = "wipe"
            elif r.time_up(r.tier.limit_ms):
                r.outcome = "timeout"
            else:
                r.t += TICK_MS
        return self._end()

    def _new_events(self) -> list[dict]:
        ev = self.run.events[self.sent:]
        self.sent = len(self.run.events)
        return ev

    def _ask(self) -> dict:
        obs, asks = self.party.waiting
        why = next(w for a, w in asks if a.uid == self.seat)
        me = next(p for p in self.run.players() if p.id == self.seat)
        a = self.party.agents[self.seat]
        mine = self.run.observe(me)
        return {"kind": "ask", "t": self.run.t, "why": why, "prompt": self.party.prompt_for(obs, why),
                "obs": mine, "orders": _orders_json(a), "chat": [list(c) for c in self.party.chat],
                "events": self._new_events()}

    def _end(self) -> dict:
        r = self.run
        if r.outcome == "victory":
            r.emit("emote", unit=r.boss.id, style="yell", text="The crown... was never... mine...")
        else:
            r.emit("emote", unit=r.boss.id, style="yell", text="Another party for my eternal court.")
        r.emit("encounter_end", outcome=r.outcome, final_hp={u.id: u.hp for u in r.units.values()})
        events = self._new_events()
        rep = r.to_replay()
        add_chat_events(rep, self.party.chat)
        rep["meta"]["metrics"] = score(rep)
        rep["meta"]["play"] = {"version": PLAY_VERSION, "seat": self.seat, "pull": self.pull,
                               "decisions": self.decisions}
        self.replay = rep
        return {"kind": "end", "events": events, "metrics": rep["meta"]["metrics"], "debrief": debrief_text(rep)}


def _orders_json(a) -> dict | None:
    s = a.orders
    if not s:
        return None
    mv = s.order.move_to if not s.move_done else None
    return {"move_to": list(mv) if isinstance(mv, tuple) else mv,
            "priority": [list(e) for e in s.order.priority or []]}


def rules(seat: str, tier: str = "normal", pull: int = 1) -> str:
    """The rules text the person's agent gets (the system prompt)."""
    return system_prompt("blind", None, pull, C.TIERS[tier].id, "dungeon", seat)


# ---- JSON in, JSON out: the browser's interface (Pyodide) ----------------------

_games: dict[int, Game] = {}


def js_start(seat: str, seed: int, tier: str, pull: int) -> str:
    _games.clear()
    g = Game(seat, int(seed), tier, int(pull))
    _games[0] = g
    out = g.start()
    out["rules"] = rules(seat, tier, int(pull))
    out["replay_head"] = _head(g)
    return json.dumps(out)


def js_answer(text: str) -> str:
    return json.dumps(_games[0].answer(text))


def js_replay() -> str:
    return json.dumps(_games[0].replay)


def _head(g: Game) -> dict:
    """The replay without its events: units, arena, abilities (the viewer needs these first)."""
    rep = g.run.to_replay()
    rep["events"] = []
    return rep


def expert_metrics(seed: int, tier: str = "normal") -> dict:
    """The same pull with the expert in every seat (yours too): what to compare with."""
    from .llm.policy import make_llm_policies
    policies, party = make_llm_policies(ExpertScript(), tier=C.TIERS[tier].id, mode="dungeon", knowledge="blind",
                                        parallel=False)
    rep = DungeonRun(seed, policies, "llm:scripted:expert", C.TIERS[tier].id).run()
    return score(rep)


def js_expert(seed: int, tier: str) -> str:
    return json.dumps(expert_metrics(int(seed), tier))
