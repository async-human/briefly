from __future__ import annotations

import asyncio
import re
from urllib.parse import urljoin, urlparse

import httpx
import trafilatura

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _fetch_page_sync(url: str) -> tuple[str, str]:
    with httpx.Client(
        timeout=25.0,
        follow_redirects=True,
        headers={"User-Agent": _BROWSER_UA, "Accept-Language": "en-US,en;q=0.9"},
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return str(resp.url), resp.text


def _extract_article_sync(url: str, html: str) -> NormalizedContent | None:
    from briefly_api.services.articles import NormalizedContent

    extracted = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=False,
        output_format="json",
        with_metadata=True,
    )
    if not extracted:
        return None

    import json

    data = json.loads(extracted)
    title = (data.get("title") or "Untitled").strip()
    text = (data.get("text") or "").strip()
    if not text:
        return None

    hostname = urlparse(url).netloc.removeprefix("www.")
    return NormalizedContent(
        title=title,
        url=data.get("url") or url,
        source_name=hostname,
        source_type="url",
        section="Web",
        author=data.get("author"),
        clean_text=text,
        summary=text[:400],
    )


def _discover_rss_sync(page_url: str, html: str) -> str | None:
    match = re.search(
        r'<link[^>]+type=["\']application/(?:rss|atom)\+xml["\'][^>]+href=["\']([^"\']+)["\']',
        html,
        re.IGNORECASE,
    )
    if not match:
        match = re.search(
            r'<link[^>]+href=["\']([^"\']+)["\'][^>]+type=["\']application/(?:rss|atom)\+xml["\']',
            html,
            re.IGNORECASE,
        )
    if match:
        return urljoin(page_url, match.group(1))
    return None


async def scrape_url(url: str) -> list[NormalizedContent]:
    final_url, html = await asyncio.to_thread(_fetch_page_sync, url)
    article = await asyncio.to_thread(_extract_article_sync, final_url, html)
    if article:
        return [article]
    raise ValueError(f"Could not extract readable content from {url}")


async def discover_rss_feed(url: str) -> str | None:
    final_url, html = await asyncio.to_thread(_fetch_page_sync, url)
    return await asyncio.to_thread(_discover_rss_sync, final_url, html)
