from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import get_current_user
from briefly_api.db.engine import get_db
from briefly_api.db.models import Source, User

FREE_SOURCE_LIMIT = 3
FREE_HISTORY_DAYS = 7
FREE_DIGEST_ITEMS = 5


def require_pro(user: User = Depends(get_current_user)) -> User:
    if user.plan != "pro":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This feature is available on the Pro plan. Upgrade at sendbriefly.app/#pricing.",
        )
    return user


async def check_source_limit(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if user.plan == "pro":
        return user
    result = await db.execute(
        select(func.count()).select_from(Source).where(Source.user_id == user.id)
    )
    count = result.scalar() or 0
    if count >= FREE_SOURCE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Free plan allows up to {FREE_SOURCE_LIMIT} sources. Upgrade to Pro for unlimited sources.",
        )
    return user
