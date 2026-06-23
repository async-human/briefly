"""
briefly_api/services/capture_tokens.py

Long-lived, capture-scoped device tokens. One per client (browser extension,
iOS share extension / Shortcut, Android share app, PWA). The plaintext secret
is returned exactly once at creation; only its SHA-256 hash is persisted.

Format: ``bcap_<43 url-safe base64 chars>`` — high entropy, so a plain SHA-256
lookup is sufficient (no need for a slow password hash).
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.db.models import CaptureToken, User

_PREFIX = "bcap_"
_VALID_PLATFORMS = {"ios", "android", "extension", "shortcut", "web", "desktop"}


@dataclass
class CreatedToken:
    record: CaptureToken
    plaintext: str   # shown once, never stored


def _hash(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def normalize_platform(platform: str | None) -> str | None:
    if not platform:
        return None
    value = platform.strip().lower()
    return value if value in _VALID_PLATFORMS else None


async def create_token(
    db: AsyncSession, user_id: str, name: str, *, platform: str | None = None
) -> CreatedToken:
    secret = secrets.token_urlsafe(32)
    plaintext = f"{_PREFIX}{secret}"
    record = CaptureToken(
        user_id=user_id,
        name=(name or "Device").strip()[:120],
        token_hash=_hash(plaintext),
        token_prefix=plaintext[: len(_PREFIX) + 4],  # e.g. "bcap_a1b2"
        platform=normalize_platform(platform),
    )
    db.add(record)
    await db.flush()
    return CreatedToken(record=record, plaintext=plaintext)


async def list_tokens(db: AsyncSession, user_id: str) -> list[CaptureToken]:
    result = await db.execute(
        select(CaptureToken)
        .where(CaptureToken.user_id == user_id, CaptureToken.revoked_at.is_(None))
        .order_by(CaptureToken.created_at.desc())
    )
    return list(result.scalars().all())


async def revoke_token(db: AsyncSession, user_id: str, token_id: str) -> bool:
    result = await db.execute(
        select(CaptureToken).where(
            CaptureToken.id == token_id,
            CaptureToken.user_id == user_id,
            CaptureToken.revoked_at.is_(None),
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        return False
    record.revoked_at = datetime.now(timezone.utc)
    await db.flush()
    return True


def looks_like_capture_token(credential: str) -> bool:
    return credential.startswith(_PREFIX)


async def resolve_user(db: AsyncSession, credential: str) -> User | None:
    """Return the active user behind a capture token, or None. Bumps last_used_at."""
    if not looks_like_capture_token(credential):
        return None
    result = await db.execute(
        select(CaptureToken).where(
            CaptureToken.token_hash == _hash(credential),
            CaptureToken.revoked_at.is_(None),
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        return None

    user_result = await db.execute(
        select(User)
        .options(selectinload(User.profile))
        .where(User.id == record.user_id, User.is_active.is_(True))
    )
    user = user_result.scalar_one_or_none()
    if not user:
        return None

    record.last_used_at = datetime.now(timezone.utc)
    await db.flush()
    return user
