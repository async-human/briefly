"""
briefly_api/agents/memory.py

MemoryAgent: connects incoming items to stories the user has been following
and automatically promotes recurring topics to tracked story threads.

Two responsibilities:
  1. Memory connections — for each enriched item, find active story threads
     that overlap (keyword match). BriefingWriterAgent uses these to say
     "Update to Monday's story about X."

  2. Story thread detection — count how many of the last 14 days' digests
     touched each topic keyword. If a topic appears in 3+ distinct digests,
     automatically classify it as a story_thread in UserMemory. This is how
     Briefly "notices" when the user is following a recurring story without
     ever being told to.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.agents.context import PipelineContext
from briefly_api.db.models import Digest, DigestItem, UserMemory
from briefly_api.services.profile_utils import cluster_label

log = logging.getLogger(__name__)

# Keyword overlap threshold to match an item to a thread
_OVERLAP_THRESHOLD = 2
# How many distinct digest dates a topic must appear in to become a story thread
_THREAD_MIN_APPEARANCES = 3
# Days lookback for story thread detection
_THREAD_LOOKBACK_DAYS = 14


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    1. Match enriched items to active story threads → ctx.memory_connections
    2. Detect new story threads from recent digest history → upsert UserMemory
    """
    threads = ctx.user.active_story_threads
    connections: dict[str, list[dict]] = {}

    # ── Step 1: match items to active threads ─────────────────────────────────
    if threads:
        for item in ctx.enriched_items:
            item_text = f"{item.title} {item.summary}".lower()
            item_connections = []

            for thread in threads:
                thread_key = thread.get("key", "").lower()
                value = thread.get("value", {})
                description = value.get("description", thread_key)

                thread_words = {w for w in thread_key.split() if len(w) > 3}
                item_words = {w for w in item_text.split() if len(w) > 3}
                overlap = len(thread_words & item_words)

                if overlap >= _OVERLAP_THRESHOLD:
                    item_connections.append({
                        "type": "update_to",
                        "thread_key": thread_key,
                        "description": f"You've been following this story: {description}",
                        "strength": thread.get("strength", 1.0),
                        "occurrence_count": thread.get("occurrence_count", 1),
                        "first_seen": value.get("first_seen"),
                    })

            if item_connections:
                connections[item.id] = item_connections

    ctx.memory_connections = connections
    log.info(
        "MemoryAgent: found %d memory connections across %d items",
        sum(len(v) for v in connections.values()), len(connections),
    )

    # ── Step 2: detect new story threads from recent history ──────────────────
    if ctx.db_session:
        try:
            await _detect_story_threads(ctx)
        except Exception as exc:
            log.exception("MemoryAgent: story thread detection failed: %s", exc)
            ctx.log_error("MemoryAgent", f"story_thread_detection: {exc}")

    return ctx


async def _detect_story_threads(ctx: PipelineContext) -> None:
    """
    Scan the last 14 days of digest items and count how many distinct digest
    dates each topic keyword appeared in. Topics that appear in 3+ distinct
    digests are upserted as story_thread memories.

    Topic keywords come from:
    - User's declared interests
    - User's top topic clusters
    """
    session = ctx.db_session
    cutoff = datetime.now(timezone.utc) - timedelta(days=_THREAD_LOOKBACK_DAYS)

    # Build keyword list from user interests + clusters
    keywords: dict[str, str] = {}  # lower → canonical
    for interest in (ctx.user.profile.get("interests") or []):
        topic = (interest.get("topic") or "").strip()
        if topic and len(topic) > 3:
            keywords[topic.lower()] = topic

    for cluster in (ctx.user.topic_clusters or []):
        label = cluster_label(cluster)
        if label and len(label) > 3:
            keywords[label.lower()] = label

    if not keywords:
        return

    # Fetch recent digest items (headline + why_it_matters)
    result = await session.execute(
        select(Digest.digest_date, DigestItem.headline, DigestItem.why_it_matters, DigestItem.source_name)
        .join(DigestItem, DigestItem.digest_id == Digest.id)
        .where(
            Digest.user_id == ctx.user.user_id,
            Digest.created_at >= cutoff,
        )
        .order_by(Digest.digest_date.desc())
        .limit(200)
    )
    rows = result.all()

    if not rows:
        return

    # Count distinct digest_dates per keyword
    topic_dates: dict[str, set[str]] = {kw: set() for kw in keywords}
    topic_latest_headline: dict[str, str] = {}

    for digest_date, headline, why, source_name in rows:
        item_text = " ".join(filter(None, [headline, why, source_name])).lower()
        for kw in keywords:
            kw_words = {w for w in kw.split() if len(w) > 3}
            if kw_words and any(w in item_text for w in kw_words):
                topic_dates[kw].add(digest_date)
                if kw not in topic_latest_headline and headline:
                    topic_latest_headline[kw] = headline

    # Batch-load all existing story-thread memories in one query instead of
    # issuing a SELECT per keyword (N+1 pattern that adds 50-100ms per topic).
    active_kws = {
        kw for kw, dates in topic_dates.items()
        if len(dates) >= _THREAD_MIN_APPEARANCES
    }
    existing_result = await session.execute(
        select(UserMemory).where(
            UserMemory.user_id == ctx.user.user_id,
            UserMemory.memory_type == "story_thread",
            UserMemory.key.in_(active_kws),
        )
    )
    existing_memories: dict[str, UserMemory] = {
        m.key: m for m in existing_result.scalars().all()
    }

    # Upsert story threads for topics that cross the threshold
    for kw, dates in topic_dates.items():
        if len(dates) < _THREAD_MIN_APPEARANCES:
            continue

        canonical = keywords[kw]
        latest_headline = topic_latest_headline.get(kw, "")
        first_date = min(dates) if dates else ""

        memory = existing_memories.get(kw)

        if memory:
            # Update existing thread
            memory.occurrence_count = len(dates)
            memory.last_seen_at = datetime.now(timezone.utc)
            memory.strength = min(1.0, memory.strength + 0.05)
            val = dict(memory.value or {})
            val["appearance_count"] = len(dates)
            val["latest_headline"] = latest_headline
            val["topic"] = canonical
            memory.value = val
        else:
            # Create new story thread
            memory = UserMemory(
                user_id=ctx.user.user_id,
                memory_type="story_thread",
                key=kw,
                value={
                    "topic": canonical,
                    "first_seen": first_date,
                    "appearance_count": len(dates),
                    "latest_headline": latest_headline,
                    "description": canonical,
                },
                strength=0.6,
                occurrence_count=len(dates),
            )
            session.add(memory)

    await session.flush()
    log.info(
        "MemoryAgent: story thread detection complete — %d topics tracked for user %s",
        sum(1 for d in topic_dates.values() if len(d) >= _THREAD_MIN_APPEARANCES),
        ctx.user.user_id,
    )
