"""Five LLM agents, one per character.

Each character is played by its own agent (all five are the same model, each
with its own rules text, notes, and conversation). The engine asks each
character's policy for actions every 100 ms tick; calling a model that often is
impossible, so an agent is only called:

* every ``interval_ms`` of game time (a routine check-in), and
* immediately when something that concerns it happens: a cast it could
  interrupt (or any cast that can't be), pools near it, adds, a pack or the
  boss pulled, an ally dying, itself (or, for the healer, anyone) getting low,
  a Grave Mark on or near it, itself standing in a pool.

Agents asked at the same tick are called in parallel and see the same moment;
what they say goes to a party chat that everyone sees from the next call on.

The simulation runs synchronously, so the game is effectively paused while
the agents think: slow models aren't penalised for latency, and runs stay
reproducible from the recorded replies.

Between calls each character follows its latest standing orders (a move and
a priority list), checked against the same rules the engine enforces.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .. import content as C
from ..engine import Action, dist
from ..policies import find_safe_spot, unsafe, walk_check
from .clients import ChatClient, ClientError
from .prompt import POOL_HIT_PAD, Order, parse_reply, render_state, system_prompt

PLAYER_RADIUS = 0.45
LOW_HP_PCT = 40.0
# A queued interrupt reacts this long after a cast starts: the same reaction
# time as the expert bot. Without it, a standing order would kick on the very
# first tick (0 ms), faster than any player or bot, and the interrupt
# mechanic would stop measuring anything.
REACTION_MS = 350
# Routine check-in interval (game time). Important events ask sooner.
ROUTINE_MS = 4000
# A new pool concerns characters within this distance of its edge.
POOL_NEAR_M = 4.0

INTERRUPTERS = {m.id for m in C.PARTY if any(C.ABILITIES[a].kind == "interrupt" for a in C.CLASSES[m.cls].abilities)}
HEALERS = {m.id for m in C.PARTY if C.CLASSES[m.cls].role == "healer"}
PARTY_IDS = [m.id for m in C.PARTY]


@dataclass
class BrainStats:
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0  # part of input_tokens the provider served from its prompt cache
    cache_write_tokens: int = 0  # part of input_tokens written to the provider's prompt cache
    latency_s: float = 0.0
    cached_calls: int = 0
    unusable_replies: int = 0  # not JSON / no orders: the character keeps its old orders
    truncated_replies: int = 0  # cut off by the output-token limit
    invalid_entries: int = 0  # unknown abilities/targets etc. that we dropped
    api_errors: int = 0
    refusals: int = 0  # the provider declined to answer (keeps old orders)
    budget_exhausted: bool = False
    triggers: dict[str, int] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)  # first few, for debugging

    def as_dict(self) -> dict:
        d = dict(self.__dict__)
        d["problems"] = self.problems[:20]
        d["latency_s"] = round(self.latency_s, 2)
        return d

    def add(self, o: "BrainStats") -> None:
        for k in ("calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "latency_s",
                  "cached_calls", "unusable_replies", "truncated_replies", "invalid_entries", "api_errors", "refusals"):
            setattr(self, k, getattr(self, k) + getattr(o, k))
        self.budget_exhausted = self.budget_exhausted or o.budget_exhausted
        for k, v in o.triggers.items():
            self.triggers[k] = self.triggers.get(k, 0) + v
        self.problems.extend(o.problems[: max(0, 50 - len(self.problems))])


@dataclass
class Standing:
    order: Order
    issued_t: int
    move_done: bool = False
    said: bool = False


def trigger_kind(w: str) -> str:
    return ("boss_cast" if "started casting" in w else "pools" if w.startswith("new pools")
            else "in_pool" if "standing in" in w
            else "pack" if w.endswith(("pulled", "cleared")) or "woke" in w
            else "adds" if w.startswith("adds") else "death" if w.endswith("died")
            else "low_hp" if "is low" in w else "start" if "starting" in w
            else "mark" if "branded" in w else "routine")


class Agent:
    """One character's player: its own rules text (with its own notes), orders, and stats."""

    def __init__(self, uid: str, system: str):
        self.uid = uid
        self.system = system
        self.orders: Standing | None = None
        self.stats = BrainStats()
        self.last_call_t: int | None = None
        self.pending: list[str] = []  # events since the last call, waiting for the minimum gap
        self.gcd = 0

    def describe_orders(self) -> str:
        s = self.orders
        if not s:
            return "  (none yet)"
        mv = f"move_to {s.order.move_to}, " if s.order.move_to and not s.move_done else ""
        pr = ", ".join(f"{a}->{t}" for a, t in s.order.priority or []) or "nothing"
        return f"  {mv}priority [{pr}]"

    def note(self, msg: str) -> None:
        if len(self.stats.problems) < 50:
            self.stats.problems.append(msg)


class Party:
    def __init__(self, client: ChatClient, interval_ms: int = ROUTINE_MS, min_gap_ms: int = 500,
                 max_calls: int = 300, knowledge: str = "full", notes: dict[str, str] | None = None,
                 pull: int | None = None, tier: str = C.DEFAULT_TIER, mode: str = "boss", scope: str = "",
                 parallel: bool = True):
        self.client = client
        self.knowledge = knowledge
        self.interval_ms = interval_ms
        self.min_gap_ms = min_gap_ms
        self.max_calls = max_calls  # per agent
        self.scope = scope  # tags recorded replies with where they were asked (episode/pull)
        self.parallel = parallel
        notes = notes or {}
        self.agents = {uid: Agent(uid, system_prompt(knowledge, notes.get(uid) or None, pull, tier, mode, uid))
                       for uid in PARTY_IDS}
        self.chat: list[tuple[int, str, str]] = []
        self.calls: list[dict] = []  # every model call, for the replay's call inspector
        self.pack_states: dict[str, str] = {}
        self.boss_awake = False
        self.last_tick = -1
        self.started = False
        # What has already been announced, to detect new events.
        self.seen_casts: set[str] = set()
        self.seen_ground: set[str] = set()
        self.seen_enemies: set[str] = set()  # every enemy ever in view (dead ones too)
        self.low: set[str] = set()
        self.dead: set[str] = set()
        self.marked: set[str] = set()

    @property
    def stats(self) -> BrainStats:
        total = BrainStats()
        for a in self.agents.values():
            total.add(a.stats)
        return total

    def stats_dict(self) -> dict:
        d = self.stats.as_dict()
        d["agents"] = {uid: {k: v for k, v in a.stats.as_dict().items() if k != "problems"}
                       for uid, a in self.agents.items()}
        return d

    # ------------------------------------------------------------------
    def events(self, obs: dict) -> list[tuple[str, set[str]]]:
        """New events this tick, each with the characters it concerns."""
        everyone = set(PARTY_IDS)
        pos = {p["id"]: p["pos"] for p in obs["party"]}
        out: list[tuple[str, set[str]]] = []
        for e in obs["enemies"]:
            c = e["casting"]
            if c:
                key = f"{e['id']}:{obs['t'] - c['elapsed_ms']}"
                if key not in self.seen_casts:
                    self.seen_casts.add(key)
                    # Kickable casts concern whoever can kick; the boss's other
                    # casts concern everyone; a trash caster's, its target and the healer.
                    who = (INTERRUPTERS if c["interruptible"] else everyone if e["role"] == "boss"
                           else HEALERS | ({c["target"]} if c.get("target") else set()))
                    out.append((f"{e['id']} started casting {c['ability']}", who))
        for g in obs["ground"]:
            if g["id"] not in self.seen_ground:
                self.seen_ground.add(g["id"])
                near = {p for p, xz in pos.items() if dist(xz, g["pos"]) <= g["radius"] + POOL_NEAR_M}
                if near:
                    out.append((f"new pools: {g['id']}", near))
        new_adds = [e["id"] for e in obs["enemies"] if e["role"] == "add" and e["id"] not in self.seen_enemies]
        self.seen_enemies |= {e["id"] for e in obs["enemies"]}
        if new_adds and self.started:
            out.append((f"adds appeared: {', '.join(new_adds)}", everyone))
        dg = obs.get("dungeon")
        if dg:
            for p in dg["packs"]:
                old = self.pack_states.get(p["id"], "idle")
                if p["state"] != old:
                    out.append((f"{p['name']} {'pulled' if p['state'] == 'engaged' else 'cleared'}", everyone))
            if dg["boss_engaged"] and not self.boss_awake:
                out.append(("Mortisar woke up", everyone))
            self.pack_states = {p["id"]: p["state"] for p in dg["packs"]}
            self.boss_awake = dg["boss_engaged"]
        low, dead, marked = set(), set(), set()
        for p in obs["party"]:
            if not p["alive"]:
                dead.add(p["id"])
                if p["id"] not in self.dead:
                    out.append((f"{p['id']} died", everyone))
                continue
            if "grave_mark" in p["auras"]:
                marked.add(p["id"])
                if p["id"] not in self.marked:
                    near = {o for o, xz in pos.items() if dist(xz, p["pos"]) <= C.GRAVE_MARK_RADIUS + 2.0}
                    out.append((f"{p['id']} was branded with grave_mark", near | {p["id"]}))
            if p["hp_pct"] < LOW_HP_PCT:
                low.add(p["id"])
                if p["id"] not in self.low:
                    out.append((f"{p['id']} is low ({p['hp_pct']:.0f}%)", HEALERS | {p["id"]}))
        self.low, self.dead, self.marked = low, dead, marked
        return out

    def in_pool(self, obs: dict, uid: str) -> bool:
        p = next(p for p in obs["party"] if p["id"] == uid)
        return p["alive"] and any(g["armed"] and dist(p["pos"], g["pos"]) <= g["radius"] + POOL_HIT_PAD
                                  for g in obs["ground"])

    def tick(self, obs: dict) -> None:
        """Called by the first living character each tick; decides which agents to ask."""
        t = obs["t"]
        if t == self.last_tick:
            return
        self.last_tick = t
        events = self.events(obs)
        alive = {p["id"] for p in obs["party"] if p["alive"]}
        asks: list[tuple[Agent, list[str]]] = []
        for uid in PARTY_IDS:
            a = self.agents[uid]
            if uid not in alive:
                a.pending.clear()
                continue
            a.pending.extend(w for w, who in events if uid in who and w not in a.pending)
            why = list(a.pending)
            if self.in_pool(obs, uid):
                why.append(f"{uid} is standing in an armed pool")
            if a.last_call_t is None:
                why = ["the fight is starting"]
            elif t - a.last_call_t >= self.interval_ms:
                why = why or ["routine check-in"]
            elif not why or t - a.last_call_t < self.min_gap_ms:
                # Urgent: an interruptible cast can't wait for the minimum gap.
                if not any("started casting" in w for w in why):
                    continue
            if a.stats.calls >= self.max_calls:
                a.stats.budget_exhausted = True
                continue
            asks.append((a, why))
        self.started = True
        if asks:
            self.ask(obs, asks)

    def ask(self, obs: dict, asks: list[tuple[Agent, list[str]]]) -> None:
        jobs = []
        chat = list(self.chat)  # everyone asked now sees the same chat
        for a, why in asks:
            for w in why:
                k = trigger_kind(w)
                a.stats.triggers[k] = a.stats.triggers.get(k, 0) + 1
            age = None if a.last_call_t is None else (obs["t"] - a.last_call_t) / 1000
            user = (render_state(obs, a.uid, a.gcd, age, self.knowledge, chat)
                    + "\nYOUR CURRENT ORDERS:\n" + a.describe_orders()
                    + f"\nWHY YOU ARE BEING ASKED NOW: {'; '.join(why)}.\nReply with the JSON orders for {a.uid}.")
            a.last_call_t = obs["t"]
            a.pending.clear()
            a.stats.calls += 1
            tag = f"{self.scope}|play|{a.uid}|{a.stats.calls}"
            jobs.append((a, why, user, tag))

        def call(job):
            a, _, user, tag = job
            try:
                return self.client.complete(a.system, user, tag=tag)
            except ClientError as err:
                if err.fatal:
                    raise
                return err

        if self.parallel and len(jobs) > 1:
            with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
                replies = list(pool.map(call, jobs))
        else:
            replies = [call(j) for j in jobs]
        ids = {u["id"] for u in obs["party"] + obs["enemies"]}
        gone = self.seen_enemies - ids
        for (a, why, user, _), reply in zip(jobs, replies):  # applied in party order: deterministic
            self.apply(obs, a, why, user, reply, ids, gone)

    def apply(self, obs: dict, a: Agent, why: list[str], user: str, reply, ids: set[str], gone: set[str]) -> None:
        rec = {"t": obs["t"], "agent": a.uid, "why": why, "prompt": user}
        self.calls.append(rec)
        if isinstance(reply, ClientError):
            a.stats.api_errors += 1
            a.note(f"t={obs['t']}: {reply}")
            rec["error"] = str(reply)[:300]
            return
        s = a.stats
        s.input_tokens += reply.input_tokens
        s.output_tokens += reply.output_tokens
        s.cache_read_tokens += reply.cache_read_tokens
        s.cache_write_tokens += reply.cache_write_tokens
        s.latency_s += reply.latency_s
        s.cached_calls += reply.cached
        rec.update(reply=reply.text, thinking=reply.thinking, input_tokens=reply.input_tokens,
                   output_tokens=reply.output_tokens, cache_read_tokens=reply.cache_read_tokens)
        if reply.refused:
            s.refusals += 1
            a.note(f"t={obs['t']}: the provider refused to answer")
            rec["refused"] = True
            return
        if reply.truncated:
            s.truncated_replies += 1
            a.note(f"t={obs['t']}: reply cut off at the output-token limit")
            rec["truncated"] = True
        parsed = parse_reply(reply.text, a.uid, ids, gone)
        if not parsed.ok:
            s.unusable_replies += 1
        s.invalid_entries += len(parsed.problems)
        for p in parsed.problems:
            a.note(f"t={obs['t']}: {p}")
        if parsed.problems:
            rec["problems"] = parsed.problems
        order = parsed.orders.get(a.uid)
        if order is None:
            return
        if order.priority is None:  # left out: keep the current priority list
            order.priority = list(a.orders.order.priority or []) if a.orders else []
        if order.say:
            self.chat.append((obs["t"], a.uid, order.say))
        old = a.orders
        if old and old.order.move_to == order.move_to and old.order.priority == order.priority:
            # Same orders again: a move the agent sends again is a fresh
            # instruction (e.g. "safe" for a new pool); a new message is said.
            old.move_done = order.move_to is None
            if order.say and order.say != old.order.say:
                old.order.say, old.said = order.say, False
            return
        a.orders = Standing(order, obs["t"])


class LLMPolicy:
    """Per-character adapter: follows its agent's standing orders each tick."""

    def __init__(self, unit_id: str, party: Party):
        self.uid = unit_id
        self.party = party
        self.name = f"llm:{party.client.spec}"

    def act(self, obs: dict) -> list[Action]:
        me = obs["self"]
        agent = self.party.agents[self.uid]
        agent.gcd = me.get("gcd_ms", 0)
        if not me["alive"]:
            return []
        self.party.tick(obs)
        st = agent.orders
        if not st:
            return []
        out: list[Action] = []
        moving = me["moving"]
        if st.order.move_to and not st.move_done:
            st.move_done = True
            dest = (self.safe_destination(obs, st) if st.order.move_to == "safe"
                    else self.next_waypoint(obs) if st.order.move_to == "next" else st.order.move_to)
            # Ordering a character to the spot it already stands on is a no-op:
            # don't send it, so it doesn't show up as a "Move" decision.
            if dest is not None and dist(me["pos"], dest) > 0.3:
                out.append(Action("move", to=dest, reason=self.say(st)))
                moving = True
        if me["casting"]:
            return out
        units = {u["id"]: u for u in obs["party"] + obs["enemies"]}
        for ab_id, tgt_id in st.order.priority or []:
            if self.usable(ab_id, tgt_id, me, units, moving):
                out.append(Action("cast", ab_id, tgt_id, reason=self.say(st)))
                break
        return out

    def next_waypoint(self, obs: dict):
        """'next': the next route waypoint toward the boss (a walking shortcut, like 'safe')."""
        dg = obs.get("dungeon")
        if not dg:
            return None
        z = obs["self"]["pos"][1]
        return next((tuple(w) for w in dg["route"] if w[1] < z - 0.8), tuple(dg["route"][-1]))

    def safe_destination(self, obs: dict, st: Standing):
        """Resolve "safe": the bots' dodge planner, keeping the first priority
        target in range when possible and never walking through another
        pool. None = already safe and in range."""
        me = obs["self"]
        pos = tuple(me["pos"])
        units = {u["id"]: u for u in obs["party"] + obs["enemies"]}
        reach = None
        for ab_id, tgt_id in st.order.priority or []:
            tgt, ab = units.get(tgt_id), C.ABILITIES[ab_id]
            if tgt and tgt["alive"] and tgt_id != self.uid and ab.kind not in ("taunt", "buff", "raid_heal", "aoe_damage"):
                radius = C.BOSS.radius if tgt["role"] == "boss" else C.ADD.radius if tgt["role"] == "add" else PLAYER_RADIUS
                reach = (tuple(tgt["pos"]), radius, ab.range - 0.2)
                break
        in_reach = reach is None or dist(pos, reach[0]) - PLAYER_RADIUS - reach[1] <= reach[2]
        if not unsafe(pos, obs["ground"], 0.3) and in_reach:
            return None
        g, r, inside = obs["ground"], obs["arena_radius"], walk_check(obs)
        # Prefer: in range and a clean path; then a clean path; then just clear of pools.
        return (find_safe_spot(g, r, pos, pos, reach, avoid_paths=True, inside=inside)
                or find_safe_spot(g, r, pos, pos, avoid_paths=True, inside=inside)
                or find_safe_spot(g, r, pos, pos, inside=inside))

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
            c = tgt["casting"]
            if not (c and c["interruptible"] and c["elapsed_ms"] >= REACTION_MS):
                return False
        if ab.kind in ("taunt", "buff") or tgt_id == self.uid:
            return True
        radius = C.BOSS.radius if tgt["role"] == "boss" else C.ADD.radius if tgt["role"] == "add" else PLAYER_RADIUS
        return dist(me["pos"], tgt["pos"]) - PLAYER_RADIUS - radius <= ab.range


def add_chat_events(replay: dict, chat: list[tuple[int, str, str]]) -> None:
    """Put the party chat into the replay as ``chat`` events, after the other
    events of the same tick (and before the encounter's end)."""
    if not chat:
        return
    rank = lambda e: (e["t"], 2 if e["type"] == "encounter_end" else 1 if e["type"] == "chat" else 0)  # noqa: E731
    replay["events"] = sorted(replay["events"] + [{"t": t, "type": "chat", "unit": u, "text": text} for t, u, text in chat],
                              key=rank)


def make_llm_policies(client: ChatClient, **party_kwargs) -> tuple[dict[str, LLMPolicy], Party]:
    party = Party(client, **party_kwargs)
    return {uid: LLMPolicy(uid, party) for uid in PARTY_IDS}, party
