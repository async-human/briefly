from __future__ import annotations

import asyncio
import re

import httpx

from briefly_api.config import Settings
from briefly_api.services.articles import FetchedArticle
from briefly_api.services.rss import _fetch_rss_sync


def _extract_channel_id(identifier: str) -> str | None:
    value = identifier.strip()
    if re.fullmatch(r"UC[\w-]{20,}", value):
        return value
    match = re.search(r"youtube\.com/channel/(UC[\w-]+)", value)
    if match:
        return match.group(1)
    return None


def _resolve_handle_to_channel_id_sync(handle: str, settings: Settings) -> str | None:
    """Resolve @handle to channel ID by fetching the public channel page."""
    handle = handle.removeprefix("@").strip()
    url = f"https://www.youtube.com/@{handle}"
    headers = {"User-Agent": settings.reddit_user_agent}

    with httpx.Client(timeout=20.0, follow_redirects=True, headers=headers) as client:
        if settings.youtube_api_key:
            resp = client.get(
                "https://www.googleapis.com/youtube/v3/search",
                params={
                    "part": "snippet",
                    "q": handle,
                    "type": "channel",
                    "maxResults": 1,
                    "key": settings.youtube_api_key,
                },
            )
            resp.raise_for_status()
            items = resp.json().get("items", [])
            if items:
                return items[0]["snippet"]["channelId"]

        resp = client.get(url)
        resp.raise_for_status()
        match = re.search(r'"channelId":"(UC[\w-]+)"', resp.text)
        return match.group(1) if match else None


def _fetch_youtube_sync(identifier: str, limit: int, settings: Settings, source_name: str | None) -> list[FetchedArticle]:
    channel_id = _extract_channel_id(identifier)
    if not channel_id:
        handle_match = re.search(r"youtube\.com/@([\w.-]+)", identifier.strip())
        handle = handle_match.group(1) if handle_match else identifier.strip().removeprefix("@")
        channel_id = _resolve_handle_to_channel_id_sync(handle, settings)

    if not channel_id:
        raise ValueError(f"Could not resolve YouTube channel from: {identifier}")

    feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    name = source_name or f"YouTube · {channel_id}"
    articles = _fetch_rss_sync(feed_url, limit=limit, source_name=name)
    for article in articles:
        article.source_type = "youtube"
        article.section = "YouTube"
    return articles


async def fetch_youtube_articles(
    identifier: str,
    limit: int,
    settings: Settings,
    source_name: str | None = None,
) -> list[FetchedArticle]:
    return await asyncio.to_thread(_fetch_youtube_sync, identifier, limit, settings, source_name)
