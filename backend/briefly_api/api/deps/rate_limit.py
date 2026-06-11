"""FastAPI dependencies for per-user endpoint rate limits."""
from __future__ import annotations

from fastapi import Depends

from briefly_api.auth.deps import get_current_user, require_pro
from briefly_api.config import Settings, get_settings
from briefly_api.db.models import User
from briefly_api.services.rate_limit import enforce_rate_limit


async def rate_limit_ask_dep(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    await enforce_rate_limit(
        scope="ask",
        subject=user.id,
        limit=settings.rate_limit_ask_per_hour,
        window_seconds=3600,
    )


async def rate_limit_ask_stream_dep(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    await enforce_rate_limit(
        scope="ask_stream",
        subject=user.id,
        limit=settings.rate_limit_ask_stream_per_hour,
        window_seconds=3600,
    )


async def rate_limit_transcribe_preview_dep(
    user: User = Depends(require_pro),
    settings: Settings = Depends(get_settings),
) -> None:
    await enforce_rate_limit(
        scope="transcribe_preview",
        subject=user.id,
        limit=settings.rate_limit_transcribe_preview_per_hour,
        window_seconds=3600,
    )


async def rate_limit_digest_generate_dep(
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> None:
    await enforce_rate_limit(
        scope="digest_generate",
        subject=user.id,
        limit=settings.rate_limit_digest_generate_per_hour,
        window_seconds=3600,
    )
