"""Language-model agents for MythicBench.

``LLMPolicy`` plugs a chat model into the same slot the scripted bots use: it
reads the same observations and returns the same ``Action``s, so models are
judged by exactly the same rules.

Pieces:
  clients.py  - tiny stdlib HTTP clients for Anthropic and OpenAI, plus a
                response cache that makes model runs replayable
  prompt.py   - game rules -> system prompt, observation -> state text,
                model reply -> validated orders
  policy.py   - the party "brain": decides when to call the model and turns
                its orders into per-tick actions
"""

# Bump whenever anything the model sees or can do changes (prompt text, state
# rendering, triggers, controls). Runs record it, so results from different
# harness versions are never silently compared.
#   0.3.0  safe moves, pool perception, 350 ms kick reaction, effort settings
#   0.4.0  0-100 score described in the rules; key levels; blind knowledge
HARNESS_VERSION = "0.4.0"


def prompt_hash(knowledge: str = "full", level: int = 12) -> str:
    """Short fingerprint of the exact rules text the model receives (before any notes)."""
    import hashlib
    from .prompt import system_prompt
    return hashlib.sha256(system_prompt(knowledge, level=level).encode()).hexdigest()[:10]
