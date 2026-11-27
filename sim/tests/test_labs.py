"""The clients for Google, xAI, DeepSeek and Alibaba (v1 ran xAI and DeepSeek;
see docs/PREREGISTRATION.md): what each request asks for, and how each answer is read.
No network: urlopen is replaced by a fake that records the request and returns
a response in the shape the lab's docs give."""

from __future__ import annotations

import io
import json

import pytest

from mythicsim import spend
from mythicsim.llm import clients as cl


class Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def fake(monkeypatch):
    """Answers every request with ``fake.body``; ``fake.sent`` holds the last request."""
    class F:
        body: dict = {}
        sent: dict = {}
        url = ""
        headers: dict = {}
    f = F()

    def urlopen(req, timeout=0):
        f.sent, f.url, f.headers = json.loads(req.data), req.full_url, {k.lower(): v for k, v in req.header_items()}
        return Resp(json.dumps(f.body).encode())
    monkeypatch.setattr(cl.urllib.request, "urlopen", urlopen)
    for k in ("GEMINI_API_KEY", "XAI_API_KEY", "DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY"):
        monkeypatch.setenv(k, "test")
    monkeypatch.setenv("DASHSCOPE_BASE_URL", "https://ws.us-east-1.maas.aliyuncs.com/compatible-mode/v1/")
    return f


def _chat(content="{}", finish="stop", **usage):
    return {"id": "r1", "model": "m", "choices": [{"message": {"content": content}, "finish_reason": finish}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 20, **usage}}


def test_every_new_model_has_a_price():
    for m in ("gemini-3.8-flash", "grok-4.3", "deepseek-flash", "qwen4-max"):
        assert m in spend.PRICES


@pytest.mark.parametrize("spec, cls", [("google:gemini-3.8-flash@medium", cl.GeminiClient),
                                       ("xai:grok-4.3@medium", cl.CompatClient),
                                       ("deepseek:deepseek-flash@medium", cl.CompatClient),
                                       ("alibaba:qwen4-max@medium", cl.CompatClient)])
def test_specs_make_the_right_client(spec, cls):
    c = cl.make_client(spec)
    assert isinstance(c, cls) and c.spec == spec


def test_gemini_request_and_reply(fake):
    fake.body = {
        "candidates": [{"content": {"parts": [{"text": "plan", "thought": True}, {"text": '{"say": "hi"}'}]},
                        "finishReason": "STOP"}],
        "usageMetadata": {"promptTokenCount": 5000, "cachedContentTokenCount": 4096,
                          "candidatesTokenCount": 30, "thoughtsTokenCount": 400},
        "modelVersion": "gemini-3.8-flash", "responseId": "abc"}
    r = cl.make_client("google:gemini-3.8-flash@medium").complete("rules", "state")
    assert fake.url.endswith("/models/gemini-3.8-flash:generateContent")
    assert fake.headers["x-goog-api-key"] == "test"
    assert fake.sent["systemInstruction"]["parts"][0]["text"] == "rules"
    cfg = fake.sent["generationConfig"]
    assert cfg["maxOutputTokens"] == cl.MAX_OUTPUT_TOKENS and cfg["thinkingConfig"]["thinkingLevel"] == "medium"
    # Thoughts are kept apart from the answer, and billed as output.
    assert r.text == '{"say": "hi"}' and r.thinking == "plan"
    assert (r.input_tokens, r.cache_read_tokens, r.output_tokens, r.reasoning_tokens) == (5000, 4096, 430, 400)
    assert r.model == "gemini-3.8-flash" and not r.truncated and not r.refused


@pytest.mark.parametrize("body, truncated, refused", [
    ({"candidates": [{"content": {"parts": [{"text": "{"}]}, "finishReason": "MAX_TOKENS"}]}, True, False),
    ({"candidates": [{"finishReason": "SAFETY"}]}, False, True),
    ({"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}}, False, True),
])
def test_gemini_cutoffs_and_refusals(fake, body, truncated, refused):
    fake.body = {**body, "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 0}}
    r = cl.make_client("google:gemini-3.8-flash@medium").complete("s", "u")
    assert (r.truncated, r.refused) == (truncated, refused)


def test_gemini_cannot_turn_thinking_off():
    with pytest.raises(cl.ClientError):
        cl.make_client("google:gemini-3.8-flash@none")


def test_gemini_answer_without_usage_is_malformed(fake):
    fake.body = {"candidates": [{"content": {"parts": [{"text": "{}"}]}, "finishReason": "STOP"}]}
    with pytest.raises(cl.ClientError, match="malformed"):
        cl.make_client("google:gemini-3.8-flash@medium").complete("s", "u")


def test_xai_request(fake):
    # As xAI really answers (2026-11-23): reasoning is counted outside completion_tokens.
    fake.body = _chat(total_tokens=100 + 20 + 395, prompt_tokens_details={"cached_tokens": 64},
                      completion_tokens_details={"reasoning_tokens": 395})
    r = cl.make_client("xai:grok-4.3@medium").complete("rules", "state")
    assert fake.url == "https://api.x.ai/v1/chat/completions"
    assert fake.sent["reasoning_effort"] == "medium" and fake.sent["max_tokens"] == cl.MAX_OUTPUT_TOKENS
    assert fake.headers["x-grok-conv-id"] == cl._cache_key("rules")
    # Reasoning is billed as output, so it counts in the output tokens.
    assert (r.cache_read_tokens, r.reasoning_tokens, r.output_tokens) == (64, 395, 415)
    assert r.text == "{}" and not r.truncated
    # 100 in (64 cached), 415 out at Grok 4.3's prices: xAI's own bill for the probe call matched this math.
    assert spend.PRICES["grok-4.3"].reply_cost(r) == pytest.approx((36 * 1.25 + 64 * 0.20 + 415 * 2.50) / 1e6)


def test_xai_reasoning_past_the_shared_cap_is_a_cut_off_reply(fake):
    """xAI's API can't cap reasoning, so the cap every other model has is applied when reading."""
    fake.body = _chat(completion_tokens=50, completion_tokens_details={"reasoning_tokens": cl.MAX_OUTPUT_TOKENS})
    r = cl.make_client("xai:grok-4.3@medium").complete("s", "u")
    assert r.truncated and r.text == "" and r.output_tokens == cl.MAX_OUTPUT_TOKENS + 50


def test_xai_inconsistent_totals_are_malformed(fake):
    fake.body = _chat(total_tokens=999, completion_tokens_details={"reasoning_tokens": 5})
    with pytest.raises(cl.ClientError, match="malformed"):
        cl.make_client("xai:grok-4.3@medium").complete("s", "u")


def test_the_guard_reserves_for_groks_uncapped_reasoning():
    grok, other = spend.PRICES["grok-4.3"], spend.PRICES["deepseek-flash"]
    assert grok.max_output and grok.max_output > cl.MAX_OUTPUT_TOKENS
    assert spend.worst_case_usd(grok, "s", "u") >= grok.max_output * grok.output / 1e6
    assert other.max_output is None


def test_deepseek_maps_medium_to_its_high_and_keeps_reasoning(fake):
    body = _chat(prompt_tokens_details={"cached_tokens": 80})
    body["choices"][0]["message"]["reasoning_content"] = "thinking it over"
    fake.body = body
    r = cl.make_client("deepseek:deepseek-flash@medium").complete("s", "u")
    assert fake.url == "https://api.deepseek.com/chat/completions"
    assert fake.sent["reasoning_effort"] == "high" and fake.sent["thinking"] == {"type": "enabled"}
    assert r.thinking == "thinking it over" and r.cache_read_tokens == 80


def test_deepseek_capacity_abort_is_an_error_not_a_reply(fake):
    fake.body = _chat(finish="insufficient_system_resource")
    with pytest.raises(cl.ClientError, match="insufficient_system_resource"):
        cl.make_client("deepseek:deepseek-flash@medium").complete("s", "u")


def test_qwen_goes_to_the_workspace_endpoint_with_thinking_on(fake):
    fake.body = _chat()
    cl.make_client("alibaba:qwen4-max@medium").complete("s", "u")
    assert fake.url == "https://ws.us-east-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions"
    assert fake.sent["enable_thinking"] is True and "thinking_budget" not in fake.sent


def test_qwen_needs_its_endpoint(monkeypatch, fake):
    monkeypatch.setenv("DASHSCOPE_BASE_URL", "http://insecure.example")
    with pytest.raises(cl.ClientError):
        cl.make_client("alibaba:qwen4-max@medium").complete("s", "u")


def test_the_prompt_and_reply_contract_are_the_same_for_every_lab(fake):
    """Every lab gets the same two messages and no JSON mode or extra instructions."""
    fake.body = _chat()
    for spec in ("xai:grok-4.3@medium", "deepseek:deepseek-flash@medium", "alibaba:qwen4-max@medium"):
        cl.make_client(spec).complete("RULES", "STATE")
        assert fake.sent["messages"] == [{"role": "system", "content": "RULES"}, {"role": "user", "content": "STATE"}]
        assert "response_format" not in fake.sent and "tools" not in fake.sent
