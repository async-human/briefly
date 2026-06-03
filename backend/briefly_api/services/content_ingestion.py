"""
briefly_api/services/content_ingestion.py

Nightly (or on-demand) ingestion: fetch sources → upsert RawContent → embed → score.
Morning briefing reads from this pool instead of live-fetching everything.
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.config import Settings, get_settings
from briefly_api.db.models import (
    ContentEmbedding,
    ContentStatus,
    RawContent,
    Source,
    SourceStatus,
    UserProfile,
)
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.services.activity_feed import append_activity
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.collector import collect_from_sources
from briefly_api.services.connectors.types import FETCHABLE_SOURCE_TYPES
from briefly_api.services.profile_utils import cluster_label

log = logging.getLogger(__name__)

MIN_CLEAN_TEXT = 30
QUALITY_TEXT_LEN = 200


@dataclass
class IngestionSummary:
    user_id: str
    items_fetched: int = 0
    items_new: int = 0
    items_updated: int = 0
    items_skipped_quality: int = 0
    sources_ok: int = 0
    sources_failed: int = 0
    errors: list[str] = field(default_factory=list)
    by_source: dict[str, int] = field(default_factory=dict)
    duration_ms: int = 0

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "items_fetched": self.items_fetched,
            "items_new": self.items_new,
            "items_updated": self.items_updated,
            "items_skipped_quality": self.items_skipped_quality,
            "sources_ok": self.sources_ok,
            "sources_failed": self.sources_failed,
            "errors": self.errors[:10],
            "by_source": self.by_source,
            "duration_ms": self.duration_ms,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        }


def _passes_quality(article: NormalizedContent) -> bool:
    text = (article.clean_text or article.summary or "").strip()
    title = (article.title or "").strip()
    if len(text) >= QUALITY_TEXT_LEN:
        return True
    if title and article.url and len(text) >= MIN_CLEAN_TEXT:
        return True
    return bool(title and len(title) >= 12)


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def _keyword_set(profile: dict) -> set[str]:
    keywords: set[str] = set()
    for interest in profile.get("interests") or []:
        topic = (interest.get("topic") or "").lower()
        if topic:
            keywords.add(topic)
            for word in topic.split():
                if len(word) > 3:
                    keywords.add(word)
    for entry in profile.get("topic_clusters") or []:
        label = cluster_label(entry)
        if label:
            keywords.add(label.lower())
            for word in label.split():
                if len(word) > 3:
                    keywords.add(word)
    return keywords


def _topic_score(text: str, keywords: set[str]) -> float:
    if not keywords:
        return 0.5
    lower = text.lower()
    matched = sum(1 for kw in keywords if kw in lower)
    if matched == 0:
        return 0.2
    return min(1.0, 0.4 + 0.12 * matched)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a)
    vb = np.array(b)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.5
    return float((np.dot(va, vb) / (na * nb) + 1) / 2)


async def _score_relevance(
    *,
    title: str,
    text: str,
    profile: dict,
    profile_embedding: list[float] | None,
    item_embedding: list[float],
) -> float:
    keywords = _keyword_set(profile)
    blob = f"{title} {text[:1000]}"
    topic = _topic_score(blob, keywords)
    semantic = _cosine_similarity(profile_embedding, item_embedding) if profile_embedding else 0.5
    quality = 0.7 if len(text) >= QUALITY_TEXT_LEN else 0.45
    final = 0.40 * semantic + 0.30 * topic + 0.20 * quality + 0.10 * 0.85
    return round(min(1.0, max(0.0, final)), 4)


async def ingest_user_sources(
    session: AsyncSession,
    user_id: str,
    *,
    settings: Settings | None = None,
) -> IngestionSummary:
    """Fetch all active sources for a user and upsert into RawContent."""
    started = datetime.now(timezone.utc)
    s = settings or get_settings()
    summary = IngestionSummary(user_id=user_id)

    profile_row = await session.execute(
        select(UserProfile).where(UserProfile.user_id == user_id)
    )
    profile = profile_row.scalar_one_or_none()
    if not profile:
        summary.errors.append("User profile not found")
        return summary

    sources_result = await session.execute(
        select(Source).where(
            Source.user_id == user_id,
            Source.status == SourceStatus.active,
        )
    )
    sources = [src for src in sources_result.scalars().all() if src.source_type in FETCHABLE_SOURCE_TYPES]
    if not sources:
        summary.errors.append("No fetchable sources")
        return summary

    profile_dict = {
        "interests": profile.interests or [],
        "topic_clusters": profile.topic_clusters or [],
        "never_show": profile.never_show or [],
    }
    profile_embedding = (
        list(profile.profile_embedding) if profile.profile_embedding is not None else None
    )

    articles, warnings = await collect_from_sources(
        sources,
        s,
        db=session,
        user_id=user_id,
        max_items=80,
        expanded_fetch=True,
    )
    summary.items_fetched = len(articles)
    summary.errors.extend(warnings)

    embedder = get_embedding_adapter()
    source_ok: set[str] = set()
    source_fail: set[str] = set()

    # ── Pass 1: filter, dedupe, collect texts for batch embedding ─────────────
    # Previously: 1 embed API call per article (N calls total).
    # Now: 1 batch call for all articles combined — 10-80x faster.
    valid: list[tuple] = []  # (article, text, content_hash, existing_row)
    for article in articles:
        if not _passes_quality(article):
            summary.items_skipped_quality += 1
            continue
        text = (article.clean_text or article.summary or article.title or "").strip()
        if len(text) < MIN_CLEAN_TEXT and not article.title:
            summary.items_skipped_quality += 1
            continue
        content_hash = _content_hash(text or article.title or "")
        existing = await session.execute(
            select(RawContent)
            .options(selectinload(RawContent.embedding))
            .where(
                RawContent.source_id == article.source_id,
                RawContent.content_hash == content_hash,
            )
        )
        row = existing.scalar_one_or_none()
        valid.append((article, text, content_hash, row))

    # Single batch embedding call for all valid articles
    embed_texts = [f"{a.title or ''} | {t[:500]}" for a, t, _, _ in valid]
    try:
        embeddings: list[list[float] | None] = list(await embedder.embed_batch(embed_texts)) if embed_texts else []
    except Exception as exc:
        log.warning("Batch embedding failed: %s — proceeding without embeddings", exc)
        embeddings = [None] * len(valid)

    # ── Pass 2: upsert each article using pre-computed embeddings ─────────────
    for (article, text, content_hash, row), item_embedding in zip(valid, embeddings):
        relevance = 0.5
        if item_embedding:
            relevance = await _score_relevance(
                title=article.title or "",
                text=text,
                profile=profile_dict,
                profile_embedding=profile_embedding,
                item_embedding=item_embedding,
            )

        if row:
            row.title = article.title
            row.url = article.url
            row.author = article.author
            row.published_at = article.published_at
            row.clean_text = text
            row.summary = article.summary or text[:400]
            row.relevance_score = relevance
            row.status = ContentStatus.pending
            row.meta = {**(row.meta or {}), "ingested_via": "worker", **(article.meta or {})}
            summary.items_updated += 1
            content_id = row.id
        else:
            content_id = str(uuid.uuid4())
            row = RawContent(
                id=content_id,
                source_id=article.source_id,
                user_id=user_id,
                status=ContentStatus.pending,
                title=article.title,
                url=article.url,
                author=article.author,
                published_at=article.published_at,
                clean_text=text,
                raw_text=text,
                summary=article.summary or text[:400],
                content_hash=content_hash,
                relevance_score=relevance,
                meta={"ingested_via": "worker", **(article.meta or {})},
            )
            session.add(row)
            summary.items_new += 1

        if item_embedding:
            if row.embedding:
                row.embedding.embedding = item_embedding
            else:
                session.add(
                    ContentEmbedding(
                        content_id=content_id,
                        embedding=item_embedding,
                        model=s.embedding_model,
                    )
                )

        src_name = article.source_name or article.source_id
        summary.by_source[src_name] = summary.by_source.get(src_name, 0) + 1
        source_ok.add(article.source_id)

    now = datetime.now(timezone.utc)
    for src in sources:
        if src.id in source_ok:
            src.last_fetched_at = now
            src.last_successful_fetch_at = now
            src.error_count = 0
            src.last_error = None
            summary.sources_ok += 1
        elif src.id not in source_fail:
            summary.sources_failed += 1

    # Persist ingestion summary on profile
    meta = dict(profile.ingestion_meta or {})
    await append_activity(
        session,
        user_id,
        "ingestion",
        (
            f"Ingested {summary.items_new} new and {summary.items_updated} updated items "
            f"from {summary.sources_ok} sources"
        ),
    )
    profile.ingestion_meta = {
        **meta,
        "last_run_at": now.isoformat(),
        "last_run_date": now.strftime("%Y-%m-%d"),
        "last_summary": summary.to_dict(),
    }
    profile.last_ingestion_at = now

    await session.commit()

    summary.duration_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    log.info(
        "Ingestion complete user=%s new=%d updated=%d skipped=%d ms=%d",
        user_id, summary.items_new, summary.items_updated,
        summary.items_skipped_quality, summary.duration_ms,
    )
    return summary


async def mark_contents_processed(session: AsyncSession, content_ids: list[str]) -> None:
    if not content_ids:
        return
    await session.execute(
        update(RawContent)
        .where(RawContent.id.in_(content_ids))
        .values(status=ContentStatus.processed)
    )
