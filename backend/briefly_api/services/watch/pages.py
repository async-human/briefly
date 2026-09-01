"""Pinned official-page change detection for watched companies.

Not a crawler and not an LLM browsing agent. Each catalog company may pin at
most three public URLs (pricing, docs, changelog). First successful fetch is a
baseline with no alert. We hash canonical extract, not raw HTML. A fetch
failure is not treated as "no change." Unknown companies stay on RSS + news.
"""
from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
import trafilatura
from sqlalchemy import select

from briefly_api.db.models import EntitySource, WatchedEntity
from briefly_api.services.url_scraper import UrlFetchError, _BROWSER_UA, fetch_html
from briefly_api.services.watch.relevance import WatchHit, canonicalize_url

log = logging.getLogger(__name__)

PAGE_SOURCE_TYPES = frozenset({"pricing", "docs", "changelog"})
PAGE_ASPECT = {
    "pricing": "pricing_positioning",
    "docs": "model_api",
    "changelog": "product_release",
}
PAGE_LABEL = {
    "pricing": "pricing page",
    "docs": "docs page",
    "changelog": "changelog",
}

MIN_EXTRACT_CHARS = 200
MAX_EXTRACT_STORE = 80_000
MAX_PAGES_PER_ENTITY = 3
_ROBOTS_TTL_SECONDS = 3600.0

_NOISE_LINE = re.compile(
    r"^(cookie|privacy policy|terms of service|accept all|reject all|"
    r"sign in|log in|subscribe|skip to|menu|navigation)\b",
    re.I,
)
_STAMP_LINE = re.compile(
    r"^(last\s+updated|updated\s+\d|published\s+\d|as of\s+\d)\b",
    re.I,
)
_RELATIVE_TIME = re.compile(r"\b\d+\s+(second|minute|hour|day)s?\s+ago\b", re.I)
_INTERESTING = re.compile(r"[$€£₹]|\d+(?:\.\d+)?\s*%|\b\d+\.\d+\b")

_robots_cache: dict[str, tuple[float, RobotFileParser | None | str]] = {}


@dataclass(frozen=True)
class ExtractDecision:
    kind: str  # thin | baseline | unchanged | changed
    extract: str
    digest: str
    excerpt: str
    previous_excerpt: str
    error: str | None = None


def canonicalize_extract(text: str) -> str:
    """Stable text for hashing: collapse whitespace, drop cookie/nav/timestamp lines."""
    lines: list[str] = []
    for raw in (text or "").splitlines():
        line = " ".join(raw.split()).strip()
        if len(line) < 2:
            continue
        if _NOISE_LINE.match(line) or _STAMP_LINE.match(line) or _RELATIVE_TIME.search(line):
            continue
        lines.append(line)
    return "\n".join(lines)


def hash_extract(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def is_thin(text: str) -> bool:
    return len(text or "") < MIN_EXTRACT_CHARS


def changed_excerpt(old: str, new: str, *, limit: int = 800) -> str:
    """Lines that appeared in `new`. Prefer prices, percents, and numbers."""
    old_set = {ln.strip() for ln in (old or "").splitlines() if ln.strip()}
    added = [ln.strip() for ln in (new or "").splitlines() if ln.strip() and ln.strip() not in old_set]
    if not added:
        return (new or "").strip()[:limit]
    interesting = [ln for ln in added if _INTERESTING.search(ln)]
    ranked = interesting + [ln for ln in added if ln not in interesting]
    return "\n".join(ranked)[:limit]


def evaluate_extract(
    previous_hash: str | None,
    previous_extract: str | None,
    extract: str,
) -> ExtractDecision:
    cleaned = canonicalize_extract(extract)
    if is_thin(cleaned):
        return ExtractDecision(
            kind="thin",
            extract=cleaned,
            digest="",
            excerpt="",
            previous_excerpt="",
            error="extract too thin (login wall or JavaScript shell)",
        )
    digest = hash_extract(cleaned)
    if not (previous_hash or "").strip():
        return ExtractDecision(
            kind="baseline",
            extract=cleaned,
            digest=digest,
            excerpt="",
            previous_excerpt="",
        )
    if previous_hash == digest:
        return ExtractDecision(
            kind="unchanged",
            extract=cleaned,
            digest=digest,
            excerpt="",
            previous_excerpt="",
        )
    excerpt = changed_excerpt(previous_extract or "", cleaned)
    gone = changed_excerpt(cleaned, previous_extract or "")
    return ExtractDecision(
        kind="changed",
        extract=cleaned,
        digest=digest,
        excerpt=excerpt,
        previous_excerpt=gone[:240],
    )


def extract_visible_text(html: str, url: str) -> str:
    text = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=True,
        include_links=False,
    ) or ""
    if not is_thin(canonicalize_extract(text)):
        return text
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html or "", "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    return soup.get_text("\n")


def _robots_origin(url: str) -> str:
    parsed = urlparse(url)
    scheme = parsed.scheme or "https"
    return f"{scheme}://{parsed.netloc}"


def _load_robots(origin: str) -> RobotFileParser | None | str:
    """Parser, None (allow all), or 'unreachable'."""
    now = datetime.now(timezone.utc).timestamp()
    cached = _robots_cache.get(origin)
    if cached and now - cached[0] < _ROBOTS_TTL_SECONDS:
        return cached[1]
    robots_url = urljoin(origin.rstrip("/") + "/", "robots.txt")
    try:
        with httpx.Client(timeout=8.0, follow_redirects=True, headers={"User-Agent": _BROWSER_UA}) as client:
            resp = client.get(robots_url)
            if resp.status_code in (404, 410):
                _robots_cache[origin] = (now, None)
                return None
            if resp.status_code >= 400:
                _robots_cache[origin] = (now, "unreachable")
                return "unreachable"
            parser = RobotFileParser()
            parser.set_url(robots_url)
            parser.parse(resp.text.splitlines())
            _robots_cache[origin] = (now, parser)
            return parser
    except httpx.HTTPError:
        _robots_cache[origin] = (now, "unreachable")
        return "unreachable"


def robots_status(url: str) -> str:
    """allow | disallow | unreachable."""
    origin = _robots_origin(url)
    loaded = _load_robots(origin)
    if loaded == "unreachable":
        return "unreachable"
    if loaded is None:
        return "allow"
    try:
        allowed = loaded.can_fetch(_BROWSER_UA, url)
    except Exception:
        return "unreachable"
    return "allow" if allowed else "disallow"


def _mark_error(src: EntitySource, now: datetime, message: str, *, count_failure: bool) -> None:
    src.last_fetched = now
    src.last_error = message[:500]
    if count_failure:
        src.consecutive_failures = int(src.consecutive_failures or 0) + 1


def _mark_ok(src: EntitySource, now: datetime, digest: str, extract: str) -> None:
    src.last_fetched = now
    src.last_error = None
    src.consecutive_failures = 0
    src.content_hash = digest
    src.last_extract = extract[:MAX_EXTRACT_STORE]


def _hit_for_change(entity: WatchedEntity, src: EntitySource, decision: ExtractDecision, now: datetime) -> WatchHit:
    kind = PAGE_LABEL.get(src.source_type, "official page")
    canonical = canonicalize_url(src.url) or src.url
    excerpt = decision.excerpt or decision.extract[:800]
    return WatchHit(
        title=f"{entity.name} {kind} changed",
        url=canonical,
        source_name=f"{entity.name} · official {kind}",
        source_type=src.source_type,
        summary=excerpt[:1500],
        published_at=now,
        is_official=True,
        score=0.95,
        related_urls=[canonical],
        previous_state=decision.previous_excerpt,
    )


async def check_entity_pages(
    session,
    entity: WatchedEntity,
    *,
    min_interval_minutes: int,
    force: bool = False,
) -> tuple[list[WatchHit], int]:
    sources = (
        await session.execute(
            select(EntitySource).where(
                EntitySource.entity_id == entity.id,
                EntitySource.is_active.is_(True),
                EntitySource.source_type.in_(tuple(PAGE_SOURCE_TYPES)),
            )
        )
    ).scalars().all()
    if not sources:
        return [], 0

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=max(5, min_interval_minutes))
    hits: list[WatchHit] = []
    checked = 0

    for src in sources[:MAX_PAGES_PER_ENTITY]:
        if not force and src.last_fetched:
            lf = src.last_fetched if src.last_fetched.tzinfo else src.last_fetched.replace(tzinfo=timezone.utc)
            if lf > cutoff:
                continue
        checked += 1
        status = robots_status(src.url)
        if status == "disallow":
            _mark_error(src, now, "robots.txt disallows this URL", count_failure=False)
            log.info("Watch page skipped (robots): %s %s", entity.name, src.url)
            continue
        if status == "unreachable":
            _mark_error(src, now, "robots.txt unreachable", count_failure=True)
            continue
        try:
            _final_url, html = await fetch_html(src.url)
            raw = extract_visible_text(html, src.url)
        except UrlFetchError as exc:
            _mark_error(src, now, str(exc)[:500], count_failure=True)
            log.debug("Watch page fetch failed %s (%s): %s", entity.name, src.source_type, exc)
            continue
        except Exception as exc:
            _mark_error(src, now, f"fetch failed: {exc}"[:500], count_failure=True)
            log.debug("Watch page fetch failed %s (%s): %s", entity.name, src.source_type, exc)
            continue

        decision = evaluate_extract(src.content_hash, src.last_extract, raw)
        if decision.kind == "thin":
            _mark_error(src, now, decision.error or "extract too thin", count_failure=True)
            continue
        _mark_ok(src, now, decision.digest, decision.extract)
        if decision.kind == "changed":
            hits.append(_hit_for_change(entity, src, decision, now))
            log.info("Watch page changed: %s %s", entity.name, src.source_type)
        elif decision.kind == "baseline":
            log.info("Watch page baseline stored: %s %s", entity.name, src.source_type)

    return hits, checked
