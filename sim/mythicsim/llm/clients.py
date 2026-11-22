"""Minimal chat clients (standard library only) and a replay cache.

A model spec is ``provider:model``, for example ``anthropic:claude-haiku-5-5``
or ``openai:<model-name>``. API keys come from the environment or from a
``.env`` file at the repository root (see ``.env.example``).
"""

from __future__ import annotations

import gzip
import hashlib
import http.client
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

REPO_ROOT = Path(__file__).resolve().parents[3]


@dataclass
class Reply:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_s: float = 0.0
    cached: bool = False  # served from our replay cache (no API call)
    cache_read_tokens: int = 0  # input tokens the provider served from its prompt cache (cheaper)
    truncated: bool = False  # the model hit the output-token limit before finishing
    cache_write_tokens: int = 0  # input tokens written to the provider's prompt cache (Anthropic bills these higher)
    refused: bool = False  # the provider's safety system declined to answer (no orders this call)
    thinking: str = ""  # the provider's summary of the model's reasoning, when it gives one
    # For auditing (recorded with the reply): the model the provider actually
    # served (an alias can move), why it stopped, its request id, and how many
    # output tokens were reasoning, when the provider says.
    model: str = ""
    stop_reason: str = ""
    request_id: str = ""
    reasoning_tokens: int | None = None


class ChatClient(Protocol):
    spec: str

    def complete(self, system: str, user: str, tag: str = "") -> Reply: ...


class ClientError(RuntimeError):
    """``fatal`` errors (bad key, no credits, bad request) stop the run: retrying
    or playing on without orders would only waste time and money."""

    def __init__(self, msg: str, fatal: bool = False):
        super().__init__(msg)
        self.fatal = fatal


# ---------------------------------------------------------------------------
# .env loading
# ---------------------------------------------------------------------------

def load_env(path: Path | None = None) -> None:
    """Load KEY=VALUE lines from ``.env`` into os.environ (existing vars win)."""
    path = path or REPO_ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip('"').strip("'")
        if value:
            os.environ.setdefault(key.strip(), value)


def _key(name: str) -> str:
    load_env()
    key = os.environ.get(name, "").strip()
    if not key:
        err = ClientError(f"{name} is not set. Copy .env.example to .env and add your key.", fatal=True)
        err.not_billed = True  # nothing was sent
        raise err
    return key


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

# A request that timed out or lost its connection may still have been billed.
# Before such a request is sent again, the spend meter (spend.CostMeter) is
# told through this per-thread hook, so it holds money for the extra attempt
# and counts the lost one as spent. Rate limits and server errors (429, 5xx)
# are refused before any work, so they're not billed and need no hook.
_RESEND = threading.local()


def _before_resend() -> None:
    hook = getattr(_RESEND, "hook", None)
    if hook is not None:
        hook()


def _post(url: str, headers: dict, body: dict, timeout: float = 180.0, retries: int = 6) -> dict:
    data = json.dumps(body).encode()
    delay = 2.0
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method="POST",
                                     headers={"content-type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")[:500]
            out_of_credit = "insufficient_quota" in detail or "credit" in detail.lower()
            # Refused before any work (a 4xx, a rate limit, overload): not
            # billed. A server error may have come after the model ran: treat
            # it as possibly billed (the meter holds money for the resend).
            refused = err.code < 500 or err.code == 529
            # Rate limits and server hiccups are worth retrying; billing, auth,
            # and malformed requests are not.
            if err.code in (429, 500, 502, 503, 504, 529) and not out_of_credit and attempt < retries:
                if not refused:
                    _before_resend()
                time.sleep(delay)
                delay *= 2
                continue
            fatal = out_of_credit or err.code in (400, 401, 403, 404)
            out = ClientError(f"HTTP {err.code} from {url}: {detail}", fatal=fatal)
            out.not_billed = refused
            raise out from None
        except (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError, OSError) as err:
            # Dropped connections, resets, and timeouts: transient, so retry,
            # but the lost attempt may have been billed (see _before_resend).
            if attempt < retries:
                _before_resend()
                time.sleep(delay)
                delay *= 2
                continue
            raise ClientError(f"network error calling {url}: {err}") from None  # may have been billed
        try:
            return json.loads(body)
        except ValueError:
            # A 200 whose body we can't read was answered (and billed): the
            # meter counts it at its worst case. Not retried: that would pay twice.
            raise ClientError(f"unreadable response from {url}: {body[:200]!r}") from None
    raise ClientError("unreachable")


# Per-call output cap (thinking + answer), the same for every model.
MAX_OUTPUT_TOKENS = 8000

# Anthropic models that cannot turn thinking off (a request with thinking
# disabled is rejected); "@none" is refused for them up front.
_ALWAYS_THINK = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable", "claude-mythos")


def _cache_key(system: str) -> str:
    """One prompt-cache routing key per distinct rules text (a pull's rules
    differ once notes are added). One key shared by every request overflows
    OpenAI's per-key routing and most requests then miss the cache."""
    return "mb-" + hashlib.sha256(system.encode()).hexdigest()[:16]


@dataclass
class AnthropicClient:
    model: str
    effort: str | None = None  # None = API default; "none" = thinking off; low/medium/high/xhigh/max
    max_tokens: int = MAX_OUTPUT_TOKENS  # thinking shares this budget with the answer
    spec: str = ""

    def __post_init__(self) -> None:
        self.spec = f"anthropic:{self.model}" + (f"@{self.effort}" if self.effort else "")
        if self.effort == "none" and self.model.startswith(_ALWAYS_THINK):
            raise ClientError(f"{self.model} cannot turn thinking off; use @low or higher", fatal=True)

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        t0 = time.monotonic()
        # No server-side model fallback on refusals: an answer from a different
        # model would silently contaminate this model's results. A refusal is
        # recorded instead, and the party keeps its previous orders.
        out = _post("https://api.anthropic.com/v1/messages",
                    {"x-api-key": _key("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01"},
                    {"model": self.model, "max_tokens": self.max_tokens,
                     # The rules never change between calls: let Anthropic cache them.
                     "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                     "messages": [{"role": "user", "content": user}], **self.effort_params()})
        text = "".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
        thinking = "".join(b.get("thinking", "") for b in out.get("content", []) if b.get("type") == "thinking")
        u = out.get("usage", {})
        read = u.get("cache_read_input_tokens", 0) or 0
        write = u.get("cache_creation_input_tokens", 0) or 0
        total_in = (u.get("input_tokens", 0) or 0) + write + read
        return Reply(text, total_in, u.get("output_tokens", 0), time.monotonic() - t0, cache_read_tokens=read,
                     truncated=out.get("stop_reason") == "max_tokens", cache_write_tokens=write,
                     refused=out.get("stop_reason") == "refusal", thinking=thinking[:4000],
                     model=str(out.get("model") or ""), stop_reason=str(out.get("stop_reason") or ""),
                     request_id=str(out.get("id") or ""))

    def effort_params(self) -> dict:
        if self.effort == "none":
            return {"thinking": {"type": "disabled"}}
        # Adaptive thinking with a readable summary (billed the same as hidden
        # thinking); the summary is kept with the recording for analysis.
        params: dict = {"thinking": {"type": "adaptive", "display": "summarized"}}
        if self.effort:
            params["output_config"] = {"effort": self.effort}
        return params


@dataclass
class OpenAIClient:
    model: str
    effort: str | None = None  # None = API default; else reasoning_effort (none/low/medium/high/xhigh)
    max_tokens: int = MAX_OUTPUT_TOKENS  # reasoning models spend part of this budget thinking
    spec: str = ""

    def __post_init__(self) -> None:
        self.spec = f"openai:{self.model}" + (f"@{self.effort}" if self.effort else "")

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        t0 = time.monotonic()
        # No JSON mode: Anthropic has no equivalent here, and both providers
        # must get the same reply contract (the prompt asks for JSON; the same
        # parser reads both).
        out = _post("https://api.openai.com/v1/chat/completions",
                    {"authorization": f"Bearer {_key('OPENAI_API_KEY')}"},
                    {"model": self.model, "max_completion_tokens": self.max_tokens,
                     # Route requests that share the rules prefix together so
                     # OpenAI's (best-effort) prompt cache actually hits.
                     "prompt_cache_key": _cache_key(system),
                     **({"reasoning_effort": self.effort} if self.effort else {}),
                     "messages": [{"role": "system", "content": system},
                                  {"role": "user", "content": user}]})
        choices = out.get("choices") or [{}]
        msg = choices[0].get("message") or {}
        text = msg.get("content") or ""
        truncated = choices[0].get("finish_reason") == "length"
        refused = bool(msg.get("refusal")) or choices[0].get("finish_reason") == "content_filter"
        usage = out.get("usage", {})
        read = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
        reasoning = (usage.get("completion_tokens_details") or {}).get("reasoning_tokens")
        return Reply(text, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
                     time.monotonic() - t0, cache_read_tokens=read, truncated=truncated, refused=refused,
                     model=str(out.get("model") or ""), stop_reason=str(choices[0].get("finish_reason") or ""),
                     request_id=str(out.get("id") or ""), reasoning_tokens=reasoning)


MOCK_ORDERS = {
    "rook": [["rampart_bash", "oruth"], ["bulwark_slam", "oruth"], ["rampart_strike", "oruth"]],
    "ivy": [["bloomward", "rook"], ["mending_light", "rook"]],
    "brask": [["throat_punch", "oruth"], ["ravage", "oruth"], ["savage_hew", "oruth"]],
    "kit": [["quick_jab", "oruth"], ["venom_burst", "oruth"], ["twin_fang", "oruth"]],
    "wren": [["silencing_arrow", "oruth"], ["wild_roar", "wren"], ["piercing_shot", "oruth"],
            ["steady_arrow", "oruth"]],
}


@dataclass
class MockClient:
    """No API, no cost: a fixed, sensible plan per character. For checking the harness."""
    model: str = "basic"
    spec: str = ""

    def __post_init__(self) -> None:
        self.spec = f"mock:{self.model}"

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        me = re.search(r"\((\w+)\), the ", system)
        uid = me.group(1) if me else "rook"
        n = (len(system) + len(user)) // 4
        if "WRITE YOUR NOTES" in user:
            pull = re.search(r"THE PULL \(PULL (\d+)\)", user)
            return Reply(json.dumps({"notes": f"Mock notes of {uid} after pull {pull.group(1) if pull else '?'}: "
                                              "interrupt Requiem of Bones; step out of pools."}), n, 40, 0.0)
        if "PARTY TALK" in user:
            spoken = f"({uid}):" in user.split("PARTY TALK")[1]
            return Reply(json.dumps({"message": "" if spoken else f"{uid} here: kick more, stand in less.",
                                     "ready": spoken}), n, 20, 0.0)
        fighting = re.search(r"ENEMIES FIGHTING YOU: (\w+) \(", user)
        target = fighting.group(1) if fighting else "oruth"
        order = {"priority": [[ab, target if t == "oruth" else t] for ab, t in MOCK_ORDERS.get(uid, [])],
                 "say": ""}
        if "Out of combat" in user:
            order["move_to"] = "next"
        return Reply(json.dumps(order), n, 60, 0.0)


EFFORTS = ("none", "low", "medium", "high", "xhigh", "max")


def make_client(spec: str, effort: str | None = None) -> ChatClient:
    """``provider:model`` or ``provider:model@effort`` (effort: none/low/medium/high/xhigh/max).

    Each effort setting is a separate configuration: its own label, replay
    recording, and results folder, so runs at different efforts never mix."""
    provider, _, model = spec.partition(":")
    if not model:
        raise ClientError(f"model spec must look like provider:model, got {spec!r}", fatal=True)
    model, _, at = model.partition("@")
    effort = effort or at or None
    if effort is not None and effort not in EFFORTS:
        raise ClientError(f"effort must be one of {', '.join(EFFORTS)}, got {effort!r}", fatal=True)
    if provider == "anthropic":
        return AnthropicClient(model, effort)
    if provider == "openai":
        return OpenAIClient(model, effort)
    if provider == "mock":
        return MockClient(model)
    if provider == "scripted":
        from .scripted import ScriptedCommander
        return ScriptedCommander(model)
    raise ClientError(f"unknown provider {provider!r} (use anthropic, openai, scripted, or mock)")


# ---------------------------------------------------------------------------
# Replay cache
# ---------------------------------------------------------------------------

class NoNetwork:
    """Stands in for a real client in offline mode: reaching it is a bug, so it's fatal."""

    def __init__(self, spec: str):
        self.spec = spec

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        raise ClientError("offline mode tried to call the provider", fatal=True)


class _Recording:
    """One recording file, shared by every CachedClient in the process that
    points at it: one in-memory table, one lock, and each key recorded once.
    A second process can't write the same file (an OS file lock), and a file
    that holds two different replies for one key is refused."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.mem: dict[str, dict] = {}
        self.inflight: dict[str, threading.Event] = {}
        self._lockfile = None
        self._load()

    def _load(self) -> None:
        """Read the file into memory (again, after taking the writer lock: another
        process may have recorded more since this one first read it)."""
        path = self.path
        gz = path.with_name(path.name + ".gz")  # a published dataset ships recordings gzipped
        text = path.read_text() if path.exists() else gzip.decompress(gz.read_bytes()).decode() if gz.exists() else ""
        for line in text.splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            old = self.mem.get(rec["key"])
            if old is not None and old["text"] != rec["text"]:
                raise ClientError(f"{path}: two different recorded replies for one call (key {rec['key'][:12]}); "
                                  "the recording is ambiguous and can't be replayed exactly", fatal=True)
            self.mem[rec["key"]] = rec

    def claim_writer(self) -> None:
        """Only one process may record into a file."""
        if self._lockfile is not None:
            return
        import fcntl
        self.path.parent.mkdir(parents=True, exist_ok=True)
        f = open(self.path.with_name(self.path.name + ".lock"), "w")
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            f.close()
            raise ClientError(f"another process is recording into {self.path}; run one campaign at a time",
                              fatal=True) from None
        self._lockfile = f
        self._load()  # now nobody else can write it: catch up on anything recorded before we got here

    def append(self, rec: dict) -> None:
        self.mem[rec["key"]] = rec
        with self.path.open("a") as f:
            f.write(json.dumps(rec) + "\n")


_RECORDINGS: dict[Path, _Recording] = {}
_RECORDINGS_LOCK = threading.Lock()


def _recording(path: Path) -> _Recording:
    with _RECORDINGS_LOCK:
        key = Path(path).resolve()
        if key not in _RECORDINGS:
            _RECORDINGS[key] = _Recording(Path(path))
        return _RECORDINGS[key]


@dataclass
class CachedClient:
    """Wraps a client; identical prompts return the recorded reply.

    Models are random, so a fresh run is not reproducible on its own. Every
    (model, prompt, call tag) -> reply pair is appended to a JSONL file;
    re-running with the recording replays the exact same game for free, and
    anyone with the file can verify a published result.

    Every call is recorded exactly once. Clients in one process share the
    file's table, and a call already in flight is waited for, not repeated:
    so a memory-off control and its memory-on twin, whose first pulls ask
    exactly the same things, play one shared, recorded pull 1.
    """
    inner: ChatClient
    path: Path
    offline: bool = False  # True: never call the API; a missing reply is a fatal error
    spec: str = ""

    def __post_init__(self) -> None:
        self.spec = self.inner.spec
        self.rec = _recording(self.path)

    def key(self, system: str, user: str, tag: str = "") -> str:
        # ``tag`` says where the call was made (episode, pull, agent, call
        # number). Without it, identical prompts in different episodes (the
        # opening calls of every pull look the same) would replay one recorded
        # reply instead of sampling the model again.
        return hashlib.sha256(json.dumps([self.spec, system, user] + ([tag] if tag else [])).encode()).hexdigest()

    @staticmethod
    def _reply(r: dict) -> Reply:
        return Reply(r["text"], r["input_tokens"], r["output_tokens"], 0.0, cached=True,
                     cache_read_tokens=r.get("cache_read_tokens", 0), truncated=r.get("truncated", False),
                     cache_write_tokens=r.get("cache_write_tokens", 0), refused=r.get("refused", False),
                     thinking=r.get("thinking", ""), model=r.get("model", ""), stop_reason=r.get("stop_reason", ""),
                     request_id=r.get("request_id", ""), reasoning_tokens=r.get("reasoning_tokens"))

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        k = self.key(system, user, tag)
        rec = self.rec
        while True:
            with rec.lock:
                if k in rec.mem:
                    return self._reply(rec.mem[k])
                if self.offline:
                    # Fatal: playing on without this reply would silently play
                    # a different game from the one recorded.
                    raise ClientError("cache miss in offline mode (prompt not in the recording)", fatal=True)
                waiting = rec.inflight.get(k)
                if waiting is None:
                    rec.claim_writer()
                    if k in rec.mem:  # recorded by another process before we held the lock
                        return self._reply(rec.mem[k])
                    rec.inflight[k] = threading.Event()
                    break
            waiting.wait()  # the same call is being made right now: use its reply
        try:
            reply = self.inner.complete(system, user, tag=tag)
            with rec.lock:
                rec.append({"key": k, "spec": self.spec, "tag": tag, "text": reply.text,
                            "input_tokens": reply.input_tokens, "output_tokens": reply.output_tokens,
                            "cache_read_tokens": reply.cache_read_tokens,
                            "cache_write_tokens": reply.cache_write_tokens,
                            "truncated": reply.truncated, "refused": reply.refused, "thinking": reply.thinking,
                            "model": reply.model, "stop_reason": reply.stop_reason, "request_id": reply.request_id,
                            "reasoning_tokens": reply.reasoning_tokens})
            return reply
        finally:
            with rec.lock:
                rec.inflight.pop(k).set()
