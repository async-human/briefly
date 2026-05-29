from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import re
from datetime import UTC, datetime
from urllib.parse import quote

import httpx
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)

from briefly_api.config import Settings
from briefly_api.services.articles import FetchedArticle
from briefly_api.services.rss import _fetch_rss_sync

log = logging.getLogger(__name__)

_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
_CONSENT_COOKIES = {"CONSENT": "YES+cb", "SOCS": "CAI"}
_CHANNEL_ID = r"UC[\w-]{22}"

_CHANNEL_ID_PATTERNS = [
    rf'<link rel="canonical" href="https://www\.youtube\.com/channel/({_CHANNEL_ID})"',
    rf'"externalId":"({_CHANNEL_ID})"',
    rf'"browseId":"({_CHANNEL_ID})"',
    rf"youtube\.com/channel/({_CHANNEL_ID})",
    rf'"channelId":"({_CHANNEL_ID})"',
]

# Noise patterns common in auto-generated captions
_CAPTION_NOISE = re.compile(r"\[(?:Music|Applause|Laughter|Noise|Inaudible|music|applause)\]", re.IGNORECASE)

# Max words to keep from any transcript — ~8 minutes of speech at average pace
_MAX_TRANSCRIPT_WORDS = 2000

# Concurrent workers for transcript fetching
_TRANSCRIPT_WORKERS = 20

# Wall-clock budget for fetching all transcripts for one pipeline run
_TRANSCRIPT_TIMEOUT_SECS = 45.0


# ── Video ID extraction ───────────────────────────────────────────────────────

def _extract_video_id(url: str) -> str | None:
    """Extract the 11-char video ID from any YouTube URL format."""
    if not url:
        return None
    match = re.search(r"(?:v=|youtu\.be/|/embed/|/shorts/)([a-zA-Z0-9_-]{11})", url)
    return match.group(1) if match else None


# ── Transcript fetching ───────────────────────────────────────────────────────

def _fetch_transcript_sync(video_id: str) -> str | None:
    """
    Fetch the transcript for a single video.

    Preference order:
      1. English (manual or auto-generated)
      2. Any available transcript language

    Returns cleaned text capped at _MAX_TRANSCRIPT_WORDS words,
    or None if transcripts are unavailable / disabled.
    """
    try:
        try:
            segments = YouTubeTranscriptApi.get_transcript(
                video_id, languages=["en", "en-US", "en-GB"]
            )
        except NoTranscriptFound:
            # Try any available transcript (auto-generated in any language)
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            segments = next(iter(transcript_list)).fetch()

        raw = " ".join(seg["text"] for seg in segments)
        # Remove caption noise tags and collapse whitespace
        cleaned = _CAPTION_NOISE.sub("", raw)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        # Cap at max words
        words = cleaned.split()
        if len(words) > _MAX_TRANSCRIPT_WORDS:
            cleaned = " ".join(words[:_MAX_TRANSCRIPT_WORDS])

        return cleaned if len(cleaned) > 50 else None

    except (TranscriptsDisabled, VideoUnavailable, NoTranscriptFound):
        return None
    except Exception as exc:
        log.debug("Transcript fetch failed for %s: %s", video_id, exc)
        return None


def _enrich_with_transcripts(articles: list[FetchedArticle], *, max_videos: int | None = None) -> None:
    """
    Fetch transcripts for all articles in parallel and attach them as clean_text.
    Articles that already have a long clean_text are skipped.
    Modifies articles in-place. Falls back to description if transcript unavailable.
    """
    # Map index → video_id for articles that need enrichment
    targets: list[tuple[int, str]] = []
    for i, article in enumerate(articles):
        if max_videos is not None and len(targets) >= max_videos:
            break
        video_id = _extract_video_id(article.url or "")
        if video_id:
            targets.append((i, video_id))

    if not targets:
        return

    log.info("Fetching transcripts for %d YouTube videos (workers=%d)", len(targets), _TRANSCRIPT_WORKERS)

    with concurrent.futures.ThreadPoolExecutor(max_workers=_TRANSCRIPT_WORKERS) as executor:
        future_to_idx = {
            executor.submit(_fetch_transcript_sync, vid): idx
            for idx, vid in targets
        }
        done, _ = concurrent.futures.wait(
            future_to_idx,
            timeout=_TRANSCRIPT_TIMEOUT_SECS,
        )

    fetched = 0
    for future, idx in future_to_idx.items():
        if future not in done:
            continue  # timed out
        try:
            transcript = future.result()
            if transcript:
                articles[idx].clean_text = transcript
                fetched += 1
        except Exception:
            pass

    log.info(
        "Transcripts: %d/%d fetched, %d fell back to description",
        fetched, len(targets), len(targets) - fetched,
    )


# ── Channel ID resolution ─────────────────────────────────────────────────────

def _youtube_client(settings: Settings) -> httpx.Client:
    return httpx.Client(
        timeout=25.0,
        follow_redirects=True,
        headers={
            "User-Agent": _BROWSER_UA,
            "Accept-Language": "en-US,en;q=0.9",
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
        params={"part": "id", "forHandle": handle, "key": settings.youtube_api_key},
    )
    resp.raise_for_status()
    items = resp.json().get("items", [])
    if items:
        return items[0]["id"]
    resp = client.get(
        "https://www.googleapis.com/youtube/v3/search",
        params={"part": "snippet", "q": handle, "type": "channel", "maxResults": 1, "key": settings.youtube_api_key},
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


# ── Manual channel fetching ───────────────────────────────────────────────────

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

    _enrich_with_transcripts(articles)
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

    Common failure modes (both logged explicitly):
      - 403 PERMISSION_DENIED: YouTube Data API v3 not enabled in Google Cloud project.
      - 200 with empty items: User's subscriptions are set to private in YouTube settings.
    """
    channels: list[dict] = []
    page_token: str | None = None

    with httpx.Client(timeout=20.0) as client:
        while len(channels) < max_channels:
            params: dict = {"part": "snippet", "mine": "true", "maxResults": 50}
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

            if not resp.is_success:
                body = resp.text[:500]
                log.error(
                    "YouTube subscriptions API error: HTTP %d — %s\n"
                    "Common causes:\n"
                    "  • YouTube Data API v3 not enabled → https://console.cloud.google.com/apis/library/youtube.googleapis.com\n"
                    "  • Access token missing youtube.readonly scope\n"
                    "Response: %s",
                    resp.status_code, resp.reason_phrase, body,
                )
                resp.raise_for_status()

            data = resp.json()
            items = data.get("items", [])

            if not items and not channels:
                # First page returned empty — subscriptions are likely private
                log.warning(
                    "YouTube subscriptions API returned 0 items. "
                    "The user's subscriptions may be set to private in YouTube settings "
                    "(youtube.com → Settings → Privacy → 'Keep all my subscriptions private'). "
                    "Total results reported by API: %s",
                    data.get("pageInfo", {}).get("totalResults", "unknown"),
                )

            for item in items:
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
    videos_per_channel: int = 2,
    *,
    max_total: int = 40,
) -> list[FetchedArticle]:
    """
    Fetch recent video metadata from subscribed channels, then enrich with transcripts.
    Caps total work so manual briefing generation stays fast.
    """
    articles: list[FetchedArticle] = []
    rss_errors = 0

    for ch in channels:
        if len(articles) >= max_total:
            break
        channel_id = ch["channel_id"]
        channel_name = ch.get("channel_name", f"YouTube · {channel_id}")
        feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
        try:
            remaining = max_total - len(articles)
            per_channel = min(videos_per_channel, remaining)
            items = _fetch_rss_sync(feed_url, limit=per_channel, source_name=channel_name)
            if not items:
                log.debug(
                    "Channel %s (%s) returned 0 videos from RSS — "
                    "may not have posted recently or feed is blocked",
                    channel_name, channel_id,
                )
            for item in items:
                item.source_type = "youtube"
                item.section = "YouTube"
            articles.extend(items)
        except Exception as exc:
            rss_errors += 1
            log.warning("RSS fetch failed for channel %s (%s): %s", channel_name, channel_id, exc)
            continue

    if not articles:
        if rss_errors and channels:
            raise ValueError(
                f"Found {len(channels)} subscribed channels but could not load their video feeds."
            )
        return []

    # Newest first when published_at is available
    articles.sort(key=lambda a: a.published_at or datetime.min.replace(tzinfo=UTC), reverse=True)
    articles = articles[:max_total]

    _enrich_with_transcripts(articles, max_videos=min(12, len(articles)))
    return articles


async def fetch_subscription_videos(
    access_token: str,
    user_agent: str,
    max_channels: int = 150,
    videos_per_channel: int = 2,
    max_total: int = 40,
) -> tuple[list[FetchedArticle], int]:
    """
    Fetch videos from subscribed channels, with transcripts.
    Returns (articles, channel_count).
    """
    channels = await asyncio.to_thread(
        _fetch_subscriptions_sync, access_token, user_agent, max_channels
    )
    if not channels:
        return [], 0

    articles = await asyncio.to_thread(
        _fetch_subscription_videos_sync,
        channels,
        videos_per_channel,
        max_total=max_total,
    )
    return articles, len(channels)


# ── Liked videos + playlist fetching ──────────────────────────────────────────

def _fetch_playlist_videos_sync(
    access_token: str,
    user_agent: str,
    playlist_id: str,
    limit: int = 25,
) -> list[FetchedArticle]:
    """
    Fetch videos from a YouTube playlist via the Data API.

    Works for any playlist the user can read, including:
      - "LL" (Liked Videos) — strong explicit intent signal
      - Any user-created playlist ID

    Returns FetchedArticle list with URL set to watch?v=... so
    _enrich_with_transcripts can fetch transcripts by video ID.
    """
    articles: list[FetchedArticle] = []
    page_token: str | None = None

    with httpx.Client(timeout=20.0) as client:
        while len(articles) < limit:
            params: dict = {
                "part": "snippet",
                "playlistId": playlist_id,
                "maxResults": min(50, limit - len(articles)),
            }
            if page_token:
                params["pageToken"] = page_token

            resp = client.get(
                "https://www.googleapis.com/youtube/v3/playlistItems",
                params=params,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": user_agent,
                },
            )

            if not resp.is_success:
                log.warning(
                    "YouTube playlist %s returned HTTP %d: %s",
                    playlist_id, resp.status_code, resp.text[:200],
                )
                break

            data = resp.json()
            for item in data.get("items", []):
                snippet = item.get("snippet", {})
                resource = snippet.get("resourceId", {})
                video_id = resource.get("videoId")
                if not video_id:
                    continue

                title = (snippet.get("title") or "Untitled").strip()
                # Skip deleted / private videos (YouTube returns these as placeholders)
                if title in ("Deleted video", "Private video"):
                    continue

                description = (snippet.get("description") or "")[:400]
                channel_name = snippet.get("videoOwnerChannelTitle") or "YouTube"

                articles.append(FetchedArticle(
                    title=title,
                    url=f"https://www.youtube.com/watch?v={video_id}",
                    source_name=channel_name,
                    source_type="youtube",
                    section="YouTube",
                    summary=description or "Liked video",
                ))

            page_token = data.get("nextPageToken")
            if not page_token:
                break

    return articles[:limit]


def _fetch_user_playlists_sync(
    access_token: str,
    user_agent: str,
    max_playlists: int = 10,
) -> list[dict]:
    """
    Return the user's own playlists as [{"id": ..., "title": ...}].
    Excludes system playlists (Watch Later = WL, Liked = LL) which are
    handled separately.
    """
    with httpx.Client(timeout=20.0) as client:
        resp = client.get(
            "https://www.googleapis.com/youtube/v3/playlists",
            params={"part": "snippet", "mine": "true", "maxResults": max_playlists},
            headers={
                "Authorization": f"Bearer {access_token}",
                "User-Agent": user_agent,
            },
        )
        if not resp.is_success:
            log.warning("YouTube playlists API returned HTTP %d", resp.status_code)
            return []

        playlists = []
        for item in resp.json().get("items", []):
            pid = item.get("id", "")
            if pid in ("WL", "LL", "FL"):  # skip system playlists
                continue
            title = item.get("snippet", {}).get("title", "")
            playlists.append({"id": pid, "title": title})
        return playlists


async def fetch_youtube_content(
    access_token: str,
    user_agent: str,
    max_channels: int = 100,
    max_total: int = 40,
) -> tuple[list[FetchedArticle], dict]:
    """
    Fetch content from all YouTube signals in parallel:
      1. Subscriptions — channels the user follows
      2. Liked videos  — explicit positive intent (strongest signal)
      3. User playlists — curated collections

    Returns (articles, counts) where counts = {subscriptions, liked, playlists}.
    Articles are deduplicated by URL. Liked videos appear first so the
    relevance agent sees them at the top of the pool.
    """
    # Run subscriptions + liked videos concurrently
    sub_task = asyncio.create_task(
        fetch_subscription_videos(access_token, user_agent, max_channels=max_channels, max_total=max_total // 2)
    )
    liked_task = asyncio.create_task(
        asyncio.to_thread(_fetch_playlist_videos_sync, access_token, user_agent, "LL", 20)
    )
    playlist_meta_task = asyncio.create_task(
        asyncio.to_thread(_fetch_user_playlists_sync, access_token, user_agent, 5)
    )

    sub_articles, channel_count = await sub_task
    liked_articles = await liked_task
    user_playlists = await playlist_meta_task

    # Fetch videos from user playlists (up to 5 videos each)
    playlist_articles: list[FetchedArticle] = []
    for pl in user_playlists[:5]:
        try:
            items = await asyncio.to_thread(
                _fetch_playlist_videos_sync, access_token, user_agent, pl["id"], 5
            )
            playlist_articles.extend(items)
        except Exception:
            continue

    # Enrich liked + playlist videos with transcripts (subscriptions already enriched)
    if liked_articles or playlist_articles:
        to_enrich = liked_articles + playlist_articles
        await asyncio.to_thread(_enrich_with_transcripts, to_enrich, min(10, len(to_enrich)))
        liked_articles = to_enrich[:len(liked_articles)]
        playlist_articles = to_enrich[len(liked_articles):]

    # Merge: liked first (strongest signal), then subscriptions, then playlists
    seen: set[str] = set()
    merged: list[FetchedArticle] = []
    for article in liked_articles + sub_articles + playlist_articles:
        url = article.url or ""
        if url and url in seen:
            continue
        seen.add(url)
        merged.append(article)

    counts = {
        "subscriptions": channel_count,
        "liked": len(liked_articles),
        "playlists": len(user_playlists),
    }
    log.info(
        "YouTube content: %d subscribed channels, %d liked videos, %d playlist(s) → %d total items",
        channel_count, len(liked_articles), len(user_playlists), len(merged),
    )
    return merged[:max_total], counts


async def count_subscriptions(access_token: str, user_agent: str) -> int:
    """Count subscribed channels — used at OAuth callback for the onboarding banner."""
    try:
        channels = await asyncio.to_thread(_fetch_subscriptions_sync, access_token, user_agent, 50)
        log.info("YouTube subscription count: %d channels found", len(channels))
        return len(channels)
    except Exception as exc:
        log.warning("YouTube subscription count failed: %s", exc)
        return 0
