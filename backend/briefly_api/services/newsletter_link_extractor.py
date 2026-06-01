"""
Extract outbound article links from newsletter HTML (Layer 2 — deep link hydration).
"""
from __future__ import annotations

import re
from urllib.parse import urlparse, urlunparse

log = __import__("logging").getLogger(__name__)

_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)

_SKIP_DOMAINS = frozenset({
    "twitter.com", "x.com", "facebook.com", "instagram.com", "linkedin.com",
    "youtube.com", "tiktok.com", "pinterest.com", "reddit.com",
    "substack.com", "beehiiv.com", "mailchimp.com", "convertkit.com",
    "google.com", "apple.com", "play.google.com", "apps.apple.com",
    "unsubscribe", "list-manage.com", "campaign-archive.com",
    "click.email", "links.email", "trk.email", "email.mg",
    "medium.com",  # handled by medium_extractor
})

_SKIP_PATH_FRAGMENTS = (
    "/unsubscribe", "/preferences", "/manage", "/optout", "/opt-out",
    "/login", "/signup", "/subscribe", "/privacy", "/terms",
    "/share", "/tweet", "/intent/",
)

_MAX_LINKS_PER_EMAIL = 8
_MAX_TOTAL_LINKS = 24


def _normalize_url(raw: str) -> str | None:
    url = raw.strip().split("#")[0].split("?")[0]
    if not url.startswith(("http://", "https://")):
        return None
    try:
        parsed = urlparse(url)
    except Exception:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.netloc or "").lower().lstrip("www.")
    if not host or len(host) < 4:
        return None
    if any(skip in host for skip in _SKIP_DOMAINS):
        return None
    path = (parsed.path or "").lower()
    if any(frag in path for frag in _SKIP_PATH_FRAGMENTS):
        return None
    if path.endswith((".png", ".jpg", ".gif", ".svg", ".ico", ".css", ".js")):
        return None
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path or "/", "", "", ""))


def extract_outbound_links(html: str, *, sender_domain: str = "") -> list[str]:
    """Return deduplicated article-like URLs from newsletter HTML."""
    if not html:
        return []

    seen: set[str] = set()
    urls: list[str] = []

    for match in _HREF_RE.finditer(html):
        normalized = _normalize_url(match.group(1))
        if not normalized or normalized in seen:
            continue
        host = urlparse(normalized).netloc.lower().lstrip("www.")
        # Skip links back to the newsletter platform itself
        if sender_domain and sender_domain in host:
            continue
        seen.add(normalized)
        urls.append(normalized)
        if len(urls) >= _MAX_LINKS_PER_EMAIL:
            break

    return urls


def merge_link_candidates(all_links: list[tuple[str, str]]) -> list[dict]:
    """
    Merge (url, source_newsletter) pairs into ranked candidates.
    `all_links`: list of (url, newsletter_name)
    """
    counts: dict[str, int] = {}
    names: dict[str, str] = {}
    for url, newsletter in all_links:
        counts[url] = counts.get(url, 0) + 1
        names.setdefault(url, newsletter)

    ranked = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    out: list[dict] = []
    for url, count in ranked[:_MAX_TOTAL_LINKS]:
        host = urlparse(url).netloc.lstrip("www.")
        out.append({
            "url": url,
            "name": host,
            "link_count": count,
            "from_newsletter": names.get(url, ""),
        })
    return out
