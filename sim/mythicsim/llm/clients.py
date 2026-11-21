"""Minimal chat clients (standard library only) and a replay cache.

A model spec is ``provider:model``, for example ``anthropic:claude-haiku-5-5``
or ``openai:<model-name>``. API keys come from the environment or from a
``.env`` file at the repository root (see ``.env.example``).
"""

from __future__ import annotations

import hashlib
import json
import os
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


class ChatClient(Protocol):
    spec: str

    def complete(self, system: str, user: str) -> Reply: ...


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
        raise ClientError(f"{name} is not set. Copy .env.example to .env and add your key.", fatal=True)
    return key


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _post(url: str, headers: dict, body: dict, timeout: float = 120.0, retries: int = 4) -> dict:
    data = json.dumps(body).encode()
    delay = 2.0
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method="POST",
                                     headers={"content-type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as err:
            detail = err.read().decode(errors="replace")[:500]
            out_of_credit = "insufficient_quota" in detail or "credit" in detail.lower()
            # Rate limits and server hiccups are worth retrying; billing, auth,
            # and malformed requests are not.
            if err.code in (429, 500, 502, 503, 504, 529) and not out_of_credit and attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            fatal = out_of_credit or err.code in (400, 401, 403, 404)
            raise ClientError(f"HTTP {err.code} from {url}: {detail}", fatal=fatal) from None
        except (urllib.error.URLError, TimeoutError) as err:
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            raise ClientError(f"network error calling {url}: {err}") from None
    raise ClientError("unreachable")


@dataclass
class AnthropicClient:
    model: str
    max_tokens: int = 16000  # thinking shares this budget with the answer
    spec: str = ""

    def __post_init__(self) -> None:
        self.spec = f"anthropic:{self.model}"

    def complete(self, system: str, user: str) -> Reply:
        t0 = time.monotonic()
        out = _post("https://api.anthropic.com/v1/messages",
                    {"x-api-key": _key("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01"},
                    {"model": self.model, "max_tokens": self.max_tokens,
                     # The rules never change between calls: let Anthropic cache them.
                     "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                     "messages": [{"role": "user", "content": user}]})
        text = "".join(b.get("text", "") for b in out.get("content", []) if b.get("type") == "text")
        u = out.get("usage", {})
        read = u.get("cache_read_input_tokens", 0) or 0
        total_in = (u.get("input_tokens", 0) or 0) + (u.get("cache_creation_input_tokens", 0) or 0) + read
        return Reply(text, total_in, u.get("output_tokens", 0), time.monotonic() - t0, cache_read_tokens=read,
                     truncated=out.get("stop_reason") == "max_tokens")


@dataclass
class OpenAIClient:
    model: str
    max_tokens: int = 16000  # reasoning models spend part of this budget thinking
    spec: str = ""

    def __post_init__(self) -> None:
        self.spec = f"openai:{self.model}"

    def complete(self, system: str, user: str) -> Reply:
        t0 = time.monotonic()
        out = _post("https://api.openai.com/v1/chat/completions",
                    {"authorization": f"Bearer {_key('OPENAI_API_KEY')}"},
                    {"model": self.model, "max_completion_tokens": self.max_tokens,
                     "response_format": {"type": "json_object"},
                     "messages": [{"role": "system", "content": system},
                                  {"role": "user", "content": user}]})
        choices = out.get("choices") or [{}]
        text = (choices[0].get("message") or {}).get("content") or ""
        truncated = choices[0].get("finish_reason") == "length"
        usage = out.get("usage", {})
        read = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
        return Reply(text, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0),
                     time.monotonic() - t0, cache_read_tokens=read, truncated=truncated)


@dataclass
class MockClient:
    """No API, no cost: a fixed, sensible plan. For checking the harness."""
    model: str = "basic"
    spec: str = ""

    def __post_init__(self) -> None:
        self.spec = f"mock:{self.model}"

    def complete(self, system: str, user: str) -> Reply:
        orders = {
            "bramble": {"priority": [["rampart_bash", "mortisar"], ["bulwark_slam", "mortisar"],
                                     ["rampart_strike", "mortisar"]], "say": "Tanking and kicking."},
            "lumi": {"priority": [["bloomward", "bramble"], ["mending_light", "bramble"]],
                     "say": "Keeping the tank alive."},
            "grokka": {"priority": [["throat_punch", "mortisar"], ["ravage", "mortisar"],
                                    ["savage_hew", "mortisar"]], "say": "Hitting the boss."},
            "nyx": {"priority": [["quick_jab", "mortisar"], ["venom_burst", "mortisar"],
                                 ["twin_fang", "mortisar"]], "say": "Hitting the boss."},
            "bao": {"priority": [["silencing_arrow", "mortisar"], ["wild_roar", "bao"],
                                 ["piercing_shot", "mortisar"], ["steady_arrow", "mortisar"]],
                    "say": "Shooting the boss."},
        }
        return Reply(json.dumps({"orders": orders}), len(system + user) // 4, 200, 0.0)


def make_client(spec: str) -> ChatClient:
    provider, _, model = spec.partition(":")
    if not model:
        raise ClientError(f"model spec must look like provider:model, got {spec!r}")
    if provider == "anthropic":
        return AnthropicClient(model)
    if provider == "openai":
        return OpenAIClient(model)
    if provider == "mock":
        return MockClient(model)
    raise ClientError(f"unknown provider {provider!r} (use anthropic, openai, or mock)")


# ---------------------------------------------------------------------------
# Replay cache
# ---------------------------------------------------------------------------

@dataclass
class CachedClient:
    """Wraps a client; identical prompts return the recorded reply.

    Models are random, so a fresh run is not reproducible on its own. Every
    (model, prompt) -> reply pair is appended to a JSONL file; re-running the
    same seed with the cache replays the exact same game for free, and anyone
    with the file can verify a published result.
    """
    inner: ChatClient
    path: Path
    offline: bool = False  # True: never call the API; a cache miss is an error
    spec: str = ""
    _mem: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.spec = self.inner.spec
        if self.path.exists():
            for line in self.path.read_text().splitlines():
                if line.strip():
                    rec = json.loads(line)
                    self._mem[rec["key"]] = rec

    def key(self, system: str, user: str) -> str:
        return hashlib.sha256(json.dumps([self.spec, system, user]).encode()).hexdigest()

    def complete(self, system: str, user: str) -> Reply:
        k = self.key(system, user)
        if k in self._mem:
            r = self._mem[k]
            return Reply(r["text"], r["input_tokens"], r["output_tokens"], 0.0, cached=True,
                         cache_read_tokens=r.get("cache_read_tokens", 0), truncated=r.get("truncated", False))
        if self.offline:
            raise ClientError("cache miss in offline mode (prompt not in the recording)")
        reply = self.inner.complete(system, user)
        rec = {"key": k, "spec": self.spec, "text": reply.text,
               "input_tokens": reply.input_tokens, "output_tokens": reply.output_tokens,
               "cache_read_tokens": reply.cache_read_tokens, "truncated": reply.truncated}
        self._mem[k] = rec
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as f:
            f.write(json.dumps(rec) + "\n")
        return reply
