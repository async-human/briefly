from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.config import get_settings
from briefly_api.db.engine import get_db
from briefly_api.db.models import Source, User
from briefly_api.services.connectors.types import INTERNAL_SOURCE_TYPES

FREE_SOURCE_LIMIT = 3
FREE_HISTORY_DAYS = 7
FREE_DIGEST_ITEMS = 5


def billable_source_filter():
    """SQLAlchemy filter: sources that count toward the free-plan slot limit."""
    return Source.source_type.not_in(INTERNAL_SOURCE_TYPES)


async def count_billable_sources(db: AsyncSession, user_id: str) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Source)
        .where(Source.user_id == user_id, billable_source_filter())
    )
    return result.scalar() or 0


def has_pro_access(user: User) -> bool:
    if user.plan == "pro":
        return True
    email = (user.email or "").strip().lower()
    return email in get_settings().pro_bypass_email_set


def require_pro(user: User = Depends(get_current_user)) -> User:
    if not has_pro_access(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This feature is available on the Pro plan. Upgrade at sendbriefly.app/#pricing.",
        )
    return user


async def check_source_limit(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if has_pro_access(user):
        return user
    count = await count_billable_sources(db, user.id)
    if count >= FREE_SOURCE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Free plan allows up to {FREE_SOURCE_LIMIT} sources. Upgrade to Pro for unlimited sources.",
        )
    return user
