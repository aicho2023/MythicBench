"""The LLM party brain.

One model controls all five characters (like one player multiboxing). The
engine asks each character's policy for actions every 100 ms tick; calling a
model that often is impossible, so the brain only calls it:

* every ``interval_ms`` of game time, and
* immediately when something important happens (a boss cast starts, pools
  appear, adds spawn, an ally gets low or dies).

The simulation runs synchronously, so the game is effectively paused while
the model thinks: slow models aren't penalised for latency, and runs stay
reproducible from the recorded replies.

Between calls each character follows its latest standing orders (a move and
a priority list), checked against the same rules the engine enforces.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import content as C
from ..engine import Action, dist
from .clients import ChatClient, ClientError
from .prompt import Order, parse_reply, render_state, system_prompt

PLAYER_RADIUS = 0.45
LOW_HP_PCT = 40.0


@dataclass
class BrainStats:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0  # part of input_tokens the provider served from its prompt cache
    latency_s: float = 0.0
    cached_calls: int = 0
    unusable_replies: int = 0  # not JSON / no orders: the party keeps its old orders
    invalid_entries: int = 0  # unknown abilities/targets etc. that we dropped
    api_errors: int = 0
    budget_exhausted: bool = False
    triggers: dict[str, int] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)  # first few, for debugging

    def as_dict(self) -> dict:
        d = dict(self.__dict__)
        d["problems"] = self.problems[:20]
        d["latency_s"] = round(self.latency_s, 2)
        return d


@dataclass
class Standing:
    order: Order
    issued_t: int
    move_done: bool = False
    said: bool = False


class PartyBrain:
    def __init__(self, client: ChatClient, interval_ms: int = 2000, min_gap_ms: int = 500,
                 max_calls: int = 300):
        self.client = client
        self.interval_ms = interval_ms
        self.min_gap_ms = min_gap_ms
        self.max_calls = max_calls
        self.system = system_prompt()
        self.orders: dict[str, Standing] = {}
        self.gcd: dict[str, int] = {}
        self.stats = BrainStats()
        self.last_call_t: int | None = None
        self.last_tick = -1
        # What we had already told the model about, to detect new events.
        self.seen_casts: set[str] = set()
        self.seen_ground: set[str] = set()
        self.seen_enemies: set[str] = set()
        self.low: set[str] = set()
        self.dead: set[str] = set()

    # ------------------------------------------------------------------
    def triggers(self, obs: dict) -> list[str]:
        why: list[str] = []
        for e in obs["enemies"]:
            c = e["casting"]
            if c:
                key = f"{e['id']}:{obs['t'] - c['elapsed_ms']}"
                if key not in self.seen_casts:
                    why.append(f"{e['id']} started casting {c['ability']}")
        new_pools = [g["id"] for g in obs["ground"] if g["id"] not in self.seen_ground]
        if new_pools:
            why.append(f"new pools: {', '.join(new_pools)}")
        new_adds = [e["id"] for e in obs["enemies"] if e["role"] == "add" and e["id"] not in self.seen_enemies]
        if new_adds:
            why.append(f"adds appeared: {', '.join(new_adds)}")
        for p in obs["party"]:
            if not p["alive"] and p["id"] not in self.dead:
                why.append(f"{p['id']} died")
            elif p["alive"] and p["hp_pct"] < LOW_HP_PCT and p["id"] not in self.low:
                why.append(f"{p['id']} is low ({p['hp_pct']:.0f}%)")
        return why

    def remember(self, obs: dict) -> None:
        for e in obs["enemies"]:
            self.seen_enemies.add(e["id"])
            if e["casting"]:
                self.seen_casts.add(f"{e['id']}:{obs['t'] - e['casting']['elapsed_ms']}")
        self.seen_ground |= {g["id"] for g in obs["ground"]}
        self.low = {p["id"] for p in obs["party"] if p["alive"] and p["hp_pct"] < LOW_HP_PCT}
        self.dead = {p["id"] for p in obs["party"] if not p["alive"]}

    def tick(self, obs: dict) -> None:
        """Called by the first living character each tick; decides whether to ask the model."""
        t = obs["t"]
        if t == self.last_tick:
            return
        self.last_tick = t
        why = self.triggers(obs)
        if self.last_call_t is None:
            why = ["the fight is starting"]
        elif t - self.last_call_t >= self.interval_ms:
            why = why or ["routine check-in"]
        elif not why or t - self.last_call_t < self.min_gap_ms:
            # Urgent: an interruptible cast can't wait for the minimum gap.
            if not any("started casting" in w for w in why):
                return
        if self.stats.calls >= self.max_calls:
            self.stats.budget_exhausted = True
            return
        self.call(obs, why)

    def call(self, obs: dict, why: list[str]) -> None:
        for w in why:
            kind = ("boss_cast" if "started casting" in w else "pools" if w.startswith("new pools")
                    else "adds" if w.startswith("adds") else "death" if w.endswith("died")
                    else "low_hp" if "is low" in w else "start" if "starting" in w else "routine")
            self.stats.triggers[kind] = self.stats.triggers.get(kind, 0) + 1
        age = None if self.last_call_t is None else (obs["t"] - self.last_call_t) / 1000
        user = (render_state(obs, self.gcd, age)
                + "\nCURRENT ORDERS:\n" + self.describe_orders()
                + f"\nWHY YOU ARE BEING ASKED NOW: {'; '.join(why)}.\nReply with the JSON orders.")
        self.last_call_t = obs["t"]
        self.remember(obs)
        self.stats.calls += 1
        try:
            reply = self.client.complete(self.system, user)
        except ClientError as err:
            self.stats.api_errors += 1
            self.note(f"t={obs['t']}: {err}")
            return
        self.stats.input_tokens += reply.input_tokens
        self.stats.output_tokens += reply.output_tokens
        self.stats.cache_read_tokens += reply.cache_read_tokens
        self.stats.latency_s += reply.latency_s
        self.stats.cached_calls += reply.cached
        ids = {u["id"] for u in obs["party"] + obs["enemies"]}
        parsed = parse_reply(reply.text, ids)
        if not parsed.ok:
            self.stats.unusable_replies += 1
        self.stats.invalid_entries += len(parsed.problems)
        for p in parsed.problems:
            self.note(f"t={obs['t']}: {p}")
        for uid, order in parsed.orders.items():
            old = self.orders.get(uid)
            if old and old.order == order:
                continue  # unchanged: keep it (don't re-walk or re-log the same decision)
            self.orders[uid] = Standing(order, obs["t"])

    def note(self, msg: str) -> None:
        if len(self.stats.problems) < 50:
            self.stats.problems.append(msg)

    def describe_orders(self) -> str:
        if not self.orders:
            return "  (none yet)"
        out = []
        for m in C.PARTY:
            s = self.orders.get(m.id)
            if not s:
                out.append(f"  {m.id}: none")
                continue
            mv = f"move_to {s.order.move_to}, " if s.order.move_to and not s.move_done else ""
            pr = ", ".join(f"{a}->{t}" for a, t in s.order.priority) or "nothing"
            out.append(f"  {m.id}: {mv}priority [{pr}]")
        return "\n".join(out)


class LLMPolicy:
    """Per-character adapter: follows the brain's standing orders each tick."""

    def __init__(self, unit_id: str, brain: PartyBrain):
        self.uid = unit_id
        self.brain = brain
        self.name = f"llm:{brain.client.spec}"

    def act(self, obs: dict) -> list[Action]:
        me = obs["self"]
        self.brain.gcd[self.uid] = me.get("gcd_ms", 0)
        if not me["alive"]:
            return []
        self.brain.tick(obs)
        st = self.brain.orders.get(self.uid)
        if not st:
            return []
        out: list[Action] = []
        moving = me["moving"]
        if st.order.move_to and not st.move_done:
            st.move_done = True
            out.append(Action("move", to=st.order.move_to, reason=self.say(st)))
            moving = True
        if me["casting"]:
            return out
        units = {u["id"]: u for u in obs["party"] + obs["enemies"]}
        for ab_id, tgt_id in st.order.priority:
            if self.usable(ab_id, tgt_id, me, units, moving):
                out.append(Action("cast", ab_id, tgt_id, reason=self.say(st)))
                break
        return out

    def say(self, st: Standing) -> str | None:
        if st.said or not st.order.say:
            return None
        st.said = True
        return st.order.say

    def usable(self, ab_id: str, tgt_id: str, me: dict, units: dict, moving: bool) -> bool:
        ab = C.ABILITIES[ab_id]
        if me["cooldowns"].get(ab_id, 1) > 0:
            return False
        if ab.on_gcd and me.get("gcd_ms", 0) > 0:
            return False
        if ab.cast_ms and moving:
            return False
        tgt = units.get(tgt_id)
        if not tgt or not tgt["alive"]:
            return False
        if ab.kind == "interrupt":
            # Standing orders persist, so an interrupt only fires when there is
            # something to interrupt (otherwise it would be wasted instantly).
            if not (tgt["casting"] and tgt["casting"]["interruptible"]):
                return False
        if ab.kind in ("taunt", "buff") or tgt_id == self.uid:
            return True
        radius = C.BOSS.radius if tgt["role"] == "boss" else C.ADD.radius if tgt["role"] == "add" else PLAYER_RADIUS
        return dist(me["pos"], tgt["pos"]) - PLAYER_RADIUS - radius <= ab.range


def make_llm_policies(client: ChatClient, **brain_kwargs) -> tuple[dict[str, LLMPolicy], PartyBrain]:
    brain = PartyBrain(client, **brain_kwargs)
    return {m.id: LLMPolicy(m.id, brain) for m in C.PARTY}, brain
