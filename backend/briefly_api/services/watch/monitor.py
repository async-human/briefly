"""Watch monitor — fetch, score, dedupe, persist, and optionally push."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.config import get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import (
    EntityAlert,
    ProactiveSurfacingEvent,
    RawContent,
    UserProfile,
    WatchedEntity,
)
from briefly_api.embeddings.adapter import get_embedding_adapter
from briefly_api.services.watch.relevance import (
    WatchHit,
    canonicalize_url,
    cosine_similarity,
    dedupe_hits,
    score_hit,
)
from briefly_api.services.watch.sources import fetch_entity_hits, maybe_discover_blog, seed_sources
from briefly_api.services.watch.summarize import write_alert_copy

log = logging.getLogger(__name__)


def _aware(ts: datetime | None) -> datetime | None:
    if ts is None:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


async def _pool_hits(session, user_id: str, entity: WatchedEntity, since: datetime) -> list[WatchHit]:
    rows = (
        await session.execute(
            select(RawContent)
            .where(
                RawContent.user_id == user_id,
                RawContent.ingested_at >= since,
            )
            .order_by(RawContent.ingested_at.desc())
            .limit(120)
        )
    ).scalars().all()
    hits: list[WatchHit] = []
    name = entity.name.lower()
    aliases = {a.lower() for a in (entity.aliases or []) if a}
    keywords = {k.lower() for k in (entity.keywords or []) if k}
    needles = {name, *aliases, *keywords}
    needles = {n for n in needles if len(n) >= 3}
    for item in rows:
        text = f"{item.title or ''} {(item.clean_text or '')[:400]}".lower()
        if not any(n in text for n in needles):
            continue
        url = canonicalize_url(item.url or "") or f"pool:{item.id}"
        hits.append(
            WatchHit(
                title=(item.title or "").strip() or entity.name,
                url=url,
                source_name="Your sources",
                source_type="pool",
                summary=(item.summary or item.clean_text or "")[:1500],
                published_at=item.published_at or item.ingested_at,
                is_official=False,
            )
        )
    return hits


async def _semantic(hit: WatchHit, entity: WatchedEntity) -> float | None:
    try:
        embedder = get_embedding_adapter()
        entity_vec, content_vec = await embedder.embed_batch([
            f"{entity.kind}: {entity.name}",
            f"{hit.title} {hit.summary[:400]}",
        ])
        return cosine_similarity(entity_vec, content_vec)
    except Exception:
        return None


async def _click_rate(session, entity_id: str) -> float:
    total = (
        await session.execute(
            select(func.count()).select_from(EntityAlert).where(EntityAlert.entity_id == entity_id)
        )
    ).scalar() or 0
    if total < 3:
        return 0.0
    read = (
        await session.execute(
            select(func.count()).select_from(EntityAlert).where(
                EntityAlert.entity_id == entity_id,
                EntityAlert.is_read.is_(True),
            )
        )
    ).scalar() or 0
    return read / total


async def _unread_count(session, entity_id: str) -> int:
    return int(
        (
            await session.execute(
                select(func.count()).select_from(EntityAlert).where(
                    EntityAlert.entity_id == entity_id,
                    EntityAlert.is_read.is_(False),
                )
            )
        ).scalar()
        or 0
    )


def _should_skip(entity: WatchedEntity, now: datetime, min_minutes: int) -> bool:
    last = _aware(entity.last_checked)
    if not last:
        return False
    interval = min_minutes if (entity.priority or 1) >= 2 else min_minutes * 2
    return now - last < timedelta(minutes=interval)


async def monitor_entity(session, entity: WatchedEntity, *, force: bool = False) -> int:
    s = get_settings()
    if not s.watch_monitor_enabled or not entity.is_active:
        return 0

    now = datetime.now(timezone.utc)
    if not force and _should_skip(entity, now, s.watch_rss_min_interval_minutes):
        return 0

    if await _unread_count(session, entity.id) >= s.watch_max_unread_per_entity:
        entity.last_checked = now
        log.info("Watch pause: %s has too many unread alerts", entity.name)
        return 0

    await seed_sources(session, entity)
    try:
        await maybe_discover_blog(session, entity)
    except Exception:
        log.debug("Watch discover skipped for %s", entity.name, exc_info=True)

    lookback = now - timedelta(days=7) if force else now - timedelta(hours=36)
    external, sources_checked = await fetch_entity_hits(
        session,
        entity,
        min_interval_minutes=s.watch_rss_min_interval_minutes,
        since=lookback,
        force=force,
    )
    pool = await _pool_hits(session, entity.user_id, entity, lookback)
    combined = dedupe_hits(external + pool)

    click_rate = await _click_rate(session, entity.id)
    created = 0
    urgent_copy: tuple[str, str] | None = None
    profile_row = (
        await session.execute(select(UserProfile).where(UserProfile.user_id == entity.user_id))
    ).scalar_one_or_none()
    operating_ctx = dict(getattr(profile_row, "operating_context", None) or {})

    for hit in combined:
        if created >= s.watch_max_alerts_per_entity_per_run:
            break
        base = score_hit(
            hit,
            entity_name=entity.name,
            kind=entity.kind,
            keywords=list(entity.keywords or []),
            aliases=list(entity.aliases or []),
            semantic=None,
            click_rate=click_rate,
            now=now,
        )
        score = base
        if base < s.watch_relevance_min_score:
            if base < 0.45:
                continue
            semantic = await _semantic(hit, entity)
            score = score_hit(
                hit,
                entity_name=entity.name,
                kind=entity.kind,
                keywords=list(entity.keywords or []),
                aliases=list(entity.aliases or []),
                semantic=semantic,
                click_rate=click_rate,
                now=now,
            )
        hit.score = score
        if score < s.watch_relevance_min_score:
            continue

        copy = await write_alert_copy(entity.name, entity.kind, hit, user_id=entity.user_id)
        is_urgent = copy.is_urgent or hit.is_official or score >= s.watch_urgent_score

        from briefly_api.services.signals.detectors import classify_change

        detector = classify_change(
            title=hit.title,
            summary=hit.summary or copy.summary,
            source_type=hit.source_type,
            entity_name=entity.name,
            entity_kind=entity.kind,
        )
        from briefly_api.services.signals.snapshots import event_fingerprint

        alert_fingerprint = event_fingerprint(
            detector.detector_type,
            detector.new_state or detector.extracted_claim or hit.title,
            hit.url,
        )

        stmt = (
            pg_insert(EntityAlert)
            .values(
                id=str(uuid.uuid4()),
                user_id=entity.user_id,
                entity_id=entity.id,
                title=hit.title[:500],
                summary=copy.summary,
                what_changed=copy.what_changed[:500],
                why_it_matters=copy.why_it_matters[:500],
                action=copy.action[:300],
                source_url=hit.url,
                event_fingerprint=alert_fingerprint,
                source_name=hit.source_name[:200],
                published_at=hit.published_at,
                relevance_score=score,
                is_urgent=is_urgent,
                related_urls=hit.related_urls[:8],
                sources_checked=sources_checked,
                detector_type=detector.detector_type,
                confidence=float(detector.confidence or 0),
            )
            .on_conflict_do_nothing()
            .returning(EntityAlert.id)
        )
        inserted = (await session.execute(stmt)).scalar_one_or_none()
        if not inserted:
            continue
        created += 1
        try:
            from briefly_api.services.signals.persist import persist_market_signal

            async with session.begin_nested():
                await persist_market_signal(
                    session,
                    user_id=entity.user_id,
                    entity_id=entity.id,
                    title=hit.title,
                    source_url=hit.url,
                    source_name=hit.source_name,
                    published_at=hit.published_at,
                    detector=detector,
                    what_changed=copy.what_changed,
                    why_it_matters=copy.why_it_matters,
                    action=copy.action,
                    operating_context=operating_ctx,
                    alert_id=inserted,
                    related_urls=list(hit.related_urls or []),
                    relevance_score=score,
                    is_urgent=is_urgent,
                )
        except Exception:
            log.debug("Watch monitor: market signal persist failed", exc_info=True)
        if is_urgent and urgent_copy is None:
            urgent_copy = (hit.title, copy.summary)

    entity.last_checked = now
    if created:
        entity.last_alerted_at = now

    if urgent_copy:
        recent_push = (
            await session.execute(
                select(ProactiveSurfacingEvent.id).where(
                    ProactiveSurfacingEvent.user_id == entity.user_id,
                    ProactiveSurfacingEvent.event_type == "watched_entity",
                    ProactiveSurfacingEvent.thread_key == entity.name,
                    ProactiveSurfacingEvent.created_at >= now - timedelta(hours=6),
                ).limit(1)
            )
        ).scalar_one_or_none()
        if not recent_push:
            session.add(
                ProactiveSurfacingEvent(
                    user_id=entity.user_id,
                    event_type="watched_entity",
                    title=f"{entity.name}: {urgent_copy[0]}"[:180],
                    body=urgent_copy[1][:400],
                    content_ids=[],
                    thread_key=entity.name,
                    priority=9,
                )
            )

    if created:
        await session.flush()
        log.info(
            "Watch monitor: %s user=%s new_alerts=%d sources=%d",
            entity.name, entity.user_id, created, sources_checked,
        )
    return created


async def run_for_user(session, user_id: str, *, force: bool = False) -> dict:
    s = get_settings()
    if not s.watch_monitor_enabled:
        return {"skipped": True}

    profile = (
        await session.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    ).scalar_one_or_none()
    if profile and not profile.onboarding_completed:
        return {"skipped": True, "reason": "onboarding"}

    entities = (
        await session.execute(
            select(WatchedEntity).where(
                WatchedEntity.user_id == user_id,
                WatchedEntity.is_active.is_(True),
            )
        )
    ).scalars().all()
    created = 0
    for ent in entities:
        try:
            created += await monitor_entity(session, ent, force=force)
        except Exception:
            log.exception("Watch monitor failed for entity %s", ent.id)
    return {"entities": len(entities), "alerts": created}


async def run_watch_scan_job(payload: dict | None = None) -> None:
    payload = payload or {}
    user_id = payload.get("user_id")
    entity_id = payload.get("entity_id")
    force = bool(payload.get("force"))

    async with SessionLocal() as session:
        if entity_id:
            ent = (
                await session.execute(select(WatchedEntity).where(WatchedEntity.id == entity_id))
            ).scalar_one_or_none()
            if ent:
                await monitor_entity(session, ent, force=True)
                await session.commit()
            return

        if user_id:
            await run_for_user(session, user_id, force=force)
            await session.commit()
            return

        rows = (
            await session.execute(
                select(WatchedEntity.user_id)
                .where(WatchedEntity.is_active.is_(True))
                .distinct()
            )
        ).all()
        user_ids = [r[0] for r in rows]

    for uid in user_ids:
        try:
            async with SessionLocal() as session:
                await run_for_user(session, uid, force=False)
                await session.commit()
        except Exception:
            log.exception("Watch scan failed for user %s", uid)
