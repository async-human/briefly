from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.deps import generate_email_token
from briefly_api.db.models import User, UserProfile


async def get_or_create_google_user(db: AsyncSession, google_user: dict) -> User:
    google_id = google_user["sub"]
    email = google_user["email"]
    name = google_user.get("name")
    avatar_url = google_user.get("picture")

    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()
    if user:
        user.name = name or user.name
        user.avatar_url = avatar_url or user.avatar_url
        user.is_verified = True
        await db.commit()
        await db.refresh(user)
        return user

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        user.google_id = google_id
        user.name = name or user.name
        user.avatar_url = avatar_url or user.avatar_url
        user.is_verified = True
        await db.commit()
        await db.refresh(user)
        return user

    user = User(
        email=email,
        name=name,
        google_id=google_id,
        avatar_url=avatar_url,
        email_token=generate_email_token(),
        is_verified=True,
    )
    db.add(user)
    await db.flush()

    profile = UserProfile(user_id=user.id)
    db.add(profile)
    await db.commit()
    await db.refresh(user)
    return user
