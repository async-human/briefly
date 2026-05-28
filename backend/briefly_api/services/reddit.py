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


# ── OAuth subscription-based fetching ─────────────────────────────────────────

def _fetch_user_subreddits_sync(
    access_token: str,
    user_agent: str,
    max_subreddits: int = 100,
) -> list[dict]:
    """
    Fetch subreddits the user subscribes to via Reddit OAuth API.
    Returns list of {"name": ..., "display_name": ...}.
    """
    subreddits: list[dict] = []
    after: str | None = None

    with httpx.Client(timeout=20.0) as client:
        while len(subreddits) < max_subreddits:
            params: dict = {"limit": 100}
            if after:
                params["after"] = after

            resp = client.get(
                "https://oauth.reddit.com/subreddits/mine/subscriber",
                params=params,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": user_agent,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            children = data.get("data", {}).get("children", [])

            for child in children:
                sub_data = child.get("data", {})
                name = sub_data.get("display_name")
                title = sub_data.get("title") or name
                if name:
                    subreddits.append({"name": name, "display_name": title})

            after = data.get("data", {}).get("after")
            if not after or not children:
                break

    return subreddits[:max_subreddits]


def _fetch_subreddit_posts_sync(
    subreddits: list[dict],
    posts_per_sub: int,
    user_agent: str,
) -> list[FetchedArticle]:
    """Fetch hot posts from each subscribed subreddit."""
    articles: list[FetchedArticle] = []
    headers = {"User-Agent": user_agent}

    with httpx.Client(timeout=20.0, headers=headers, follow_redirects=True) as client:
        for sub in subreddits:
            name = sub["name"]
            display_name = sub.get("display_name") or f"r/{name}"
            try:
                resp = client.get(
                    f"https://www.reddit.com/r/{name}/hot.json",
                    params={"limit": posts_per_sub},
                )
                resp.raise_for_status()
                payload = resp.json()

                for child in payload.get("data", {}).get("children", [])[:posts_per_sub]:
                    data = child.get("data", {})
                    if data.get("stickied"):
                        continue
                    title = (data.get("title") or "Untitled").strip()
                    selftext = (data.get("selftext") or "")[:400].strip()
                    summary = selftext or f"r/{name} · {data.get('score', 0)} upvotes"
                    permalink = data.get("permalink", "")
                    url = f"https://www.reddit.com{permalink}" if permalink else data.get("url")

                    articles.append(FetchedArticle(
                        title=title,
                        summary=summary,
                        url=url,
                        source_name=f"r/{name}",
                        source_type="reddit",
                        section="Reddit",
                    ))
            except Exception:
                continue

    return articles


async def fetch_subscribed_subreddit_posts(
    access_token: str,
    user_agent: str,
    max_subreddits: int = 100,
    posts_per_sub: int = 2,
) -> tuple[list[FetchedArticle], int]:
    """
    Fetch posts from all subreddits the user subscribes to.
    Returns (articles, subreddit_count).
    """
    subreddits = await asyncio.to_thread(
        _fetch_user_subreddits_sync, access_token, user_agent, max_subreddits
    )
    articles = await asyncio.to_thread(
        _fetch_subreddit_posts_sync, subreddits, posts_per_sub, user_agent
    )
    return articles, len(subreddits)


async def count_subscribed_subreddits(access_token: str, user_agent: str) -> int:
    try:
        subs = await asyncio.to_thread(_fetch_user_subreddits_sync, access_token, user_agent, 100)
        return len(subs)
    except Exception:
        return 0
