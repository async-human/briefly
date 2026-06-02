"""User activity events — replaces unbounded JSONB on UserProfile."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.db.models import UserActivityEvent

MAX_STORED_EVENTS = 100
DEFAULT_LIST_LIMIT = 10


async def append_activity(
    session: AsyncSession,
    user_id: str,
    event_type: str,
    message: str,
    *,
    meta: dict | None = None,
) -> None:
    session.add(
        UserActivityEvent(
            user_id=user_id,
            event_type=event_type,
            message=message,
            meta=meta or {},
        )
    )
    await session.flush()

    count_result = await session.execute(
        select(func.count()).select_from(UserActivityEvent).where(UserActivityEvent.user_id == user_id)
    )
    total = count_result.scalar_one()
    if total > MAX_STORED_EVENTS:
        trim = total - MAX_STORED_EVENTS
        oldest = await session.execute(
            select(UserActivityEvent.id)
            .where(UserActivityEvent.user_id == user_id)
            .order_by(UserActivityEvent.created_at.asc())
            .limit(trim)
        )
        ids = [row[0] for row in oldest.all()]
        if ids:
            await session.execute(delete(UserActivityEvent).where(UserActivityEvent.id.in_(ids)))


async def list_activity(
    session: AsyncSession,
    user_id: str,
    *,
    limit: int = DEFAULT_LIST_LIMIT,
) -> list[dict]:
    result = await session.execute(
        select(UserActivityEvent)
        .where(UserActivityEvent.user_id == user_id)
        .order_by(UserActivityEvent.created_at.desc())
        .limit(limit)
    )
    events = result.scalars().all()
    return [
        {
            "type": e.event_type,
            "message": e.message,
            "at": e.created_at.isoformat() if e.created_at else datetime.now(timezone.utc).isoformat(),
            **(e.meta or {}),
        }
        for e in events
    ]
