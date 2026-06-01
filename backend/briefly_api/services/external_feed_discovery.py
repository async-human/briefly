"""
Dynamic external source discovery — no static catalogs.

Discovers feeds/channels/subreddits from:
  - User OAuth accounts (YouTube subscriptions, Reddit subscriptions)
  - Interest phrases → Google News RSS, Medium tag feeds, Reddit subreddit search
  - Optional YouTube channel search when API key is configured
"""
from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import quote_plus

import httpx

from briefly_api.config import Settings

log = logging.getLogger(__name__)

_MAX_PER_INTEREST = 2
_MAX_INTERESTS = 8


def _slugify(topic: str) -> str:
    """Convert interest phrase to URL slug (medium tags, etc.)."""
    s = topic.lower().strip()
    s = re.sub(r"[^a-z0-9\s-]", "", s)
    s = re.sub(r"\s+", "-", s)
    return s.strip("-")[:60]


def _interest_phrases(profile: dict) -> list[str]:
    phrases: list[str] = []
    seen: set[str] = set()
    for interest in profile.get("interests") or []:
        topic = (interest.get("topic") or "").strip()
        if topic and topic.lower() not in seen:
            seen.add(topic.lower())
            phrases.append(topic)
    if profile.get("goal"):
        goal = profile["goal"].strip()
        if goal and goal.lower() not in seen:
            phrases.append(goal[:120])
    if profile.get("role"):
        role = profile["role"].strip()
        if role and role.lower() not in seen:
            phrases.append(role)
    return phrases[:_MAX_INTERESTS]


async def discover_google_news_feeds(interests: list[str]) -> list[dict]:
    """One Google News RSS feed per interest phrase — fully dynamic."""
    results: list[dict] = []
    for topic in interests[:_MAX_INTERESTS]:
        q = quote_plus(topic)
        url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
        results.append({
            "name": f"Google News · {topic}",
            "identifier": url,
            "source_type": "rss",
            "layer": "interest_feed",
            "confidence": 0.7,
            "reason": f"Live news RSS for “{topic}” from Google News",
            "meta": {"interest": topic, "provider": "google_news"},
        })
    return results


async def discover_medium_tag_feeds(interests: list[str]) -> list[dict]:
    """Medium public tag RSS — slug derived from interest text, not a static map."""
    results: list[dict] = []
    for topic in interests[:_MAX_INTERESTS]:
        slug = _slugify(topic)
        if len(slug) < 2:
            continue
        url = f"https://medium.com/feed/tag/{slug}"
        results.append({
            "name": f"Medium · {topic}",
            "identifier": url,
            "source_type": "rss",
            "layer": "interest_feed",
            "confidence": 0.62,
            "reason": f"Community writing tagged “{slug}” on Medium",
            "meta": {"interest": topic, "provider": "medium", "tag_slug": slug},
        })
    return results


async def discover_reddit_subreddits_for_interests(
    interests: list[str],
    settings: Settings,
    *,
    limit_per_interest: int = 2,
) -> list[dict]:
    """Search Reddit for subreddits matching each interest phrase."""
    results: list[dict] = []
    headers = {"User-Agent": settings.reddit_user_agent}

    async with httpx.AsyncClient(timeout=15.0, headers=headers, follow_redirects=True) as client:
        for topic in interests[:_MAX_INTERESTS]:
            try:
                resp = await client.get(
                    "https://www.reddit.com/subreddits/search.json",
                    params={"q": topic, "limit": limit_per_interest, "raw_json": 1},
                )
                resp.raise_for_status()
                children = resp.json().get("data", {}).get("children", [])
            except Exception as exc:
                log.debug("Reddit search failed for %s: %s", topic, exc)
                continue

            for child in children[:limit_per_interest]:
                data = child.get("data", {})
                name = data.get("display_name")
                title = data.get("title") or name
                subscribers = data.get("subscribers") or 0
                if not name:
                    continue
                results.append({
                    "name": f"r/{name}",
                    "identifier": name.lower(),
                    "source_type": "reddit",
                    "layer": "interest_feed",
                    "confidence": min(0.85, 0.5 + min(subscribers, 500_000) / 2_000_000),
                    "reason": f"Subreddit surfaced by Reddit search for “{topic}”",
                    "meta": {
                        "interest": topic,
                        "provider": "reddit_search",
                        "subscribers": subscribers,
                        "display_title": title,
                    },
                })
    return results


async def discover_youtube_channels_for_interests(
    interests: list[str],
    settings: Settings,
    *,
    limit_per_interest: int = 2,
) -> list[dict]:
    """YouTube Data API channel search — requires YOUTUBE_API_KEY."""
    api_key = (settings.youtube_api_key or "").strip()
    if not api_key:
        return []

    results: list[dict] = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        for topic in interests[:_MAX_INTERESTS]:
            try:
                resp = await client.get(
                    "https://www.googleapis.com/youtube/v3/search",
                    params={
                        "part": "snippet",
                        "type": "channel",
                        "q": topic,
                        "maxResults": limit_per_interest,
                        "key": api_key,
                    },
                )
                resp.raise_for_status()
                items = resp.json().get("items", [])
            except Exception as exc:
                log.debug("YouTube search failed for %s: %s", topic, exc)
                continue

            for item in items:
                snippet = item.get("snippet", {})
                channel_id = item.get("id", {}).get("channelId")
                title = snippet.get("title") or channel_id
                if not channel_id:
                    continue
                url = f"https://www.youtube.com/channel/{channel_id}"
                results.append({
                    "name": title,
                    "identifier": url,
                    "source_type": "youtube",
                    "layer": "interest_feed",
                    "confidence": 0.68,
                    "reason": f"YouTube channel found for “{topic}”",
                    "meta": {"interest": topic, "provider": "youtube_search", "channel_id": channel_id},
                })
    return results


async def discover_youtube_subscriptions(
    access_token: str,
    settings: Settings,
    *,
    max_channels: int = 40,
) -> list[dict]:
    """OAuth — channels the user already subscribes to on YouTube."""
    from briefly_api.services.youtube import _fetch_subscriptions_sync

    try:
        channels = await asyncio.to_thread(
            _fetch_subscriptions_sync, access_token, settings.reddit_user_agent, max_channels,
        )
    except Exception as exc:
        log.warning("YouTube subscription discovery failed: %s", exc)
        return []

    return [
        {
            "name": ch.get("channel_name") or ch.get("channel_id", "YouTube"),
            "identifier": f"https://www.youtube.com/channel/{ch['channel_id']}",
            "source_type": "youtube",
            "layer": "youtube_subscription",
            "confidence": 0.92,
            "reason": "You subscribe to this channel on YouTube",
            "meta": {"channel_id": ch["channel_id"], "provider": "youtube_oauth"},
        }
        for ch in channels
        if ch.get("channel_id")
    ]


async def discover_reddit_subscriptions(
    access_token: str,
    settings: Settings,
    *,
    max_subreddits: int = 40,
) -> list[dict]:
    """OAuth — subreddits the user already subscribes to on Reddit."""
    from briefly_api.services.reddit import _fetch_user_subreddits_sync

    try:
        subs = await asyncio.to_thread(
            _fetch_user_subreddits_sync, access_token, settings.reddit_user_agent, max_subreddits,
        )
    except Exception as exc:
        log.warning("Reddit subscription discovery failed: %s", exc)
        return []

    return [
        {
            "name": f"r/{sub['name']}",
            "identifier": sub["name"].lower(),
            "source_type": "reddit",
            "layer": "reddit_subscription",
            "confidence": 0.92,
            "reason": "You subscribe to this subreddit on Reddit",
            "meta": {
                "provider": "reddit_oauth",
                "display_title": sub.get("display_name"),
            },
        }
        for sub in subs
        if sub.get("name")
    ]


async def discover_all_external(
    profile: dict,
    settings: Settings,
    *,
    youtube_token: str | None = None,
    reddit_token: str | None = None,
) -> list[dict]:
    """
    Run all dynamic external discovery paths and return raw candidate dicts.
    Caller applies relevance scoring and deduplication.
    """
    interests = _interest_phrases(profile)
    if not interests:
        interests = ["technology", "news"]

    tasks = [
        discover_google_news_feeds(interests),
        discover_medium_tag_feeds(interests),
        discover_reddit_subreddits_for_interests(interests, settings),
        discover_youtube_channels_for_interests(interests, settings),
    ]
    if youtube_token:
        tasks.append(discover_youtube_subscriptions(youtube_token, settings))
    if reddit_token:
        tasks.append(discover_reddit_subscriptions(reddit_token, settings))

    batches = await asyncio.gather(*tasks, return_exceptions=True)
    out: list[dict] = []
    for batch in batches:
        if isinstance(batch, Exception):
            log.warning("External discovery batch failed: %s", batch)
            continue
        out.extend(batch)
    return out


async def discover_interest_suggestions_light(
    profile: dict,
    settings: Settings,
    *,
    limit: int = 5,
) -> list[dict]:
    """
    Lightweight suggestions for sidebar / interest agent — no static catalog.
    Returns [{name, url, source_type, topic, description, reason, ...}]
    """
    interests = _interest_phrases(profile)
    raw = await discover_all_external(profile, settings)
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%d")
    results: list[dict] = []
    for item in raw[:limit]:
        results.append({
            "name": item["name"],
            "url": item["identifier"],
            "source_type": item["source_type"],
            "topic": item.get("meta", {}).get("interest", interests[0] if interests else ""),
            "description": item.get("reason", ""),
            "reason": item.get("reason", ""),
            "discovered_at": now,
            "source": item.get("meta", {}).get("provider", "external"),
        })
    return results
