"""Language-model agents for MythicBench.

``LLMPolicy`` plugs a chat model into the same slot the scripted bots use: it
reads the same observations and returns the same ``Action``s, so models are
judged by exactly the same rules.

Pieces:
  clients.py  - tiny stdlib HTTP clients for Anthropic and OpenAI, plus a
                response cache that makes model runs replayable
  prompt.py   - game rules -> system prompt, observation -> state text,
                model reply -> validated orders
  policy.py   - five agents, one per character: when each is asked, party
                chat, and turning its orders into per-tick actions
  progress.py - pulls, the party's talk between pulls, each agent's notes
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
#   0.9.0  five agents (one per character) with party chat; between pulls a
#          party talk and private per-agent notes, with no guidance on what to
#          learn; only timed clears end an episode; no OpenAI JSON mode
#          (same reply contract for both providers); recorded replies tagged
#          by episode/pull/agent/call
#   0.10.0 audit fixes: a run ends at the timer and a clear needs every pack;
#          no boss timing in the blind rules; talk and notes get their own
#          instructions and reply format; strict reply checks (finite
#          coordinates, friend/foe targets, "ready" must be true); notes
#          marked off as notes; party chat capped at 255 characters
#   0.10.1 replies: the last complete orders object is read (thinking out loud
#          first is fine); an empty {} means "no change"
#   0.11.0 party chat: one message per character every 10 s (typing takes
#          time); the state says when you can type again
HARNESS_VERSION = "0.11.0"


def prompt_hash(knowledge: str = "full", tier: str = "plus10", mode: str = "boss") -> str:
    """Short fingerprint of the exact rules texts the five agents receive (before any notes)."""
    import hashlib
    from .. import content as C
    from .prompt import system_prompt
    texts = [system_prompt(knowledge, tier=tier, mode=mode, me=m.id) for m in C.PARTY]
    return hashlib.sha256("\n\0".join(texts).encode()).hexdigest()[:10]
