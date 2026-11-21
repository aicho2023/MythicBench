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
#   0.5.0  dungeon run (map, packs, pulling, resting, "next" move)
#   0.6.0  difficulty tiers (Normal / +10) and affixes in the rules; pool kinds
#          and aura stacks in the state; "safe" works in every room
#   0.7.0  4 s routine check-ins; "include only changed orders"; 8,000-token
#          output cap; adaptive thinking with summaries; refusals recorded
#   0.8.0  harder tiers with per-tier timers; Grave Mark (+10) and its trigger
HARNESS_VERSION = "0.8.0"


def prompt_hash(knowledge: str = "full", tier: str = "plus10", mode: str = "boss") -> str:
    """Short fingerprint of the exact rules text the model receives (before any notes)."""
    import hashlib
    from .prompt import system_prompt
    return hashlib.sha256(system_prompt(knowledge, tier=tier, mode=mode).encode()).hexdigest()[:10]
