"""Relevance scoring + cross-source dedup for watched-entity hits."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urlparse

from briefly_api.services.watch.catalog import (
    HIGH_AUTHORITY_DOMAINS,
    MEDIUM_AUTHORITY_DOMAINS,
    match_terms_for,
    normalize_name,
)

_WORD = re.compile(r"[a-z0-9]+")
_STOP = frozenset({
    "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "at",
    "with", "from", "by", "is", "its", "new", "just", "today",
})


@dataclass
class WatchHit:
    title: str
    url: str
    source_name: str
    source_type: str
    summary: str = ""
    published_at: datetime | None = None
    is_official: bool = False
    score: float = 0.0
    related_urls: list[str] = field(default_factory=list)


def _tokens(text: str) -> set[str]:
    return {t for t in _WORD.findall((text or "").lower()) if len(t) > 1 and t not in _STOP}


def _domain(url: str) -> str:
    host = (urlparse(url or "").netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def _hours_old(published: datetime | None, now: datetime) -> float | None:
    if not published:
        return None
    ts = published if published.tzinfo else published.replace(tzinfo=timezone.utc)
    return max(0.0, (now - ts).total_seconds() / 3600)


def title_similarity(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def canonicalize_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    host = parsed.netloc.lower().removeprefix("www.")
    path = parsed.path.rstrip("/") or "/"
    return f"{parsed.scheme or 'https'}://{host}{path}"[:2000]


def authority_bonus(url: str, is_official: bool) -> float:
    if is_official:
        return 0.2
    domain = _domain(url)
    if domain in HIGH_AUTHORITY_DOMAINS:
        return 0.2
    if any(domain.endswith(f".{d}") for d in HIGH_AUTHORITY_DOMAINS):
        return 0.2
    if domain in MEDIUM_AUTHORITY_DOMAINS:
        return 0.1
    return 0.0


def keyword_score(title: str, body: str, entity_name: str, terms: list[str]) -> float:
    hay = f"{title} {body}".lower()
    name = normalize_name(entity_name)
    score = 0.0
    if name and name in hay:
        score += 0.3
    elif any(t.lower() in hay for t in terms if len(t) >= 4):
        score += 0.18
    title_low = (title or "").lower()
    if name and name in title_low:
        score += 0.08
    return min(score, 0.38)


def recency_bonus(published_at: datetime | None, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    hours = _hours_old(published_at, now)
    if hours is None:
        return 0.04
    if hours < 24:
        return 0.1
    if hours < 72:
        return 0.05
    return 0.0


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def score_hit(
    hit: WatchHit,
    *,
    entity_name: str,
    kind: str,
    keywords: list[str],
    aliases: list[str],
    semantic: float | None = None,
    click_rate: float = 0.0,
    now: datetime | None = None,
) -> float:
    terms = match_terms_for(entity_name, kind, keywords, aliases)
    score = keyword_score(hit.title, hit.summary, entity_name, terms)
    if semantic is not None:
        score += max(0.0, min(semantic, 1.0)) * 0.4
    else:
        # Without embeddings, a strong keyword hit still needs room to pass 0.7
        if score >= 0.3:
            score += 0.22
        elif score >= 0.18:
            score += 0.12
    score += authority_bonus(hit.url, hit.is_official)
    score += recency_bonus(hit.published_at, now)
    score *= 1 + max(0.0, min(click_rate, 1.0)) * 0.2
    return round(min(score, 1.0), 4)


def dedupe_hits(hits: list[WatchHit], threshold: float = 0.72) -> list[WatchHit]:
    """Cluster near-duplicate stories and keep the strongest source."""
    remaining = sorted(
        hits,
        key=lambda h: (h.is_official, h.score, h.published_at or datetime.min.replace(tzinfo=timezone.utc)),
        reverse=True,
    )
    clusters: list[WatchHit] = []
    used: set[int] = set()
    for i, hit in enumerate(remaining):
        if i in used:
            continue
        related: list[str] = []
        for j, other in enumerate(remaining):
            if j <= i or j in used:
                continue
            same_url = canonicalize_url(hit.url) == canonicalize_url(other.url)
            similar = title_similarity(hit.title, other.title) >= threshold
            if same_url or similar:
                used.add(j)
                if other.url and other.url != hit.url:
                    related.append(other.url)
        hit.related_urls = related
        clusters.append(hit)
        used.add(i)
    return clusters
