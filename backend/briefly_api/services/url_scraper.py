from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
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
    host = parsed.netloc.lower().lstrip("www.")

    # Medium serves different content based on referrer; using medium.com itself
    # as the referrer signals an internal navigation and avoids bot-detection 403s.
    referer = "https://medium.com/" if (host == "medium.com" or host.endswith(".medium.com")) else origin + "/"

    return {
        "User-Agent": _BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Referer": referer,
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


    raise UrlFetchError(f"Could not reach {url}.")


def _parse_published_at(raw: str | None) -> datetime | None:
    if not raw or not str(raw).strip():
        return None
    text = str(raw).strip()
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


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
        published_at=_parse_published_at(data.get("date")),
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


async def fetch_html(url: str) -> tuple[str, str]:
    """Return (final_url, html). Raises UrlFetchError."""
    return await asyncio.to_thread(_fetch_page_sync, url)


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


# ── Link harvesting (for the watched-page connector) ────────────────────────────

# Path fragments that almost never point at a readable article.
_LINK_DENY = (
    "/tag/", "/tags/", "/category/", "/categories/", "/author/", "/authors/",
    "/page/", "/about", "/contact", "/privacy", "/terms", "/login", "/signin",
    "/signup", "/subscribe", "/feed", "/rss", "/search", "/cdn-cgi/",
    "/wp-login", "/wp-admin", "/comments", "/cart", "/account",
)
_LINK_DENY_EXT = (".xml", ".json", ".rss", ".atom", ".jpg", ".jpeg", ".png",
                  ".gif", ".svg", ".pdf", ".zip", ".mp3", ".mp4", ".css", ".js")


def _looks_like_article_path(path: str) -> bool:
    """Heuristic: article URLs are deeper and wordier than nav/section links."""
    clean = path.rstrip("/")
    if not clean or clean == "":
        return False
    segments = [s for s in clean.split("/") if s]
    if not segments:
        return False
    last = segments[-1].lower()
    # A date in the path or a multi-word slug is a strong article signal.
    has_slug = ("-" in last and len(last) > 8) or any(seg.isdigit() and len(seg) == 4 for seg in segments)
    return has_slug and len(segments) >= 1


def _extract_links_sync(page_url: str, html: str, *, max_links: int = 40) -> list[str]:
    """Pull candidate article links from an index/listing page, same-host only."""
    base_host = urlparse(page_url).netloc.removeprefix("www.")
    found: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r'<a\b[^>]*\bhref=["\']([^"\'#]+)["\']', html, re.IGNORECASE):
        href = match.group(1).strip()
        if not href or href.startswith(("mailto:", "javascript:", "tel:")):
            continue
        absolute = urljoin(page_url, href)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        if parsed.netloc.removeprefix("www.") != base_host:
            continue
        lower = absolute.lower()
        if any(token in lower for token in _LINK_DENY):
            continue
        if lower.rsplit("?", 1)[0].endswith(_LINK_DENY_EXT):
            continue
        if not _looks_like_article_path(parsed.path):
            continue
        normalized = absolute.split("#", 1)[0].rstrip("/")
        if normalized in seen or normalized.rstrip("/") == page_url.rstrip("/"):
            continue
        seen.add(normalized)
        found.append(normalized)
        if len(found) >= max_links:
            break
    return found


async def harvest_links(url: str, *, max_links: int = 40) -> list[str]:
    """Fetch a page and return candidate article URLs linked from it."""
    final_url, html = await asyncio.to_thread(_fetch_page_sync, url)
    return await asyncio.to_thread(_extract_links_sync, final_url, html, max_links=max_links)


async def scrape_many(urls: list[str], *, concurrency: int = 5) -> list[NormalizedContent]:
    """Scrape multiple article URLs concurrently, skipping ones that fail."""
    sem = asyncio.Semaphore(concurrency)

    async def _one(u: str) -> NormalizedContent | None:
        async with sem:
            try:
                final_url, html = await asyncio.to_thread(_fetch_page_sync, u)
                return await asyncio.to_thread(_extract_article_sync, final_url, html)
            except Exception:
                return None

    results = await asyncio.gather(*[_one(u) for u in urls])
    return [r for r in results if r is not None]
