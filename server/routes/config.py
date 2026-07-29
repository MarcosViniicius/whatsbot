"""Configuration endpoints (config, test-key, models, status)."""

import asyncio
import logging
import time
from typing import Any

import httpx

from config.settings import LLM_API_BASE_URL
from server.auth import generate_salt, hash_password
from server.helpers import _ok, _err, _mask_key
from server import balance_monitor
from agent import group_mentions, llm_gateway
from plugins.events import emit as emit_event, emit_with_filter

logger = logging.getLogger(__name__)

# ── Models cache ──────────────────────────────────────────────
# Keyed by provider name ("techify" | "openrouter") — each entry is
# {"data": [...] | None, "fetched_at": float}.
_models_cache: dict[str, dict[str, Any]] = {}
_MODELS_CACHE_TTL = 600  # 10 minutes


def get_models_cache(provider: str = "techify") -> dict[str, Any]:
    """Expose models cache for pricing lookup (server/routes/usage.py)."""
    return _models_cache.setdefault(provider, {"data": None, "fetched_at": 0.0})


def register_routes(app, deps):
    settings = deps.settings
    agent_handler = deps.agent_handler
    ws_manager = deps.ws_manager
    state = deps.state

    @app.get("/api/config")
    async def get_config():
        return _ok({
            "openrouter_api_key": _mask_key(settings.get("openrouter_api_key", "")),
            "llm_provider": settings.get("llm_provider", "techify"),
            "openrouter_direct_api_key": _mask_key(settings.get("openrouter_direct_api_key", "")),
            "model": settings.get("model", "deepseek/deepseek-v4-pro"),
            "improvement_model": settings.get("improvement_model", ""),
            "audio_model": settings.get("audio_model", "google/gemini-2.5-flash"),
            "image_model": settings.get("image_model", "google/gemini-2.5-flash"),
            "document_model": settings.get("document_model", "google/gemini-2.5-flash"),
            "system_prompt": settings.get("system_prompt", ""),
            "group_reply_mode": settings.get("group_reply_mode", "mention_only"),
            "auto_reply": settings.get("auto_reply", True),
            "max_context_messages": settings.get("max_context_messages", 10),
            "message_batch_delay": settings.get("message_batch_delay", 3.0),
            "split_messages": settings.get("split_messages", True),
            "split_message_delay": settings.get("split_message_delay", 2.0),
            "audio_transcription_mode": settings.get("audio_transcription_mode", "received"),
            "audio_transcription_target": settings.get("audio_transcription_target", "private"),
            "audio_transcription_chat_prefix": settings.get("audio_transcription_chat_prefix", ""),
            "image_transcription_enabled": settings.get("image_transcription_enabled", True),
            "document_transcription_enabled": settings.get("document_transcription_enabled", True),
            "transfer_alert_enabled": settings.get("transfer_alert_enabled", True),
            "transfer_alert_duration": settings.get("transfer_alert_duration", 5),
            "max_executions": settings.get("max_executions", 200),
            "default_ai_enabled": settings.get("default_ai_enabled", True),
            "ai_engine_enabled": settings.get("ai_engine_enabled", False),
            "has_password": bool(settings.get("web_password_hash", "")),
            "setup_completed": settings.get("setup_completed", False),
            "account_url": settings.get("account_url", ""),
            "low_balance_enabled": settings.get("low_balance_enabled", True),
            "low_balance_threshold": settings.get("low_balance_threshold", 0.50),
            "ai_auto_resume_enabled": settings.get("ai_auto_resume_enabled", True),
            "ai_auto_resume_timeout_min": settings.get("ai_auto_resume_timeout_min", 30),
            "voice_reply_mode": settings.get("voice_reply_mode", "mirror"),
            "voice_reply_model": settings.get("voice_reply_model", ""),
            "voice_reply_voice": settings.get("voice_reply_voice", "alloy"),
        })

    @app.put("/api/config")
    async def save_config(body: dict):
        allowed_keys = {
            "openrouter_api_key", "llm_provider", "openrouter_direct_api_key",
            "model", "improvement_model",
            "audio_model", "image_model",
            "document_model",
            "audio_transcription_mode", "audio_transcription_target",
            "audio_transcription_chat_prefix", "image_transcription_enabled",
            "document_transcription_enabled",
            "system_prompt", "auto_reply",
            "max_context_messages", "message_batch_delay",
            "split_messages", "split_message_delay",
            "transfer_alert_enabled", "transfer_alert_duration",
            "group_reply_mode", "bot_phone",
            "max_executions", "default_ai_enabled", "setup_completed",
            "low_balance_enabled", "low_balance_threshold",
            "ai_engine_enabled",
            "ai_auto_resume_enabled", "ai_auto_resume_timeout_min",
            "voice_reply_mode", "voice_reply_model", "voice_reply_voice",
        }
        keys_changed = []
        for key, value in body.items():
            if key in allowed_keys:
                settings[key] = value
                keys_changed.append(key)

        # Handle password set/change/remove
        if "web_password" in body:
            raw_password = body["web_password"]
            if raw_password:
                salt = generate_salt()
                settings["web_password_hash"] = hash_password(raw_password, salt)
                settings["web_password_salt"] = salt
                logger.info("Web panel password set/changed.")
            else:
                settings["web_password_hash"] = ""
                settings["web_password_salt"] = ""
                logger.info("Web panel password removed.")

        settings.save()

        # Bot phone changed → refresh mention detection (the bot's display name
        # comes from GOWA, not config — see background.py).
        if "bot_phone" in keys_changed:
            group_mentions.set_bot_identity(state.bot_phone, state.bot_name)

        _, resolved_base_url, resolved_api_key = llm_gateway.resolve(settings)
        agent_handler.update_config(
            api_key=resolved_api_key,
            base_url=resolved_base_url,
            system_prompt=settings.get("system_prompt", ""),
            model=settings.get("model", "deepseek/deepseek-v4-pro"),
            improvement_model=settings.get("improvement_model", ""),
            audio_model=settings.get("audio_model", "google/gemini-2.5-flash"),
            image_model=settings.get("image_model", "google/gemini-2.5-flash"),
            document_model=settings.get("document_model", "google/gemini-2.5-flash"),
            voice_reply_mode=settings.get("voice_reply_mode", "mirror"),
            voice_reply_model=settings.get("voice_reply_model", ""),
            voice_reply_voice=settings.get("voice_reply_voice", "alloy"),
            max_context_messages=settings.get("max_context_messages", 10),
            split_messages=settings.get("split_messages", True),
            default_ai_enabled=settings.get("default_ai_enabled", True),
            ai_engine_enabled=settings.get("ai_engine_enabled", False),
        )

        await ws_manager.broadcast("config_saved", {})
        await emit_with_filter("config.changed", {
            "keys_changed": keys_changed,
            "ts": time.time(),
        })
        logger.info("Config saved.")
        return _ok({"message": "Configurações salvas!"})

    @app.post("/api/config/test-key")
    async def test_api_key(body: dict):
        api_key = body.get("api_key", "").strip()
        if not api_key:
            return _err("Insira uma API key primeiro.")
        # Tests against whichever provider the key is meant for — defaults to
        # the currently active one, but the panel passes it explicitly when
        # testing a key for the provider that ISN'T selected yet.
        provider = body.get("provider") or settings.get("llm_provider", "techify")
        if provider not in llm_gateway.PROVIDERS:
            provider = "techify"
        test_base_url = llm_gateway.base_url_for(provider)
        ok, msg = await asyncio.to_thread(agent_handler.test_api_key, api_key, test_base_url)
        # Auto-save valid key under the provider-scoped config field so testing
        # one provider's key never clobbers the other's.
        if ok:
            key_field = "openrouter_direct_api_key" if provider == "openrouter" else "openrouter_api_key"
            settings[key_field] = api_key
            settings.save()
            _, resolved_base_url, resolved_api_key = llm_gateway.resolve(settings)
            agent_handler.update_config(
                api_key=resolved_api_key,
                base_url=resolved_base_url,
                system_prompt=settings.get("system_prompt", ""),
                model=settings.get("model", "deepseek/deepseek-v4-pro"),
                audio_model=settings.get("audio_model", "google/gemini-2.5-flash"),
                image_model=settings.get("image_model", "google/gemini-2.5-flash"),
                document_model=settings.get("document_model", "google/gemini-2.5-flash"),
                max_context_messages=settings.get("max_context_messages", 10),
            )
            logger.info("API key tested and auto-saved for provider=%s.", provider)
        return _ok({"valid": ok, "message": msg})

    @app.get("/api/models")
    async def list_models(purpose: str | None = None):
        """Return model list for the active provider (cached for 10 min).

        Cache is keyed by (provider, purpose) so switching between Techify and
        OpenRouter — or between the regular catalog and a purpose-filtered one
        — never serves stale/wrong data. ``purpose="tts"`` asks the upstream
        catalog for text-to-speech-capable models (``output_modalities=speech``)
        instead of the general chat/vision catalog — a TTS model takes TEXT
        input, so filtering by *input* modality (like the audio-transcription
        picker does) would incorrectly return nothing useful for it.
        """
        provider, base_url, api_key = llm_gateway.resolve(settings)
        cache_key = f"{provider}:{purpose}" if purpose else provider
        now = time.time()
        cached = _models_cache.get(cache_key)
        if cached and cached["data"] and now - cached["fetched_at"] < _MODELS_CACHE_TTL:
            return _ok(cached["data"])
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        url = f"{base_url}/models"
        if purpose == "tts":
            url += "?output_modalities=speech"
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                raw = resp.json()
            models = []
            for m in raw.get("data", []):
                arch = m.get("architecture", {})
                models.append({
                    "id": m.get("id", ""),
                    "name": m.get("name", ""),
                    "input_modalities": arch.get("input_modalities", ["text"]),
                    "pricing": m.get("pricing", {}),
                })
            models.sort(key=lambda x: x["name"].lower())
            _models_cache[cache_key] = {"data": models, "fetched_at": now}
            return _ok(models)
        except Exception as e:
            logger.error("Failed to fetch models from %s: %s", url, e)
            if cached and cached["data"]:
                return _ok(cached["data"])
            return _err(f"Erro ao buscar modelos: {e}", status=502)

    @app.get("/api/balance")
    async def get_balance():
        """Return current LLM credit + threshold settings for the active provider.

        Used by the frontend on boot to seed the low-balance check before any
        message goes through; the live updates come via the ``low_balance`` WS
        event emitted by ``balance_monitor`` after LLM calls.
        """
        provider, base_url, api_key = llm_gateway.resolve(settings)
        if not api_key:
            return _err("API key não configurada.", status=400)
        balance = await balance_monitor.fetch_balance(api_key, base_url)
        if balance is None:
            cached = balance_monitor.get_cached()
            if cached is None:
                return _err("Não foi possível consultar o saldo.", status=502)
            balance = {
                "total_credits": cached.get("total_credits", 0.0),
                "total_usage": cached.get("total_usage", 0.0),
                "remaining": cached.get("remaining", 0.0),
            }
        threshold = float(settings.get("low_balance_threshold", 0.50) or 0.50)
        account_url = settings.get("account_url", "") or (
            "https://openrouter.ai/credits" if provider == "openrouter" else ""
        )
        return _ok({
            **balance,
            "threshold": threshold,
            "low_balance_enabled": bool(settings.get("low_balance_enabled", True)),
            "below_threshold": balance["remaining"] < threshold,
            "account_url": account_url,
        })

    @app.get("/api/status")
    async def get_status():
        return _ok({
            "connected": state.connected,
            "msg_count": state.msg_count,
            "auto_reply_running": state.auto_reply_running,
            "notification": state.notification,
            "bot_phone": state.bot_phone,
            "bot_name": state.bot_name,
        })
