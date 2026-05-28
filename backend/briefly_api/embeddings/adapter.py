"""
briefly_api/embeddings/adapter.py

Provider-agnostic embedding adapter.
Switch between Voyage and OpenAI from .env.

voyage-3:              1024 dims — best for semantic content matching
text-embedding-3-small: 1536 dims — good fallback if no Voyage key
"""
from __future__ import annotations

import logging

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from briefly_api.config import Settings, get_settings

log = logging.getLogger(__name__)

VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
OPENAI_URL = "https://api.openai.com/v1/embeddings"


class EmbeddingAdapter:

    def __init__(self, settings: Settings | None = None):
        self._s = settings or get_settings()

    async def embed(self, text: str) -> list[float]:
        """Embed a single string. Returns list of floats."""
        results = await self.embed_batch([text])
        return results[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple strings efficiently."""
        if not texts:
            return []
        provider = self._s.embedding_provider
        if provider == "voyage":
            return await self._voyage(texts)
        return await self._openai(texts)

    def embed_text_for_content(self, title: str, summary: str, source_name: str = "") -> str:
        """
        Produce the string to embed for a piece of content.
        Combines the most discriminative fields.
        """
        parts = [p for p in [title, source_name, summary] if p]
        return " | ".join(parts)

    def embed_text_for_profile(self, profile_data: dict) -> str:
        """
        Produce the string to embed for a user profile.
        Used for semantic matching against content.
        """
        parts = []
        if profile_data.get("role"):
            parts.append(f"role: {profile_data['role']}")
        if profile_data.get("goal"):
            parts.append(f"goal: {profile_data['goal']}")
        interests = profile_data.get("interests", [])
        if interests:
            topics = " ".join(i.get("topic", "") for i in interests if i.get("topic"))
            parts.append(f"interests: {topics}")
        clusters = profile_data.get("topic_clusters", [])
        if clusters:
            cluster_names = " ".join(c.get("cluster", "") for c in clusters)
            parts.append(f"topics: {cluster_names}")
        return " | ".join(parts)

    @retry(
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=20),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _voyage(self, texts: list[str]) -> list[list[float]]:
        if not self._s.voyage_api_key:
            log.warning("VOYAGE_API_KEY not set — falling back to OpenAI embeddings")
            return await self._openai(texts)
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                VOYAGE_URL,
                headers={"Authorization": f"Bearer {self._s.voyage_api_key}", "Content-Type": "application/json"},
                json={"input": texts, "model": self._s.embedding_model},
            )
            resp.raise_for_status()
            data = resp.json()
        return [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]

    @retry(
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TimeoutException)),
        wait=wait_exponential(multiplier=1, min=2, max=20),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _openai(self, texts: list[str]) -> list[list[float]]:
        if not self._s.openai_api_key:
            raise RuntimeError("No embedding API key configured (set VOYAGE_API_KEY or OPENAI_API_KEY)")
        model = "text-embedding-3-small" if self._s.embedding_provider != "openai" else self._s.embedding_model
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                OPENAI_URL,
                headers={"Authorization": f"Bearer {self._s.openai_api_key}", "Content-Type": "application/json"},
                json={"input": texts, "model": model},
            )
            resp.raise_for_status()
            data = resp.json()
        return [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]


def get_embedding_adapter(settings: Settings | None = None) -> EmbeddingAdapter:
    return EmbeddingAdapter(settings or get_settings())
