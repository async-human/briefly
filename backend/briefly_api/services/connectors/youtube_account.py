"""
briefly_api/services/connectors/youtube_account.py

YouTubeAccountConnector — fetches content from ALL YouTube signals for the
connected user account:

  1. Subscriptions  — channels the user follows (broad coverage)
  2. Liked videos   — explicit intent signal (highest quality)
  3. User playlists — curated collections the user maintains

Liked videos appear first in the merged pool so the relevance agent
surfaces them preferentially over subscription content.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import YOUTUBE_ACCOUNT

log = logging.getLogger(__name__)

_API_HINT = (
    "Enable YouTube Data API v3 in Google Cloud Console: "
    "console.cloud.google.com/apis/library/youtube.googleapis.com"
)
_EMPTY_HINT = (
    "No YouTube content found. Possible causes: "
    "(1) subscriptions are private — YouTube → Settings → Privacy → uncheck 'Keep all my subscriptions private'; "
    "(2) you have no liked videos; "
    "(3) YouTube Data API v3 is not enabled in Google Cloud Console."
)


class YoutubeAccountConnector(BaseConnector):
    source_type = YOUTUBE_ACCOUNT
    label = "YouTube (subscriptions + liked videos)"
    detect_hint = "We'll fetch videos from your subscriptions, liked videos, and playlists."

    def normalize_identifier(self, identifier: str) -> str:
        return identifier.strip().lower()

    def can_handle(self, identifier: str) -> bool:
        return False  # Connected via OAuth, not pasted input

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 40,
        source_name: str | None = None,
        meta: dict | None = None,
        db: AsyncSession | None = None,
    ) -> list[NormalizedContent]:
        if not db or not meta or not meta.get("user_id"):
            raise ValueError("YouTube account source requires an authenticated user connection.")

        from briefly_api.auth.youtube import get_youtube_connection, refresh_youtube_access_token
        from briefly_api.services.youtube import fetch_youtube_content

        connection = await get_youtube_connection(db, meta["user_id"])
        if not connection:
            raise ValueError("YouTube is not connected. Connect YouTube in onboarding or settings.")

        access_token = await refresh_youtube_access_token(connection, settings)
        await db.commit()

        max_total = min(limit, 40)
        max_channels = min(50, max(10, max_total // 2))

        try:
            articles, counts = await fetch_youtube_content(
                access_token,
                settings.reddit_user_agent,
                max_channels=max_channels,
                max_total=max_total,
            )
        except Exception as exc:
            err = str(exc)
            if "403" in err or "PERMISSION_DENIED" in err:
                raise ValueError(_API_HINT) from exc
            raise

        if not articles:
            raise ValueError(_EMPTY_HINT)

        log.info(
            "YouTubeAccountConnector: %d items — %d channels, %d liked, %d playlist(s)",
            len(articles),
            counts.get("subscriptions", 0),
            counts.get("liked", 0),
            counts.get("playlists", 0),
        )
        return [_to_normalized(a) for a in articles]

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        return ConnectorValidation(valid=True)


def _to_normalized(article) -> NormalizedContent:
    return NormalizedContent(
        title=article.title,
        url=article.url,
        source_name=article.source_name,
        source_type="youtube",
        section="YouTube",
        author=getattr(article, "author", None),
        published_at=getattr(article, "published_at", None),
        clean_text=article.clean_text or article.summary,
        summary=article.summary,
    )
