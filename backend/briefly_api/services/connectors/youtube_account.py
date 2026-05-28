"""
briefly_api/services/connectors/youtube_account.py

YouTubeAccountConnector — fetches videos from ALL channels the user
subscribes to on YouTube, using their connected OAuth token.

This is the account-connected variant. The plain YoutubeConnector
handles manually-pasted channels. This one activates when a user
has connected their YouTube account via OAuth.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import YOUTUBE_ACCOUNT

log = logging.getLogger(__name__)


class YoutubeAccountConnector(BaseConnector):
    source_type = YOUTUBE_ACCOUNT
    label = "YouTube subscriptions"
    detect_hint = "We'll fetch videos from all channels you subscribe to."

    def normalize_identifier(self, identifier: str) -> str:
        return identifier.strip().lower()

    def can_handle(self, identifier: str) -> bool:
        return False  # Connected via OAuth, not pasted input

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 60,
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
            raise ValueError("YouTube is not connected. Connect YouTube in settings.")

        access_token = await refresh_youtube_access_token(connection, settings)
        await db.commit()

        # videos_per_channel × max_channels → total pool (relevance agent selects)
        max_channels = 150
        videos_per_channel = max(2, limit // 20)

        articles, channel_count = await fetch_subscription_videos(
            access_token,
            settings.reddit_user_agent,  # reuse user-agent setting
            max_channels=max_channels,
            videos_per_channel=videos_per_channel,
        )

        log.info(
            "YouTubeAccountConnector: fetched %d videos from %d subscribed channels",
            len(articles), channel_count,
        )
        return [_to_normalized(a) for a in articles[:limit]]

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        return ConnectorValidation(valid=True)


def _to_normalized(article) -> NormalizedContent:
    from briefly_api.services.articles import NormalizedContent
    return NormalizedContent(
        title=article.title,
        url=article.url,
        source_name=article.source_name,
        source_type="youtube",
        section="YouTube",
        author=article.author,
        published_at=article.published_at,
        clean_text=article.clean_text,
        summary=article.summary,
    )
