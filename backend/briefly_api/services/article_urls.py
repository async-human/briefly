"""Resolve article URLs from newsletter / email content — never use Gmail inbox links."""
from __future__ import annotations

import re

_GMAIL_INBOX_RE = re.compile(r"^https?://mail\.google\.com/", re.I)
_URL_IN_TEXT_RE = re.compile(r"https?://\S+")
_MULTI_SPACE_RE = re.compile(r"\n{3,}")


def is_gmail_inbox_url(url: str | None) -> bool:
    if not url:
        return False
    return bool(_GMAIL_INBOX_RE.match(url.strip()))


def is_usable_article_url(url: str | None) -> bool:
    if not url or not url.strip():
        return False
    lower = url.strip().lower()
    if is_gmail_inbox_url(lower):
        return False
    if lower.startswith("mailto:"):
        return False
    return lower.startswith("http://") or lower.startswith("https://")


def resolve_article_url(
    url: str | None,
    meta: dict | None = None,
) -> str | None:
    """Pick the best public article URL for a digest item."""
    meta = meta or {}
    for candidate in (meta.get("article_url"), url):
        if is_usable_article_url(candidate):
            return str(candidate).strip()
    return None


def strip_url_noise(text: str, *, max_len: int = 1500) -> str:
    """Remove raw tracking URLs from newsletter plain-text bodies."""
    if not text:
        return ""
    lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            lines.append("")
            continue
        if _URL_IN_TEXT_RE.fullmatch(stripped.replace("]", "").replace(")", "")):
            continue
        if stripped.startswith("[") and "http" in stripped and stripped.count(" ") <= 2:
            continue
        cleaned = _URL_IN_TEXT_RE.sub("", line).strip()
        if cleaned:
            lines.append(cleaned)
    out = _MULTI_SPACE_RE.sub("\n\n", "\n".join(lines)).strip()
    return out[:max_len]
