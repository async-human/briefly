from __future__ import annotations

import asyncio

import httpx

from briefly_api.config import Settings
from briefly_api.services.articles import FetchedArticle


def _fetch_reddit_sync(subreddit: str, limit: int, settings: Settings, source_name: str | None) -> list[FetchedArticle]:
    name = subreddit.removeprefix("r/").removeprefix("/r/").strip().lower()
    url = f"https://www.reddit.com/r/{name}/hot.json"
    headers = {"User-Agent": settings.reddit_user_agent}

    with httpx.Client(timeout=20.0, headers=headers, follow_redirects=True) as client:
        resp = client.get(url, params={"limit": limit})
        resp.raise_for_status()
        payload = resp.json()

    articles: list[FetchedArticle] = []
    display_name = source_name or f"r/{name}"

    for child in payload.get("data", {}).get("children", [])[:limit]:
        data = child.get("data", {})
        if data.get("stickied"):
            continue
        title = (data.get("title") or "Untitled").strip()
        selftext = (data.get("selftext") or "")[:400].strip()
        summary = selftext or f"Popular post on r/{name} with {data.get('score', 0)} upvotes."
        permalink = data.get("permalink", "")
        link = f"https://www.reddit.com{permalink}" if permalink else data.get("url")

        articles.append(
            FetchedArticle(
                title=title,
                summary=summary,
                url=link,
                source_name=display_name,
                source_type="reddit",
                section="Reddit",
            )
        )

    return articles


async def fetch_reddit_posts(
    subreddit: str,
    limit: int,
    settings: Settings,
    source_name: str | None = None,
) -> list[FetchedArticle]:
    return await asyncio.to_thread(_fetch_reddit_sync, subreddit, limit, settings, source_name)
