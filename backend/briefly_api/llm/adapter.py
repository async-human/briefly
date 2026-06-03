"""
briefly_api/llm/adapter.py

Provider-agnostic LLM adapter.
Switch provider + model entirely from .env — zero code changes.

Supported providers:
  anthropic  → Claude (claude-sonnet-4-5, claude-opus-4-5, etc.)
  openai     → GPT-4o, GPT-4o-mini, etc.
  groq       → Llama 3.1, Mixtral, etc.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from briefly_api.config import Settings, get_settings

log = logging.getLogger(__name__)


@dataclass
class Message:
    role: str   # "user" | "assistant" | "system"
    content: str


@dataclass
class LLMResponse:
    content: str
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""
    provider: str = ""


class LLMAdapter:
    """
    Single interface for all LLM providers.
    Instantiate once and reuse — handles retries internally.
    """

    def __init__(self, settings: Settings | None = None):
        self._s = settings or get_settings()

    # ── Public API ────────────────────────────────────────────────────────────

    async def complete(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        json_mode: bool = False,
        cached_prefix: str | None = None,
    ) -> LLMResponse:
        """
        Send a chat completion request to the configured provider.

        Args:
            messages:       Conversation history (role + content)
            system:         System prompt (prepended automatically)
            model:          Override model from config (optional)
            temperature:    Override temperature (optional)
            max_tokens:     Override max_tokens (optional)
            json_mode:      If True, instruct model to return valid JSON only
            cached_prefix:  Stable leading text of the first user message to mark
                            for Anthropic prompt caching (ignored by other providers)
        """
        provider = self._s.llm_provider
        _model = model or self._s.llm_model
        _temp = temperature if temperature is not None else self._s.llm_temperature
        _max = max_tokens or self._s.llm_max_tokens

        if json_mode:
            json_instruction = "\n\nIMPORTANT: Respond with ONLY valid JSON. No markdown fences, no preamble, no explanation."
            if system:
                system = system + json_instruction
            else:
                system = json_instruction.strip()

        log.debug("LLM call: provider=%s model=%s msgs=%d", provider, _model, len(messages))

        if provider == "anthropic":
            return await self._anthropic(
                messages, system=system, model=_model, temperature=_temp,
                max_tokens=_max, cached_prefix=cached_prefix,
            )
        elif provider == "openai":
            return await self._openai(messages, system=system, model=_model, temperature=_temp, max_tokens=_max, json_mode=json_mode)
        elif provider == "groq":
            return await self._groq(messages, system=system, model=_model, temperature=_temp, max_tokens=_max)
        else:
            raise ValueError(f"Unknown LLM provider: {provider}")

    async def complete_json(
        self,
        messages: list[Message],
        *,
        system: str | None = None,
        model: str | None = None,
        max_tokens: int | None = None,
        cached_prefix: str | None = None,
    ) -> Any:
        """
        Convenience method: complete + parse JSON response.
        Strips markdown fences if present. Raises ValueError on parse failure.
        """
        resp = await self.complete(
            messages, system=system, model=model, json_mode=True,
            max_tokens=max_tokens, cached_prefix=cached_prefix,
        )
        raw = resp.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            log.error("JSON parse failed. Raw: %s", raw[:500])
            raise ValueError(f"LLM returned invalid JSON: {e}") from e

    # ── Anthropic ─────────────────────────────────────────────────────────────

    @retry(
        retry=retry_if_exception_type(httpx.TimeoutException),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        stop=stop_after_attempt(2),
        reraise=True,
    )
    async def _anthropic(
        self,
        messages: list[Message],
        *,
        system: str | None,
        model: str,
        temperature: float,
        max_tokens: int,
        cached_prefix: str | None = None,
    ) -> LLMResponse:
        if not self._s.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")

        # Build message payload — support structured content blocks so we can
        # attach cache_control to the stable prefix without touching the variable
        # items section. This gives Anthropic prompt caching a hit on every retry
        # and repeated same-day pipeline runs.
        if cached_prefix and len(messages) == 1 and messages[0].role == "user":
            remaining = messages[0].content[len(cached_prefix):].lstrip()
            api_messages: list[dict] = [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": cached_prefix,
                            "cache_control": {"type": "ephemeral"},
                        },
                        {"type": "text", "text": remaining},
                    ],
                }
            ]
        else:
            api_messages = [{"role": m.role, "content": m.content} for m in messages]

        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": api_messages,
        }

        # System prompt is always static — cache it to shave token processing time
        # on every call. Requires the prompt-caching beta header.
        if system:
            payload["system"] = [
                {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
            ]

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self._s.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                    "anthropic-beta": "prompt-caching-2024-07-31",
                    "content-type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        content = "".join(
            block.get("text", "")
            for block in data.get("content", [])
            if block.get("type") == "text"
        )
        usage = data.get("usage", {})
        cache_read = usage.get("cache_read_input_tokens", 0)
        if cache_read:
            log.debug("Anthropic prompt cache hit: %d tokens read from cache", cache_read)
        return LLMResponse(
            content=content,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            model=model,
            provider="anthropic",
        )

    # ── OpenAI ────────────────────────────────────────────────────────────────

    @retry(
        retry=retry_if_exception_type(httpx.TimeoutException),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        stop=stop_after_attempt(2),
        reraise=True,
    )
    async def _openai(
        self,
        messages: list[Message],
        *,
        system: str | None,
        model: str,
        temperature: float,
        max_tokens: int,
        json_mode: bool = False,
    ) -> LLMResponse:
        if not self._s.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not set")

        all_messages = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend({"role": m.role, "content": m.content} for m in messages)

        payload: dict[str, Any] = {
            "model": model,
            "messages": all_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._s.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        return LLMResponse(
            content=content,
            input_tokens=usage.get("prompt_tokens", 0),
            output_tokens=usage.get("completion_tokens", 0),
            model=model,
            provider="openai",
        )

    # ── Groq ──────────────────────────────────────────────────────────────────

    @retry(
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _groq(
        self,
        messages: list[Message],
        *,
        system: str | None,
        model: str,
        temperature: float,
        max_tokens: int,
    ) -> LLMResponse:
        if not self._s.groq_api_key:
            raise RuntimeError("GROQ_API_KEY not set")

        all_messages = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend({"role": m.role, "content": m.content} for m in messages)

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._s.groq_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": all_messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        return LLMResponse(
            content=content,
            input_tokens=usage.get("prompt_tokens", 0),
            output_tokens=usage.get("completion_tokens", 0),
            model=model,
            provider="groq",
        )


# ── Module-level factory ──────────────────────────────────────────────────────

def get_llm_adapter(settings: Settings | None = None) -> LLMAdapter:
    return LLMAdapter(settings or get_settings())
