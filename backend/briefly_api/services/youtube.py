from __future__ import annotations

import asyncio
import re
from urllib.parse import quote

import httpx

from briefly_api.config import Settings
from briefly_api.services.articles import FetchedArticle
from briefly_api.services.rss import _fetch_rss_sync

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_CONSENT_COOKIES = {"CONSENT": "YES+cb", "SOCS": "CAI"}
_CHANNEL_ID = r"UC[\w-]{22}"

# Prefer page-owner IDs; plain "channelId" can refer to the signed-in viewer.
_CHANNEL_ID_PATTERNS = [
    rf'<link rel="canonical" href="https://www\.youtube\.com/channel/({_CHANNEL_ID})"',
    rf'"externalId":"({_CHANNEL_ID})"',
    rf'"browseId":"({_CHANNEL_ID})"',
    rf"youtube\.com/channel/({_CHANNEL_ID})",
    rf'"channelId":"({_CHANNEL_ID})"',
]


def _youtube_client(settings: Settings) -> httpx.Client:
    return httpx.Client(
        timeout=25.0,
        follow_redirects=True,
        headers={
            "User-Agent": _BROWSER_UA,
            "Accept-Language": "en-US,en;q=0.9",
            # Avoid brotli decode issues on some server runtimes.
            "Accept-Encoding": "gzip, deflate",
        },
        cookies=_CONSENT_COOKIES,
    )


def _parse_channel_id_from_html(html: str) -> str | None:
    for pattern in _CHANNEL_ID_PATTERNS:
        match = re.search(pattern, html)
        if match:
            return match.group(1)
    return None


def _extract_channel_id(identifier: str) -> str | None:
    value = identifier.strip()
    if re.fullmatch(_CHANNEL_ID, value):
        return value
    match = re.search(rf"youtube\.com/channel/({_CHANNEL_ID})", value)
    if match:
        return match.group(1)
    return None


def _extract_handle(identifier: str) -> str | None:
    value = identifier.strip()
    match = re.search(r"youtube\.com/@([\w.-]+)", value, re.IGNORECASE)
    if match:
        return match.group(1)
    if value.startswith("@"):
        handle = value[1:].strip()
        return handle or None
    if re.fullmatch(r"[\w.-]+", value):
        return value
    return None


def _resolve_via_api(handle: str, settings: Settings, client: httpx.Client) -> str | None:
    if not settings.youtube_api_key:
        return None

    resp = client.get(
        "https://www.googleapis.com/youtube/v3/channels",
        params={
            "part": "id",
            "forHandle": handle,
            "key": settings.youtube_api_key,
        },
    )
    resp.raise_for_status()
    items = resp.json().get("items", [])
    if items:
        return items[0]["id"]

    # Legacy fallback when forHandle misses (custom URLs, older channels).
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
    return None


def _resolve_via_scrape(handle: str, client: httpx.Client) -> str | None:
    encoded = quote(handle, safe="")
    for path in (f"https://www.youtube.com/@{encoded}", f"https://www.youtube.com/@{encoded}/about"):
        resp = client.get(path)
        resp.raise_for_status()
        if "consent.youtube.com" in str(resp.url):
            continue
        channel_id = _parse_channel_id_from_html(resp.text)
        if channel_id:
            return channel_id
    return None


def _resolve_handle_to_channel_id_sync(handle: str, settings: Settings) -> str | None:
    handle = handle.removeprefix("@").strip()
    if not handle or " " in handle:
        return None

    with _youtube_client(settings) as client:
        channel_id = _resolve_via_api(handle, settings, client)
        if channel_id:
            return channel_id
        return _resolve_via_scrape(handle, client)


def _fetch_youtube_sync(
    identifier: str,
    limit: int,
    settings: Settings,
    source_name: str | None,
) -> list[FetchedArticle]:
    channel_id = _extract_channel_id(identifier)
    if not channel_id:
        handle = _extract_handle(identifier)
        if not handle:
            raise ValueError(
                f"Could not parse YouTube channel from: {identifier}. "
                "Use a channel URL (youtube.com/@handle), @handle, or UC… channel ID."
            )
        if " " in handle:
            raise ValueError(
                f"'{identifier}' looks like a search term, not a channel. "
                "Paste the full channel URL or @handle (e.g. youtube.com/@mkbhd)."
            )
        channel_id = _resolve_handle_to_channel_id_sync(handle, settings)

    if not channel_id:
        hint = (
            " Set YOUTUBE_API_KEY on the server for reliable handle lookup."
            if not settings.youtube_api_key
            else ""
        )
        raise ValueError(f"Could not resolve YouTube channel from: {identifier}.{hint}")

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


# ── OAuth subscription-based fetching ─────────────────────────────────────────

def _fetch_subscriptions_sync(
    access_token: str,
    user_agent: str,
    max_channels: int = 150,
) -> list[dict]:
    """
    Call YouTube Data API v3 to get all channels the user is subscribed to.
    Paginates until max_channels is reached.
    Returns list of {"channel_id": ..., "channel_name": ...}.
    """
    channels: list[dict] = []
    page_token: str | None = None

    with httpx.Client(timeout=20.0) as client:
        while len(channels) < max_channels:
            params: dict = {
                "part": "snippet",
                "mine": "true",
                "maxResults": 50,
            }
            if page_token:
                params["pageToken"] = page_token

            resp = client.get(
                "https://www.googleapis.com/youtube/v3/subscriptions",
                params=params,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": user_agent,
                },
            )
            resp.raise_for_status()
            data = resp.json()

            for item in data.get("items", []):
                snippet = item.get("snippet", {})
                resource = snippet.get("resourceId", {})
                channel_id = resource.get("channelId")
                channel_name = snippet.get("title", "")
                if channel_id:
                    channels.append({"channel_id": channel_id, "channel_name": channel_name})

            page_token = data.get("nextPageToken")
            if not page_token:
                break

    return channels[:max_channels]


def _fetch_subscription_videos_sync(
    channels: list[dict],
    videos_per_channel: int = 3,
) -> list[FetchedArticle]:
    """
    Fetch recent videos from a list of subscribed channels via their RSS feeds.
    Each channel's RSS feed is public — no auth needed here.
    """
    articles: list[FetchedArticle] = []
    for ch in channels:
        channel_id = ch["channel_id"]
        channel_name = ch.get("channel_name", f"YouTube · {channel_id}")
        feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
        try:
            items = _fetch_rss_sync(feed_url, limit=videos_per_channel, source_name=channel_name)
            for item in items:
                item.source_type = "youtube"
                item.section = "YouTube"
            articles.extend(items)
        except Exception:
            continue  # skip channels with unavailable feeds
    return articles


async def fetch_subscription_videos(
    access_token: str,
    user_agent: str,
    max_channels: int = 150,
    videos_per_channel: int = 3,
) -> tuple[list[FetchedArticle], int]:
    """
    Fetch videos from all channels the user is subscribed to.
    Returns (articles, channel_count).
    """
    channels = await asyncio.to_thread(
        _fetch_subscriptions_sync, access_token, user_agent, max_channels
    )
    articles = await asyncio.to_thread(
        _fetch_subscription_videos_sync, channels, videos_per_channel
    )
    return articles, len(channels)


async def count_subscriptions(access_token: str, user_agent: str) -> int:
    """Count subscribed channels — used at OAuth callback time for the onboarding banner."""
    try:
        channels = await asyncio.to_thread(_fetch_subscriptions_sync, access_token, user_agent, 50)
        return len(channels)
    except Exception:
        return 0
