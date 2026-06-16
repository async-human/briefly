"""
briefly_api/services/web_search.py

Optional open-web search for the orb assistant.

By design Briefly answers from the user's *own* sources — that's the product's
spine. This is a deliberately bounded, clearly-labeled fallback for **explicit**
web requests ("search the web for…") and current facts the corpus can't cover.
It's OFF unless `WEB_SEARCH_ENABLED=true` and `WEB_SEARCH_API_KEY` are set, so the
default experience stays corpus-first.

Provider-agnostic: Tavily (LLM-search standard) or Brave Search, via config.
"""
from __future__ import annotations

import logging

import httpx

from briefly_api.config import Settings, get_settings

log = logging.getLogger(__name__)


async def web_search(query: str, *, settings: Settings | None = None) -> list[dict]:
    """
    Return a list of {title, url, snippet} for an explicit open-web query.
    Empty list if web search is disabled/unconfigured or the call fails — callers
    treat that as "I can only answer from your sources."
    """
    s = settings or get_settings()
    q = (query or "").strip()
    if not q or not s.web_search_enabled or not s.web_search_api_key:
        return []

    try:
        if s.web_search_provider == "tavily":
            return await _tavily(q, s)
        if s.web_search_provider == "brave":
            return await _brave(q, s)
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        log.warning("web_search failed (%s): %s", s.web_search_provider, exc)
    return []


async def _tavily(query: str, s: Settings) -> list[dict]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": s.web_search_api_key,
                "query": query,
                "max_results": s.web_search_max_results,
                "search_depth": "basic",
            },
        )
        resp.raise_for_status()
        data = resp.json()
    out: list[dict] = []
    for r in (data.get("results") or [])[: s.web_search_max_results]:
        out.append(
            {
                "title": str(r.get("title") or r.get("url") or "Result"),
                "url": r.get("url"),
                "snippet": str(r.get("content") or "")[:400],
            }
        )
    return out


async def _brave(query: str, s: Settings) -> list[dict]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": s.web_search_max_results},
            headers={
                "Accept": "application/json",
                "X-Subscription-Token": s.web_search_api_key,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    results = ((data.get("web") or {}).get("results")) or []
    out: list[dict] = []
    for r in results[: s.web_search_max_results]:
        out.append(
            {
                "title": str(r.get("title") or r.get("url") or "Result"),
                "url": r.get("url"),
                "snippet": str(r.get("description") or "")[:400],
            }
        )
    return out
