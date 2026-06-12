"""YouTube sync visibility — pool counts and last-fetch metadata for the UI."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings
from briefly_api.db.models import ContentStatus, OAuthConnection, RawContent, Source, UserProfile
from briefly_api.services.connectors.types import YOUTUBE, YOUTUBE_ACCOUNT

_TRANSCRIPT_MIN_LEN = 400


async def build_youtube_sync_stats(
    session: AsyncSession,
    user_id: str,
    settings: Settings,
    profile: UserProfile | None,
    youtube_conn: OAuthConnection | None,
) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.pool_max_age_hours)

    rows = await session.execute(
        select(RawContent.title, RawContent.url, RawContent.clean_text, RawContent.ingested_at)
        .join(Source, RawContent.source_id == Source.id)
        .where(
            RawContent.user_id == user_id,
            Source.source_type.in_([YOUTUBE, YOUTUBE_ACCOUNT]),
            RawContent.ingested_at >= cutoff,
            RawContent.status.in_([ContentStatus.pending, ContentStatus.processed]),
        )
        .order_by(RawContent.ingested_at.desc())
        .limit(50)
    )
    pool_rows = rows.all()
    pool_videos = len(pool_rows)
    with_transcript = sum(
        1 for row in pool_rows if len((row.clean_text or "")) >= _TRANSCRIPT_MIN_LEN
    )
    recent_videos = [
        {"title": (row.title or "Untitled")[:140], "url": row.url}
        for row in pool_rows[:5]
        if row.url
    ]

    account_src = (
        await session.execute(
            select(Source).where(
                Source.user_id == user_id,
                Source.source_type == YOUTUBE_ACCOUNT,
            )
        )
    ).scalar_one_or_none()

    manual_rows = (
        await session.execute(
            select(Source.name, Source.last_successful_fetch_at, Source.meta)
            .where(Source.user_id == user_id, Source.source_type == YOUTUBE)
        )
    ).all()
    manual_channels = [
        {
            "name": name or "YouTube channel",
            "last_fetched_at": ts.isoformat() if ts else None,
        }
        for name, ts, _ in manual_rows
    ]

    last_fetch = None
    if account_src and account_src.meta:
        last_fetch = account_src.meta.get("youtube_last_fetch")

    last_sync_items = 0
    if profile and profile.ingestion_meta:
        by_source = profile.ingestion_meta.get("last_summary", {}).get("by_source", {})
        for name, count in by_source.items():
            lower = name.lower()
            if "youtube" in lower or "youtu" in lower:
                last_sync_items += int(count)

    channel_count = None
    if youtube_conn and youtube_conn.meta:
        channel_count = youtube_conn.meta.get("channel_count")
    if account_src and account_src.meta:
        channel_count = channel_count or account_src.meta.get("channel_count")

    return {
        "connected": youtube_conn is not None,
        "channel_count": channel_count,
        "pool_videos_recent": pool_videos,
        "pool_with_transcript": with_transcript,
        "last_fetch": last_fetch,
        "last_sync_items": last_sync_items,
        "recent_videos": recent_videos,
        "manual_channel_count": len(manual_channels),
        "manual_channels": manual_channels,
    }
