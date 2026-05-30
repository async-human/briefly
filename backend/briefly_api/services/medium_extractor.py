"""
Implicit Medium ingestion via Gmail digest emails.

Medium sends users personalised digest emails based on their reading history,
bookmarks, and followed authors. This module:
  1. Detects whether a Gmail message came from Medium.
  2. Extracts article URLs from the email HTML before the body is converted
     to plain text (which discards the links).

The GmailConnector then fetches each article URL's full text and injects the
articles into the pipeline — zero extra setup required from the user beyond
their Day-1 Gmail connection.
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urlparse, urlunparse

log = logging.getLogger(__name__)

# ── Sender detection ──────────────────────────────────────────────────────────

_MEDIUM_SENDER_DOMAINS = {"medium.com"}

# Medium also sends from subdomains like noreply@medium.com, hi@medium.com
_MEDIUM_SENDER_RE = re.compile(r"@(?:[\w-]+\.)?medium\.com$", re.IGNORECASE)


def is_medium_sender(sender_email: str | None) -> bool:
    """Return True if the email address belongs to Medium."""
    if not sender_email:
        return False
    return bool(_MEDIUM_SENDER_RE.search(sender_email))


# ── URL extraction ────────────────────────────────────────────────────────────

# Medium article URLs always end with a hex content-ID (8–12 lowercase hex chars)
# Examples:
#   https://medium.com/@username/article-slug-a1b2c3d4e5f6
#   https://towardsdatascience.com/article-slug-a1b2c3d4e5f6
#   https://medium.com/publication/article-slug-a1b2c3d4e5f6
_ARTICLE_SUFFIX_RE = re.compile(r"-[a-f0-9]{8,12}(?:[/?#]|$)", re.IGNORECASE)

_SKIP_PATH_PREFIXES = (
    "/m/",
    "/tag/",
    "/search",
    "/about",
    "/jobs",
    "/pricing",
    "/policy",
    "/creators",
    "/plans",
    "/membership",
    "/new-story",
    "/explore",
    "/me/",
    "/topics/",
    "/gift",
)

# Hard cap: don't flood the pipeline from a single digest email
_MAX_ARTICLES_PER_EMAIL = 6

_HREF_RE = re.compile(r'href=["\']([^"\']{20,})["\']', re.IGNORECASE)


def extract_article_urls(html: str) -> list[str]:
    """
    Return up to _MAX_ARTICLES_PER_EMAIL deduplicated Medium article URLs
    found in the raw HTML of a digest email.
    """
    if not html:
        return []

    seen: set[str] = set()
    urls: list[str] = []

    for raw_href in _HREF_RE.findall(html):
        if not raw_href.startswith("http"):
            continue

        try:
            parsed = urlparse(raw_href)
        except ValueError:
            continue

        host = parsed.netloc.lower().lstrip("www.")
        path = parsed.path.rstrip("/")

        # Must be medium.com or a Medium-hosted publication subdomain
        if not (host == "medium.com" or host.endswith(".medium.com")):
            continue

        # Skip non-article paths (settings, tags, navigation, etc.)
        if any(path.startswith(p) for p in _SKIP_PATH_PREFIXES):
            continue

        # Must carry Medium's hex content-ID suffix to be a real article
        if not _ARTICLE_SUFFIX_RE.search(path):
            continue

        # Canonicalise: strip query params and fragments added by email trackers
        clean = urlunparse(parsed._replace(query="", fragment=""))

        if clean not in seen:
            seen.add(clean)
            urls.append(clean)
            if len(urls) >= _MAX_ARTICLES_PER_EMAIL:
                break

    log.debug("medium_extractor: extracted %d article URLs from digest email", len(urls))
    return urls
