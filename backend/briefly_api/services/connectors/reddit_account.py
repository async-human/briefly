"""
briefly_api/services/connectors/reddit_account.py

RedditAccountConnector — fetches hot posts from ALL subreddits the user
subscribes to, using their connected Reddit OAuth token.
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import REDDIT_ACCOUNT

log = logging.getLogger(__name__)


class RedditAccountConnector(BaseConnector):
    source_type = REDDIT_ACCOUNT
    label = "Reddit subscriptions"
    detect_hint = "We'll read hot posts from all subreddits you subscribe to."

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
            raise ValueError("Reddit account source requires an authenticated user connection.")

        from briefly_api.auth.reddit import get_reddit_connection, refresh_reddit_access_token
        from briefly_api.services.reddit import fetch_subscribed_subreddit_posts

        connection = await get_reddit_connection(db, meta["user_id"])
        if not connection:
            raise ValueError("Reddit is not connected. Connect Reddit in settings.")

        access_token = await refresh_reddit_access_token(connection, settings)

        posts_per_sub = max(1, limit // 30)

        articles, subreddit_count = await fetch_subscribed_subreddit_posts(
            access_token,
            settings.reddit_user_agent,
            max_subreddits=100,
            posts_per_sub=posts_per_sub,
        )

        log.info(
            "RedditAccountConnector: fetched %d posts from %d subscribed subreddits",
            len(articles), subreddit_count,
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
        source_type="reddit",
        section="Reddit",
        author=article.author,
        published_at=article.published_at,
        clean_text=article.clean_text,
        summary=article.summary,
    )
