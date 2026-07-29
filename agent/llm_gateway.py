"""Single choke point for LLM provider resolution.

Every LLM call site in WhatsBot — the agentic engine (``agent/agno_engine.py``),
the non-agentic direct calls in ``agent/handler.py`` (transcription, image
description, document reading, "sugerir melhoria"), and the config routes
(``/api/models``, ``/api/config/test-key``, ``/api/balance``) — resolves
``(provider, base_url, api_key)`` through :func:`resolve` instead of importing
``LLM_API_BASE_URL``/``openrouter_api_key`` directly. This is what lets a new
provider be added later (OpenAI, Gemini, Claude — see CLAUDE.md) by extending
this one function, without touching every call site again.

Two providers today:

* ``techify`` (default) — the Techify LLM proxy, OpenRouter/OpenAI-compatible,
  provisioned by the first-run setup wizard. Key stored under the legacy
  config key ``openrouter_api_key``.
* ``openrouter`` — OpenRouter's API directly. Key stored under
  ``openrouter_direct_api_key`` (kept separate from the Techify key so
  switching providers back and forth never clobbers either key). The
  wizard/low-balance/account_url flow is Techify-specific; see
  ``server/balance_monitor.py`` for how that's handled for this provider.
"""

from __future__ import annotations

from config.settings import LLM_API_BASE_URL, OPENROUTER_DIRECT_BASE_URL

PROVIDERS = ("techify", "openrouter")


def resolve(settings) -> tuple[str, str, str]:
    """Return ``(provider, base_url, api_key)`` for the configured provider."""
    provider = settings.get("llm_provider", "techify")
    if provider not in PROVIDERS:
        provider = "techify"
    if provider == "openrouter":
        return provider, OPENROUTER_DIRECT_BASE_URL, settings.get("openrouter_direct_api_key", "") or ""
    return provider, LLM_API_BASE_URL, settings.get("openrouter_api_key", "") or ""


def base_url_for(provider: str) -> str:
    """Return the base URL for an explicit provider name (fallback: techify)."""
    if provider == "openrouter":
        return OPENROUTER_DIRECT_BASE_URL
    return LLM_API_BASE_URL
