"""
Implicit Medium ingestion via Gmail digest emails.

Extracts article URLs from Medium digest HTML, including:
  - redirect.medium.systems tracking links
  - Custom publication domains (towardsdatascience.com, *.pub, etc.)
  - medium.com/@user/slug-hexid and /p/hexid formats
"""
from __future__ import annotations

import logging
import re
from html import unescape
from urllib.parse import parse_qs, unquote, urlparse, urlunparse

log = logging.getLogger(__name__)

_MEDIUM_SENDER_RE = re.compile(r"@(?:[\w-]+\.)?medium\.com$", re.IGNORECASE)

_ARTICLE_SUFFIX_RE = re.compile(r"-[a-f0-9]{8,12}(?:[/?#]|$)", re.IGNORECASE)
_P_PATH_RE = re.compile(r"^/p/[a-f0-9]{8,}(?:[/?#]|$)", re.IGNORECASE)

_SKIP_PATH_PREFIXES = (
    "/m/", "/tag/", "/search", "/about", "/jobs", "/pricing", "/policy",
    "/creators", "/plans", "/membership", "/new-story", "/explore", "/me/",
    "/topics/", "/gift", "/signin", "/s/", "/u/",
)

_MEDIUM_REDIRECT_HOSTS = frozenset({
    "redirect.medium.systems",
    "link.medium.com",
    "email.medium.com",
})

_MEDIUM_HTML_MARKERS = (
    "redirect.medium.systems",
    "medium.com",
    "medium daily digest",
    "the medium newsletter",
)

_MAX_ARTICLES_PER_EMAIL = 8

_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
_ANCHOR_RE = re.compile(
    r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)


def is_medium_sender(sender_email: str | None) -> bool:
    if not sender_email:
        return False
    return bool(_MEDIUM_SENDER_RE.search(sender_email))


def is_medium_digest_html(html: str | None) -> bool:
    if not html:
        return False
    lower = html.lower()
    return any(marker in lower for marker in _MEDIUM_HTML_MARKERS)


def detect_medium_digest(html: str | None, sender_email: str | None) -> bool:
    return is_medium_sender(sender_email) or is_medium_digest_html(html)


def _strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", text))).strip()


def resolve_medium_href(raw_href: str) -> str | None:
    """Normalize a href from a Medium digest email to a canonical article URL."""
    href = raw_href.strip().replace("&amp;", "&")
    if not href.startswith("http"):
        return None

    try:
        parsed = urlparse(href)
    except ValueError:
        return None

    host = parsed.netloc.lower().lstrip("www.")

    if host in _MEDIUM_REDIRECT_HOSTS:
        qs = parse_qs(parsed.query)
        for key in ("url", "redirect", "u", "link"):
            if key in qs and qs[key]:
                return resolve_medium_href(unquote(qs[key][0]))
        return None

    path = parsed.path or ""
    if any(path.startswith(p) for p in _SKIP_PATH_PREFIXES):
        return None

    is_medium_host = host == "medium.com" or host.endswith(".medium.com")
    has_article_id = bool(_ARTICLE_SUFFIX_RE.search(path)) or bool(_P_PATH_RE.match(path))

    # Custom Medium publication domains use the same hex article-id suffix
    if has_article_id or (is_medium_host and _P_PATH_RE.match(path)):
        return urlunparse(parsed._replace(query="", fragment=""))

    return None


def extract_article_urls(html: str) -> list[str]:
    """Return deduplicated Medium article URLs from digest HTML."""
    previews = extract_article_previews(html)
    return [p["url"] for p in previews]


def extract_article_previews(html: str) -> list[dict[str, str]]:
    """
    Return {url, title} pairs extracted from digest HTML.
    Titles come from anchor text when available.
    """
    if not html:
        return []

    seen: set[str] = set()
    previews: list[dict[str, str]] = []

    for match in _ANCHOR_RE.finditer(html):
        raw_href = match.group(1)
        title = _strip_html(match.group(2))
        clean = resolve_medium_href(raw_href)
        if not clean or clean in seen:
            continue
        seen.add(clean)
        previews.append({"url": clean, "title": title or "Medium article"})
        if len(previews) >= _MAX_ARTICLES_PER_EMAIL:
            break

    if previews:
        log.debug("medium_extractor: extracted %d article previews from digest", len(previews))
        return previews

    for raw_href in _HREF_RE.findall(html):
        clean = resolve_medium_href(raw_href)
        if not clean or clean in seen:
            continue
        seen.add(clean)
        previews.append({"url": clean, "title": "Medium article"})
        if len(previews) >= _MAX_ARTICLES_PER_EMAIL:
            break

    log.debug("medium_extractor: extracted %d article URLs from digest email", len(previews))
    return previews
