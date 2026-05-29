"""
briefly_api/services/connectors/youtube_account.py

YouTubeAccountConnector — fetches videos from ALL channels the user
subscribes to on YouTube, using their connected OAuth token.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import YOUTUBE_ACCOUNT

log = logging.getLogger(__name__)

_SUBS_PRIVATE_HINT = (
    "No YouTube subscriptions found. In YouTube → Settings → Privacy, turn OFF "
    "'Keep all my subscriptions private', then reconnect YouTube."
)
_API_HINT = (
    "Enable YouTube Data API v3 in Google Cloud Console: "
    "console.cloud.google.com/apis/library/youtube.googleapis.com"
)


class YoutubeAccountConnector(BaseConnector):
    source_type = YOUTUBE_ACCOUNT
    label = "YouTube subscriptions"
    detect_hint = "We'll fetch videos from all channels you subscribe to."

    def normalize_identifier(self, identifier: str) -> str:
        return identifier.strip().lower()

    def can_handle(self, identifier: str) -> bool:
        return False

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
        from briefly_api.services.youtube import fetch_subscription_videos

        connection = await get_youtube_connection(db, meta["user_id"])
        if not connection:
            raise ValueError("YouTube is not connected. Connect YouTube in onboarding or settings.")

        access_token = await refresh_youtube_access_token(connection, settings)
        await db.commit()

        max_total = min(limit, 40)
        max_channels = min(30, max(10, max_total // 2))

        try:
            articles, channel_count = await fetch_subscription_videos(
                access_token,
                settings.reddit_user_agent,
                max_channels=max_channels,
                videos_per_channel=2,
                max_total=max_total,
            )
        except Exception as exc:
            err = str(exc)
            if "403" in err or "PERMISSION_DENIED" in err:
                raise ValueError(_API_HINT) from exc
            raise

        if channel_count == 0:
            raise ValueError(_SUBS_PRIVATE_HINT)

        if not articles:
            raise ValueError(
                f"Found {channel_count} subscribed channels but no recent videos. "
                "Try again later or add a specific channel URL instead."
            )

        log.info(
            "YouTubeAccountConnector: %d videos from %d channels",
            len(articles),
            channel_count,
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
        author=article.author,
        published_at=article.published_at,
        clean_text=article.clean_text or article.summary,
        summary=article.summary,
    )
