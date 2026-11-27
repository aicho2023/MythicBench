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
from dataclasses import dataclass
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
    service_tier: str = ""  # OpenAI: the tier that served the request (priced as Standard)


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


def _malformed(why: str) -> ClientError:
    # The request was answered (and may have been billed), but not in a shape
    # we can trust: the meter counts it at its bound, the group is left
    # unfinished (a rerun asks again), and it's never scored as a model reply.
    return ClientError(f"malformed response from the provider: {why}")


def _strict(read, out, t0: float) -> "Reply":
    """Read a provider's answer strictly: any shape we don't expect is a
    malformed (possibly billed) response, never a crash or a $0 reply."""
    try:
        return read(out, t0)
    except ClientError:
        raise
    except Exception as err:  # noqa: BLE001 - an unexpected shape, whatever it is
        raise _malformed(f"{type(err).__name__}: {err}") from None


def _obj(x, what: str) -> dict:
    if not isinstance(x, dict):
        raise _malformed(f"{what} is {type(x).__name__}, not an object")
    return x


def _text(x, what: str) -> str:
    if x is None:
        return ""
    if not isinstance(x, str):
        raise _malformed(f"{what} is {type(x).__name__}, not text")
    return x


def _tokens(d: dict, key: str, what: str, required: bool = True) -> int:
    """A token count used for billing: a whole number >= 0 (absent or null = 0 when optional)."""
    v = d.get(key)
    if v is None and not required:
        return 0
    if isinstance(v, bool) or not isinstance(v, int) or v < 0:
        raise _malformed(f"{what}.{key} is {v!r}")
    return v


def _read_anthropic(out, t0: float) -> "Reply":
    out = _obj(out, "the response")
    content = out.get("content")
    if not isinstance(content, list):
        raise _malformed("no 'content' list")
    text, thinking = [], []
    for i, b in enumerate(content):
        b = _obj(b, f"content[{i}]")
        kind = _text(b.get("type"), f"content[{i}].type")
        if kind == "text":
            text.append(_text(b.get("text"), f"content[{i}].text"))
        elif kind == "thinking":
            thinking.append(_text(b.get("thinking"), f"content[{i}].thinking"))
    u = _obj(out.get("usage"), "usage")
    fresh = _tokens(u, "input_tokens", "usage")
    read = _tokens(u, "cache_read_input_tokens", "usage", required=False)
    write = _tokens(u, "cache_creation_input_tokens", "usage", required=False)
    total_in = fresh + read + write
    if total_in <= 0:
        raise _malformed("no input tokens counted for a request that had a prompt")
    stop = _text(out.get("stop_reason"), "stop_reason")
    return Reply("".join(text), total_in, _tokens(u, "output_tokens", "usage"), time.monotonic() - t0,
                 cache_read_tokens=read, truncated=stop == "max_tokens", cache_write_tokens=write,
                 refused=stop == "refusal", thinking="".join(thinking)[:4000],
                 model=_text(out.get("model"), "model"), stop_reason=stop, request_id=_text(out.get("id"), "id"))


def _read_openai(out, t0: float) -> "Reply":
    out = _obj(out, "the response")
    choices = out.get("choices")
    if not isinstance(choices, list) or not choices:
        raise _malformed("no 'choices'")
    c0 = _obj(choices[0], "choices[0]")
    msg = _obj(c0.get("message"), "choices[0].message")
    text = _text(msg.get("content"), "message.content")
    refusal = _text(msg.get("refusal"), "message.refusal")
    finish = _text(c0.get("finish_reason"), "finish_reason")
    if finish in ("insufficient_system_resource", "aborted"):
        # DeepSeek: the provider ran out of capacity or cut the answer off. Not
        # the model's doing: an error (the party keeps its orders), not a reply.
        raise ClientError(f"the provider stopped the answer ({finish})")
    reasoning_text = _text(msg.get("reasoning_content"), "message.reasoning_content")
    usage = _obj(out.get("usage"), "usage")
    prompt = _tokens(usage, "prompt_tokens", "usage")
    completion = _tokens(usage, "completion_tokens", "usage")
    if prompt <= 0:
        raise _malformed("no input tokens counted for a request that had a prompt")
    pdet = usage.get("prompt_tokens_details")
    read = _tokens(_obj(pdet, "prompt_tokens_details"), "cached_tokens", "prompt_tokens_details", required=False) \
        if pdet is not None else 0
    if read > prompt:
        raise _malformed(f"{read} cached tokens out of {prompt} input tokens")
    cdet = usage.get("completion_tokens_details")
    reasoning = None
    if cdet is not None:
        cdet = _obj(cdet, "completion_tokens_details")
        if cdet.get("reasoning_tokens") is not None:
            reasoning = _tokens(cdet, "reasoning_tokens", "completion_tokens_details")
            if reasoning > completion:
                raise _malformed(f"{reasoning} reasoning tokens out of {completion} output tokens")
    return Reply(text, prompt, completion, time.monotonic() - t0, cache_read_tokens=read,
                 truncated=finish == "length", refused=bool(refusal) or finish == "content_filter",
                 thinking=reasoning_text[:4000],
                 model=_text(out.get("model"), "model"), stop_reason=finish, request_id=_text(out.get("id"), "id"),
                 reasoning_tokens=reasoning, service_tier=_text(out.get("service_tier"), "service_tier"))


# Gemini: why a candidate stopped. MAX_TOKENS is a cut-off reply; these mean
# Google's safety systems withheld it (a refusal: the party keeps its orders).
_GEMINI_REFUSED = {"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"}


def _read_gemini(out, t0: float) -> "Reply":
    out = _obj(out, "the response")
    u = _obj(out.get("usageMetadata"), "usageMetadata")
    prompt = _tokens(u, "promptTokenCount", "usageMetadata")  # includes the cached part
    if prompt <= 0:
        raise _malformed("no input tokens counted for a request that had a prompt")
    read = _tokens(u, "cachedContentTokenCount", "usageMetadata", required=False)
    if read > prompt:
        raise _malformed(f"{read} cached tokens out of {prompt} input tokens")
    answer = _tokens(u, "candidatesTokenCount", "usageMetadata", required=False)
    thoughts = _tokens(u, "thoughtsTokenCount", "usageMetadata", required=False)
    model = _text(out.get("modelVersion"), "modelVersion")
    rid = _text(out.get("responseId"), "responseId")
    block = _text(_obj(out.get("promptFeedback") or {}, "promptFeedback").get("blockReason"), "blockReason")
    cands = out.get("candidates") or []
    if not isinstance(cands, list):
        raise _malformed("'candidates' is not a list")
    if not cands:
        if not block:
            raise _malformed("no candidates and no block reason")
        return Reply("", prompt, answer + thoughts, time.monotonic() - t0, cache_read_tokens=read, refused=True,
                     model=model, stop_reason=f"blocked:{block}", request_id=rid, reasoning_tokens=thoughts)
    c0 = _obj(cands[0], "candidates[0]")
    finish = _text(c0.get("finishReason"), "finishReason")
    parts = _obj(c0.get("content") or {}, "candidates[0].content").get("parts") or []
    if not isinstance(parts, list):
        raise _malformed("'parts' is not a list")
    text, thinking = [], []
    for i, p in enumerate(parts):
        p = _obj(p, f"parts[{i}]")
        (thinking if p.get("thought") is True else text).append(_text(p.get("text"), f"parts[{i}].text"))
    # Thinking is billed as output (Google's pricing page), so it counts in the output tokens.
    return Reply("".join(text), prompt, answer + thoughts, time.monotonic() - t0, cache_read_tokens=read,
                 truncated=finish == "MAX_TOKENS", refused=finish in _GEMINI_REFUSED,
                 thinking="".join(thinking)[:4000], model=model, stop_reason=finish, request_id=rid,
                 reasoning_tokens=thoughts)


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
        return _strict(_read_anthropic, out, t0)

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
                     # The Standard tier, as priced in spend.PRICES (not whatever
                     # tier the project defaults to); the served tier is recorded.
                     "service_tier": "default",
                     **({"reasoning_effort": self.effort} if self.effort else {}),
                     "messages": [{"role": "system", "content": system},
                                  {"role": "user", "content": user}]})
        return _strict(_read_openai, out, t0)


@dataclass
class GeminiClient:
    """Google's Gemini API (generateContent). Gemini 3 and later always think;
    the effort is the lab's own thinking level (low/medium/high)."""
    model: str
    effort: str | None = None
    max_tokens: int = MAX_OUTPUT_TOKENS  # maxOutputTokens counts thinking too (Google's thinking guide)
    spec: str = ""

    def __post_init__(self) -> None:
        self.spec = f"google:{self.model}" + (f"@{self.effort}" if self.effort else "")
        if self.effort in ("none", "max"):
            raise ClientError(f"{self.model}: thinking can't be turned off or set to max; use low, medium or high",
                              fatal=True)

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        t0 = time.monotonic()
        cfg: dict = {"maxOutputTokens": self.max_tokens, "thinkingConfig": {"includeThoughts": True}}
        if self.effort:
            cfg["thinkingConfig"]["thinkingLevel"] = self.effort
        # Implicit caching is automatic: the rules come first so repeated calls share a prefix.
        out = _post(f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                    {"x-goog-api-key": _key("GEMINI_API_KEY")},
                    {"systemInstruction": {"parts": [{"text": system}]},
                     "contents": [{"role": "user", "parts": [{"text": user}]}],
                     "generationConfig": cfg})
        return _strict(_read_gemini, out, t0)


def _deepseek_effort(effort: str) -> dict:
    # DeepSeek's levels are none/low/high/max; it maps medium to high itself
    # (its thinking-mode guide), and so do we, explicitly.
    level = {"none": "none", "low": "low", "medium": "high", "high": "high", "xhigh": "max", "max": "max"}[effort]
    return {"thinking": {"type": "disabled" if level == "none" else "enabled"}, "reasoning_effort": level}


def _qwen_effort(effort: str) -> dict:
    # Qwen has thinking on or off, no levels: any effort but none means on, at
    # the lab's default depth (no thinking_budget).
    return {"enable_thinking": effort != "none"}


def _dashscope_url() -> str:
    # Model Studio endpoints are per workspace and region, e.g.
    # https://<workspace>.us-east-1.maas.aliyuncs.com/compatible-mode/v1
    base = _key("DASHSCOPE_BASE_URL").rstrip("/")
    if not base.startswith("https://"):
        raise ClientError("DASHSCOPE_BASE_URL must be the https:// compatible-mode/v1 URL of your workspace", fatal=True)
    return base + "/chat/completions"


def _read_xai(out, t0: float) -> "Reply":
    """xAI counts reasoning outside ``completion_tokens`` (total = prompt +
    completion + reasoning), bills it as output, and its API doesn't let a cap
    stop it (neither max_tokens nor max_completion_tokens limits reasoning,
    checked 2026-11-23). So the reasoning is added to the output, and the
    8,000-token cap every other model lives under is applied here: a reply
    whose reasoning and answer together pass it is cut off, as it would have
    been for any other model."""
    out = _obj(out, "the response")
    usage = _obj(out.get("usage"), "usage")
    cdet = usage.get("completion_tokens_details")
    reasoning = _tokens(_obj(cdet, "completion_tokens_details"), "reasoning_tokens", "completion_tokens_details",
                        required=False) if cdet is not None else 0
    answer = _tokens(usage, "completion_tokens", "usage")
    total = _tokens(usage, "total_tokens", "usage", required=False)
    prompt = _tokens(usage, "prompt_tokens", "usage")
    if total and total != prompt + answer + reasoning:
        raise _malformed(f"total {total} is not prompt {prompt} + completion {answer} + reasoning {reasoning}")
    out = {**out, "usage": {**usage, "completion_tokens": answer + reasoning}}
    r = _read_openai(out, t0)
    if r.output_tokens > MAX_OUTPUT_TOKENS:
        r.truncated, r.text = True, ""
    return r


# Labs that speak OpenAI's chat-completions format: where to send it, the key,
# and how the effort is said. Everything else (the prompt, the reply contract,
# the parser) is the same for every lab.
_COMPAT = {
    "xai": {"url": lambda: "https://api.x.ai/v1/chat/completions", "key": "XAI_API_KEY", "read": _read_xai,
            "effort": lambda e: {"reasoning_effort": e},
            # Route requests that share the rules to the same cache (xAI's routing header).
            "headers": lambda system: {"x-grok-conv-id": _cache_key(system)}},
    "deepseek": {"url": lambda: "https://api.deepseek.com/chat/completions", "key": "DEEPSEEK_API_KEY",
                 "effort": _deepseek_effort, "headers": lambda system: {}},
    "alibaba": {"url": _dashscope_url, "key": "DASHSCOPE_API_KEY",
                "effort": _qwen_effort, "headers": lambda system: {}},
}


@dataclass
class CompatClient:
    """A lab with an OpenAI-compatible chat-completions API (xAI, DeepSeek, Alibaba)."""
    provider: str
    model: str
    effort: str | None = None
    max_tokens: int = MAX_OUTPUT_TOKENS
    spec: str = ""

    def __post_init__(self) -> None:
        self.spec = f"{self.provider}:{self.model}" + (f"@{self.effort}" if self.effort else "")

    def complete(self, system: str, user: str, tag: str = "") -> Reply:
        lab = _COMPAT[self.provider]
        t0 = time.monotonic()
        out = _post(lab["url"](), {"authorization": f"Bearer {_key(lab['key'])}", **lab["headers"](system)},
                    {"model": self.model, "max_tokens": self.max_tokens,
                     **(lab["effort"](self.effort) if self.effort else {}),
                     "messages": [{"role": "system", "content": system},
                                  {"role": "user", "content": user}]})
        return _strict(lab.get("read", _read_openai), out, t0)


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
    if provider == "google":
        return GeminiClient(model, effort)
    if provider in _COMPAT:
        return CompatClient(provider, model, effort)
    if provider == "mock":
        return MockClient(model)
    if provider == "scripted":
        from .scripted import ScriptedCommander
        return ScriptedCommander(model)
    raise ClientError(f"unknown provider {provider!r} (use anthropic, openai, google, xai, deepseek, alibaba, "
                      "scripted, or mock)")


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
                     request_id=r.get("request_id", ""), reasoning_tokens=r.get("reasoning_tokens"),
                     service_tier=r.get("service_tier", ""))

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
                            "reasoning_tokens": reply.reasoning_tokens, "service_tier": reply.service_tier})
            return reply
        finally:
            with rec.lock:
                rec.inflight.pop(k).set()
