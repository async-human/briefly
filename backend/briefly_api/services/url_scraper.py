from __future__ import annotations

import asyncio
import json
import re
from urllib.parse import urljoin, urlparse

import httpx
import trafilatura

from briefly_api.services.articles import NormalizedContent

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class UrlFetchError(ValueError):
    """Raised when a URL cannot be fetched or parsed."""


def _browser_headers(url: str) -> dict[str, str]:
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    return {
        "User-Agent": _BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Referer": origin + "/",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Upgrade-Insecure-Requests": "1",
    }


def _friendly_status_error(url: str, status: int) -> UrlFetchError:
    host = urlparse(url).netloc.removeprefix("www.")
    if status == 403:
        return UrlFetchError(
            f"{host} blocks automated access (403). "
            "Try an RSS feed URL for this site instead, or pick a different source."
        )
    if status == 404:
        return UrlFetchError(f"Page not found (404): {url}")
    if status == 429:
        return UrlFetchError(f"{host} is rate-limiting requests. Try again later.")
    return UrlFetchError(f"{host} returned HTTP {status}.")


def _fetch_page_sync(url: str) -> tuple[str, str]:
    last_error: Exception | None = None
    for referer in (url, "https://www.google.com/"):
        headers = _browser_headers(url)
        headers["Referer"] = referer
        try:
            with httpx.Client(timeout=25.0, follow_redirects=True, headers=headers) as client:
                resp = client.get(url)
                if resp.status_code == 403 and referer != "https://www.google.com/":
                    continue
                if resp.status_code >= 400:
                    raise _friendly_status_error(url, resp.status_code)
                return str(resp.url), resp.text
        except UrlFetchError:
            raise
        except httpx.HTTPStatusError as exc:
            last_error = exc
            if exc.response.status_code == 403:
                continue
            raise _friendly_status_error(url, exc.response.status_code) from exc
        except httpx.RequestError as exc:
            last_error = exc

    if last_error:
        raise UrlFetchError(f"Could not reach {url}: {last_error}") from last_error
    raise UrlFetchError(f"Could not reach {url}.")


def _extract_article_sync(url: str, html: str) -> NormalizedContent | None:
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


def _probe_url_sync(url: str) -> None:
    """Raise UrlFetchError if the URL is not reachable for scraping."""
    _fetch_page_sync(url)


async def probe_url(url: str) -> None:
    await asyncio.to_thread(_probe_url_sync, url)


async def scrape_url(url: str) -> list[NormalizedContent]:
    final_url, html = await asyncio.to_thread(_fetch_page_sync, url)
    article = await asyncio.to_thread(_extract_article_sync, final_url, html)
    if article:
        return [article]
    raise UrlFetchError(
        f"Could not extract readable content from {url}. "
        "The page may require login or use heavy JavaScript."
    )


async def discover_rss_feed(url: str) -> str | None:
    try:
        final_url, html = await asyncio.to_thread(_fetch_page_sync, url)
    except UrlFetchError:
        return None
    return await asyncio.to_thread(_discover_rss_sync, final_url, html)
