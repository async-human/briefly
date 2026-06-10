"""
Intelligent content discovery — surfaces highly relevant articles from sources
the user has NOT subscribed to, based on profile, behavior, and coverage gaps.

Pipeline stages:
  1. Intent synthesis — build weighted search intents from profile + behavior
  2. Harvest — fetch fresh candidates from external feeds (no subscription required)
  3. Filter — exclude subscribed domains, seen content, never-show topics
  4. Score — multi-dimensional relevance (semantic + behavioral + recency)
  5. Diversify — publisher diversity + MMR-style de-duplication
  6. Explain — human-readable "why you'll care" for each pick
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus, urlparse

import httpx
import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings, get_settings
from briefly_api.db.models import (
    BehavioralFingerprint,
    BehavioralSignal,
    DigestItem,
    SignalType,
    Source,
    UserProfile,
)
from briefly_api.db.queries import get_seen_content_hashes
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.external_feed_discovery import (
    _interest_phrases,
    _slugify,
    discover_reddit_subreddits_for_interests,
)
from briefly_api.services.personalization_score import (
    build_interest_model,
    topic_alignment_score,
)
from briefly_api.services.rss import fetch_rss_articles

log = logging.getLogger(__name__)

_CACHE_TTL_HOURS = 6
_MAX_INTENTS = 8
_MAX_CANDIDATES = 72
_MAX_AGE_DAYS = 5
_SCORE_THRESHOLD = 0.58
_DASHBOARD_LIMIT = 8
_DIGEST_INJECT_LIMIT = 2

_POS_SIGNALS = {SignalType.saved, SignalType.clicked, SignalType.followed_up}


@dataclass
class DiscoveryIntent:
    phrase: str
    weight: float
    reason: str  # coverage_gap | behavioral | cluster | declared | recent_engagement


@dataclass
class DiscoveredCandidate:
    title: str
    url: str
    source_name: str
    summary: str
    published_at: datetime | None
    feed_url: str
    source_type: str
    intent: DiscoveryIntent
    content_hash: str = ""
    embedding: list[float] | None = None
    relevance_score: float = 0.0
    discovery_reason: str = ""
    why_relevant: str = ""
    publisher_domain: str = ""


def _uuid() -> str:
    import uuid
    return str(uuid.uuid4())


def _domain(url: str | None) -> str:
    if not url:
        return ""
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def _content_hash(title: str, url: str | None) -> str:
    key = f"{(title or '').strip().lower()}|{(url or '').strip().lower()}"
    return hashlib.sha256(key.encode("utf-8", errors="replace")).hexdigest()


def _matches_never_show(text: str, never_show: list[str]) -> bool:
    lower = text.lower()
    return any(term.strip().lower() in lower for term in never_show if term.strip())


def _age_days(published_at: datetime | None) -> float | None:
    if not published_at:
        return None
    pub = published_at
    if pub.tzinfo is None:
        pub = pub.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - pub).total_seconds() / 86400


def _recency_score(published_at: datetime | None) -> float:
    age = _age_days(published_at)
    if age is None:
        return 0.45
    if age < 0.5:
        return 1.0
    if age < 1:
        return 0.95
    if age < 2:
        return 0.85
    if age < 3:
        return 0.72
    if age < 5:
        return 0.55
    return 0.25


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.5
    sim = float(np.dot(va, vb) / (na * nb))
    return max(0.0, min(1.0, (sim + 1) / 2))


def _profile_to_text(profile: dict) -> str:
    parts: list[str] = []
    if profile.get("role"):
        parts.append(f"Role: {profile['role']}")
    if profile.get("goal"):
        parts.append(f"Goal: {profile['goal']}")
    for interest in profile.get("interests") or []:
        if isinstance(interest, dict) and interest.get("topic"):
            parts.append(interest["topic"])
    for cluster in profile.get("topic_clusters") or []:
        label = cluster.get("cluster") or cluster.get("topic") or ""
        if label:
            parts.append(label)
    return ". ".join(parts)


async def _build_discovery_intents(
    session: AsyncSession,
    user_id: str,
    profile: UserProfile,
    fingerprint: BehavioralFingerprint | None,
) -> list[DiscoveryIntent]:
    intents: dict[str, DiscoveryIntent] = {}

    def add(phrase: str, weight: float, reason: str) -> None:
        clean = phrase.strip()
        if len(clean) < 3:
            return
        key = clean.lower()
        existing = intents.get(key)
        if existing and existing.weight >= weight:
            return
        intents[key] = DiscoveryIntent(phrase=clean, weight=weight, reason=reason)

    profile_dict = {
        "interests": profile.interests or [],
        "goal": profile.goal,
        "role": profile.role,
        "topic_clusters": profile.topic_clusters or [],
    }
    for phrase in _interest_phrases(profile_dict):
        add(phrase, 0.75, "declared")

    for cluster in profile.topic_clusters or []:
        label = cluster.get("cluster") or cluster.get("topic") or ""
        strength = float(cluster.get("strength") or cluster.get("weight") or 0.5)
        if label:
            add(label, min(1.1, 0.65 + strength * 0.4), "cluster")

    if fingerprint:
        for entry in fingerprint.high_engagement_topics or []:
            topic = (entry.get("topic") or "").strip()
            if topic:
                add(topic, 1.05, "behavioral")
        for gap in fingerprint.coverage_gaps or []:
            if isinstance(gap, str) and gap.strip():
                add(gap.strip(), 1.15, "coverage_gap")

    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    sig_result = await session.execute(
        select(
            BehavioralSignal.signal_type,
            DigestItem.headline,
            DigestItem.why_it_matters,
            DigestItem.summary,
        )
        .join(DigestItem, BehavioralSignal.digest_item_id == DigestItem.id)
        .where(
            BehavioralSignal.user_id == user_id,
            BehavioralSignal.created_at >= cutoff,
            BehavioralSignal.signal_type.in_(list(_POS_SIGNALS)),
            BehavioralSignal.digest_item_id.isnot(None),
        )
        .order_by(BehavioralSignal.created_at.desc())
        .limit(40)
    )
    for row in sig_result.all():
        headline = (row.headline or "").strip()
        if len(headline) > 12:
            add(headline[:100], 0.92, "recent_engagement")
        why = (row.why_it_matters or row.summary or "").strip()
        if len(why) > 20:
            words = [w for w in re.split(r"\W+", why) if len(w) > 4][:6]
            if words:
                add(" ".join(words[:4]), 0.8, "recent_engagement")

    ranked = sorted(intents.values(), key=lambda i: -i.weight)
    return ranked[:_MAX_INTENTS]


async def _subscribed_domains(session: AsyncSession, user_id: str) -> set[str]:
    result = await session.execute(
        select(Source.identifier, Source.source_type).where(Source.user_id == user_id)
    )
    domains: set[str] = set()
    for identifier, source_type in result.all():
        ident = (identifier or "").strip().lower()
        if source_type in ("rss", "url", "youtube") and ident.startswith("http"):
            d = _domain(ident)
            if d:
                domains.add(d)
        if source_type == "reddit":
            domains.add(f"reddit.com/r/{ident.lstrip('r/')}")
        if source_type == "email" and "@" in ident:
            domains.add(ident.split("@")[-1])
    return domains


async def _harvest_google_news(intent: DiscoveryIntent, limit: int = 4) -> list[NormalizedContent]:
    q = quote_plus(intent.phrase)
    url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
    try:
        articles = await fetch_rss_articles(url, limit=limit, source_name=f"Google News · {intent.phrase}")
        for a in articles:
            a.meta = {"provider": "google_news", "intent": intent.phrase, "feed_url": url}
        return articles
    except Exception as exc:
        log.debug("Google News harvest failed for %s: %s", intent.phrase, exc)
        return []


async def _harvest_medium(intent: DiscoveryIntent, limit: int = 3) -> list[NormalizedContent]:
    slug = _slugify(intent.phrase)
    if len(slug) < 2:
        return []
    url = f"https://medium.com/feed/tag/{slug}"
    try:
        articles = await fetch_rss_articles(url, limit=limit, source_name=f"Medium · {intent.phrase}")
        for a in articles:
            a.meta = {"provider": "medium", "intent": intent.phrase, "feed_url": url}
        return articles
    except Exception as exc:
        log.debug("Medium harvest failed for %s: %s", intent.phrase, exc)
        return []


async def _harvest_reddit_hot(
    subreddit: str,
    settings: Settings,
    intent: DiscoveryIntent,
    limit: int = 3,
) -> list[NormalizedContent]:
    headers = {"User-Agent": settings.reddit_user_agent}
    url = f"https://www.reddit.com/r/{subreddit}/hot.json"
    articles: list[NormalizedContent] = []
    try:
        async with httpx.AsyncClient(timeout=12.0, headers=headers, follow_redirects=True) as client:
            resp = await client.get(url, params={"limit": limit, "raw_json": 1})
            resp.raise_for_status()
            children = resp.json().get("data", {}).get("children", [])
        for child in children:
            data = child.get("data", {})
            if data.get("stickied") or data.get("over_18"):
                continue
            title = (data.get("title") or "").strip()
            if not title:
                continue
            permalink = data.get("permalink") or ""
            link = f"https://www.reddit.com{permalink}" if permalink else data.get("url")
            published = None
            created = data.get("created_utc")
            if created:
                published = datetime.fromtimestamp(created, tz=timezone.utc)
            articles.append(NormalizedContent(
                title=title,
                url=link,
                source_name=f"r/{subreddit}",
                source_type="reddit",
                summary=(data.get("selftext") or "")[:400] or title,
                published_at=published,
                meta={"provider": "reddit_hot", "intent": intent.phrase, "feed_url": url},
            ))
    except Exception as exc:
        log.debug("Reddit hot harvest failed for r/%s: %s", subreddit, exc)
    return articles


async def _harvest_hn(intent: DiscoveryIntent, limit: int = 3) -> list[NormalizedContent]:
    articles: list[NormalizedContent] = []
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                "https://hn.algolia.com/api/v1/search",
                params={
                    "query": intent.phrase,
                    "tags": "story",
                    "hitsPerPage": limit,
                    "numericFilters": f"created_at_i>{int((datetime.now(timezone.utc) - timedelta(days=5)).timestamp())}",
                },
            )
            resp.raise_for_status()
            hits = resp.json().get("hits", [])
        for hit in hits:
            title = (hit.get("title") or "").strip()
            if not title:
                continue
            obj_id = hit.get("objectID")
            link = hit.get("url") or f"https://news.ycombinator.com/item?id={obj_id}"
            created = hit.get("created_at_i")
            published = datetime.fromtimestamp(created, tz=timezone.utc) if created else None
            articles.append(NormalizedContent(
                title=title,
                url=link,
                source_name="Hacker News",
                source_type="url",
                summary=title,
                published_at=published,
                meta={"provider": "hackernews", "intent": intent.phrase, "feed_url": "hn.algolia.com"},
            ))
    except Exception as exc:
        log.debug("HN harvest failed for %s: %s", intent.phrase, exc)
    return articles


async def _harvest_candidates(
    intents: list[DiscoveryIntent],
    settings: Settings,
    subscribed: set[str],
) -> list[DiscoveredCandidate]:
    if not intents:
        return []

    harvest_tasks = []
    for intent in intents[:6]:
        harvest_tasks.append(_harvest_google_news(intent))
        harvest_tasks.append(_harvest_medium(intent))
        harvest_tasks.append(_harvest_hn(intent))

    sub_results = await discover_reddit_subreddits_for_interests(
        [i.phrase for i in intents[:4]],
        settings,
        limit_per_interest=1,
    )
    sub_by_intent: dict[str, str] = {}
    for sub in sub_results:
        interest = sub.get("meta", {}).get("interest", "")
        name = sub.get("identifier", "")
        if interest and name:
            sub_by_intent.setdefault(interest.lower(), name)

    for intent in intents[:4]:
        sub = sub_by_intent.get(intent.phrase.lower())
        if sub:
            harvest_tasks.append(_harvest_reddit_hot(sub, settings, intent))

    batches = await asyncio.gather(*harvest_tasks, return_exceptions=True)

    candidates: list[DiscoveredCandidate] = []
    seen_urls: set[str] = set()

    intent_by_phrase = {i.phrase.lower(): i for i in intents}

    for batch in batches:
        if isinstance(batch, Exception):
            continue
        for article in batch:
            if not article.url or not article.title:
                continue
            url_key = article.url.strip().lower()
            if url_key in seen_urls:
                continue
            domain = _domain(article.url)
            if domain and any(domain in sub or sub in domain for sub in subscribed):
                continue
            seen_urls.add(url_key)
            intent_phrase = (article.meta or {}).get("intent", intents[0].phrase if intents else "")
            intent = intent_by_phrase.get(intent_phrase.lower()) or intents[0]
            candidates.append(DiscoveredCandidate(
                title=article.title.strip(),
                url=article.url,
                source_name=article.source_name or domain or "Web",
                summary=(article.summary or article.clean_text or "")[:500],
                published_at=article.published_at,
                feed_url=(article.meta or {}).get("feed_url", ""),
                source_type=article.source_type or "rss",
                intent=intent,
                content_hash=_content_hash(article.title, article.url),
                publisher_domain=domain,
            ))
            if len(candidates) >= _MAX_CANDIDATES:
                break
        if len(candidates) >= _MAX_CANDIDATES:
            break

    return candidates


def _raw_item_from_candidate(c: DiscoveredCandidate):
    from briefly_api.agents.context import RawItem
    return RawItem(
        id=c.content_hash[:36],
        source_id="discover",
        source_type=c.source_type,
        source_name=c.source_name,
        title=c.title,
        url=c.url,
        author=None,
        published_at=c.published_at,
        clean_text=c.summary,
        content_hash=c.content_hash,
        summary=c.summary,
        embedding=c.embedding,
        relevance_score=c.relevance_score,
    )


def _explain_pick(candidate: DiscoveredCandidate, score_pct: int) -> str:
    topic = candidate.intent.phrase
    reason = candidate.discovery_reason or candidate.intent.reason
    if reason == "coverage_gap":
        return (
            f"You've been engaging with {topic}, but your subscriptions haven't covered it lately. "
            f"This fresh piece ({score_pct}% match) fills that gap."
        )
    if reason == "behavioral":
        return (
            f"Based on what you've been reading deeply, {topic} is a core interest for you right now. "
            f"This article from outside your feeds scored {score_pct}% relevance."
        )
    if reason == "recent_engagement":
        return (
            f"Connected to topics you've clicked or saved recently — {score_pct}% alignment "
            f"with your current focus on {topic}."
        )
    return (
        f"Highly aligned with your interests in {topic} ({score_pct}% match) — "
        f"from a source you haven't subscribed to yet."
    )


async def _score_candidates(
    candidates: list[DiscoveredCandidate],
    profile: UserProfile,
    profile_embedding: list[float] | None,
    seen_hashes: set[str],
    never_show: list[str],
) -> list[DiscoveredCandidate]:
    if not candidates:
        return []

    profile_dict = {
        "role": profile.role,
        "goal": profile.goal,
        "interests": profile.interests or [],
        "never_show": never_show,
        "topic_clusters": profile.topic_clusters or [],
        "deprioritized_topics": [],
    }
    interest_model = build_interest_model(profile_dict, profile.topic_clusters or [])

    embedder = get_embedding_adapter()
    if not profile_embedding:
        text = _profile_to_text(profile_dict)
        if text:
            profile_embedding = await embedder.embed(text)

    needing_embed = [c for c in candidates if not c.embedding]
    if needing_embed:
        texts = [f"{c.title} | {c.summary}" for c in needing_embed]
        try:
            embeddings = await embedder.embed_batch(texts)
            for c, emb in zip(needing_embed, embeddings):
                c.embedding = emb
        except Exception as exc:
            log.warning("Discovery batch embed failed: %s", exc)

    scored: list[DiscoveredCandidate] = []
    for c in candidates:
        if c.content_hash in seen_hashes:
            continue
        text = f"{c.title} {c.summary}"
        if _matches_never_show(text, never_show):
            continue
        age = _age_days(c.published_at)
        if age is not None and age > _MAX_AGE_DAYS:
            continue
        if len(c.summary.strip()) < 20 and len(c.title) < 15:
            continue

        item = _raw_item_from_candidate(c)
        topic_score = topic_alignment_score(item, interest_model)
        semantic = _cosine_similarity(profile_embedding, c.embedding) if profile_embedding and c.embedding else 0.5
        recency = _recency_score(c.published_at)
        intent_boost = min(0.12, c.intent.weight * 0.08)

        final = (
            0.42 * semantic
            + 0.28 * topic_score
            + 0.18 * recency
            + 0.07 * min(1.0, c.intent.weight)
            + intent_boost
        )
        if c.intent.reason == "coverage_gap":
            final += 0.06
        elif c.intent.reason == "behavioral":
            final += 0.04

        c.relevance_score = round(min(1.0, max(0.0, final)), 4)
        c.discovery_reason = c.intent.reason
        if c.relevance_score >= _SCORE_THRESHOLD:
            score_pct = int(c.relevance_score * 100)
            c.why_relevant = _explain_pick(c, score_pct)
            scored.append(c)

    scored.sort(key=lambda x: -x.relevance_score)
    return scored


def _select_diverse(candidates: list[DiscoveredCandidate], limit: int) -> list[DiscoveredCandidate]:
    selected: list[DiscoveredCandidate] = []
    used_domains: set[str] = set()
    used_titles: set[str] = set()

    for c in candidates:
        domain = c.publisher_domain or _domain(c.url)
        title_key = re.sub(r"\W+", "", c.title.lower())[:80]
        if domain and domain in used_domains:
            continue
        if title_key in used_titles:
            continue
        selected.append(c)
        if domain:
            used_domains.add(domain)
        used_titles.add(title_key)
        if len(selected) >= limit:
            break

    if len(selected) < limit:
        for c in candidates:
            if c not in selected:
                selected.append(c)
            if len(selected) >= limit:
                break
    return selected


def _candidate_to_dict(c: DiscoveredCandidate) -> dict:
    return {
        "id": _uuid(),
        "title": c.title,
        "url": c.url,
        "source_name": c.source_name,
        "summary": c.summary,
        "published_at": c.published_at.isoformat() if c.published_at else None,
        "feed_url": c.feed_url,
        "source_type": c.source_type,
        "relevance_score": c.relevance_score,
        "discovery_reason": c.discovery_reason,
        "why_relevant": c.why_relevant,
        "intent_topic": c.intent.phrase,
        "publisher_domain": c.publisher_domain,
        "content_hash": c.content_hash,
    }


def _cache_fresh(profile: UserProfile) -> bool:
    at = profile.discovered_articles_at
    if not at:
        return False
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - at < timedelta(hours=_CACHE_TTL_HOURS)


async def discover_relevant_content(
    session: AsyncSession,
    user_id: str,
    *,
    settings: Settings | None = None,
    limit: int = _DASHBOARD_LIMIT,
    force_refresh: bool = False,
) -> list[dict]:
    """Run the full discovery pipeline and return ranked article dicts."""
    s = settings or get_settings()

    profile_result = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        return []

    if not force_refresh and _cache_fresh(profile) and profile.discovered_articles:
        return list(profile.discovered_articles or [])[:limit]

    fp_result = await session.execute(
        select(BehavioralFingerprint).where(BehavioralFingerprint.user_id == user_id)
    )
    fingerprint = fp_result.scalar_one_or_none()

    intents = await _build_discovery_intents(session, user_id, profile, fingerprint)
    if not intents:
        intents = [DiscoveryIntent(phrase="technology innovation", weight=0.7, reason="declared")]

    subscribed = await _subscribed_domains(session, user_id)
    seen_hashes = await get_seen_content_hashes(session, user_id, days=30)
    never_show = profile.never_show or []

    candidates = await _harvest_candidates(intents, s, subscribed)
    profile_embedding = list(profile.profile_embedding) if profile.profile_embedding else None
    scored = await _score_candidates(candidates, profile, profile_embedding, seen_hashes, never_show)
    top = _select_diverse(scored, limit)

    articles = [_candidate_to_dict(c) for c in top]
    profile.discovered_articles = articles
    profile.discovered_articles_at = datetime.now(timezone.utc)
    meta = dict(profile.discovery_meta or {})
    meta["last_content_discovery"] = {
        "at": profile.discovered_articles_at.isoformat(),
        "intents": [i.phrase for i in intents[:6]],
        "candidates_harvested": len(candidates),
        "candidates_scored": len(scored),
        "articles_surfaced": len(articles),
    }
    profile.discovery_meta = meta

    await session.commit()
    log.info(
        "Content discovery: user=%s harvested=%d scored=%d surfaced=%d",
        user_id, len(candidates), len(scored), len(articles),
    )
    return articles


async def discover_and_cache_for_user(session: AsyncSession, user_id: str) -> int:
    """Scheduler hook — run discovery after nightly ingestion."""
    articles = await discover_relevant_content(session, user_id, force_refresh=True)
    return len(articles)


def get_cached_discoveries(profile: UserProfile | None, *, limit: int = _DASHBOARD_LIMIT) -> list[dict]:
    if not profile or not profile.discovered_articles:
        return []
    return list(profile.discovered_articles)[:limit]


