"""Expand Medium digest emails into individual articles for the briefing pipeline."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import numpy as np

from briefly_api.config import get_settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.medium_extractor import (
    detect_medium_digest,
    extract_article_previews,
)
from briefly_api.services.url_scraper import UrlFetchError, scrape_url

log = logging.getLogger(__name__)

_SCRAPE_TIMEOUT_SEC = 12.0
_MAX_PARALLEL_SCRAPES = 4


def _age_days(published_at: datetime | None) -> float | None:
    if not published_at:
        return None
    pub = published_at
    if pub.tzinfo is None:
        pub = pub.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - pub).total_seconds() / 86400


def _cosine(a: list[float], b: list[float]) -> float:
    x = np.array(a)
    y = np.array(b)
    na = np.linalg.norm(x)
    nb = np.linalg.norm(y)
    if na == 0 or nb == 0:
        return 0.5
    return float(np.dot(x, y) / (na * nb))


def _title_matches_keywords(title: str, keywords: set[str]) -> bool:
    if not keywords:
        return False
    blob = title.lower()
    return any(kw in blob for kw in keywords)


async def _filter_previews_by_profile(
    previews: list[dict[str, str]],
    *,
    interest_keywords: set[str],
    profile_embedding: list[float] | None,
    min_similarity: float,
) -> list[dict[str, str]]:
    """Keep Medium recommendations that match declared interests (keywords or embedding)."""
    if not previews:
        return previews

    keyword_hits = [p for p in previews if _title_matches_keywords(p.get("title", ""), interest_keywords)]
    if keyword_hits:
        return keyword_hits

    if not profile_embedding:
        log.info("medium: no profile embedding — skipping %d off-profile previews", len(previews))
        return []

    try:
        from briefly_api.embeddings.adapter import get_embedding_adapter

        embedder = get_embedding_adapter()
        titles = [p.get("title") or "Medium article" for p in previews]
        title_embs = await embedder.embed_batch(titles)
    except Exception:
        log.warning("medium: title embedding filter failed — skipping digest previews", exc_info=True)
        return []

    kept: list[dict[str, str]] = []
    for preview, emb in zip(previews, title_embs):
        sim = _cosine(profile_embedding, emb)
        mapped = (sim + 1) / 2
        if mapped >= min_similarity:
            kept.append(preview)
    if kept:
        log.info("medium: kept %d/%d previews by profile similarity", len(kept), len(previews))
        return kept

    log.info("medium: no previews matched profile — skipping stale digest recommendations")
    return []


def _filter_by_age(
    items: list[NormalizedContent],
    *,
    max_age_days: int,
) -> list[NormalizedContent]:
    kept: list[NormalizedContent] = []
    for item in items:
        age = _age_days(item.published_at)
        if age is not None and age > max_age_days:
            log.debug("medium: dropping old article (%.0fd): %s", age, item.title[:60])
            continue
        if item.meta.get("from_medium_digest") and not item.meta.get("digest_received_at") and age is None:
            log.debug("medium: dropping undated scraped article: %s", item.title[:60])
            continue
        kept.append(item)
    return kept


async def _scrape_one(url: str) -> list[NormalizedContent]:
    try:
        return await asyncio.wait_for(scrape_url(url), timeout=_SCRAPE_TIMEOUT_SEC)
    except (asyncio.TimeoutError, UrlFetchError) as exc:
        log.debug("medium: scrape skipped for %s — %s", url, exc)
        return []
    except Exception as exc:  # noqa: BLE001
        log.warning("medium: unexpected scrape error for %s — %s", url, exc)
        return []


async def fetch_medium_articles(urls: list[str]) -> list[NormalizedContent]:
    if not urls:
        return []
    sem = asyncio.Semaphore(_MAX_PARALLEL_SCRAPES)

    async def _one(url: str) -> list[NormalizedContent]:
        async with sem:
            fetched = await _scrape_one(url)
            for article in fetched:
                article.source_type = "url"
                article.section = "Articles"
            return fetched

    batches = await asyncio.gather(*[_one(u) for u in urls])
    return [item for batch in batches for item in batch]


def _fallback_items(
    previews: list[dict[str, str]],
    *,
    source_name: str,
    source_id: str | None = None,
    digest_received_at: datetime | None,
) -> list[NormalizedContent]:
    items: list[NormalizedContent] = []
    received = digest_received_at or datetime.now(timezone.utc)
    for preview in previews:
        title = preview.get("title") or "Medium article"
        url = preview["url"]
        snippet = (
            f"{title}\n\nRecommended in your Medium digest. "
            "Open the article for the full post."
        )
        items.append(
            NormalizedContent(
                title=title,
                url=url,
                source_name=source_name,
                source_id=source_id,
                source_type="url",
                section="Articles",
                author="Medium",
                published_at=received,
                clean_text=snippet,
                summary=snippet[:400],
                meta={"from_medium_digest": True, "article_url": url, "digest_received_at": True},
            )
        )
    return items


def _newest_digest_only(items: list[NormalizedContent]) -> list[NormalizedContent]:
    digests = [
        i for i in items
        if i.meta.get("is_medium_digest")
        or detect_medium_digest(i.meta.get("raw_html", ""), i.author)
    ]
    if len(digests) <= 1:
        return items

    others = [i for i in items if i not in digests]
    newest = max(
        digests,
        key=lambda i: i.published_at or datetime.min.replace(tzinfo=timezone.utc),
    )
    log.info(
        "medium: using newest digest only (%s), skipping %d older email(s)",
        newest.title, len(digests) - 1,
    )
    return [newest, *others]


async def expand_medium_digest_items(
    items: list[NormalizedContent],
    *,
    source_name: str | None = None,
    source_id: str | None = None,
    per_digest_limit: int = 6,
    interest_keywords: set[str] | None = None,
    profile_embedding: list[float] | None = None,
) -> list[NormalizedContent]:
    s = get_settings()
    keywords = interest_keywords or set()
    items = _newest_digest_only(items)
    results: list[NormalizedContent] = []

    for item in items:
        raw_html = item.meta.get("raw_html", "")
        author = item.author or item.meta.get("sender")
        is_digest = item.meta.get("is_medium_digest") or detect_medium_digest(raw_html, author)

        if not is_digest:
            results.append(item)
            continue

        previews = extract_article_previews(raw_html)[: per_digest_limit * 2]
        previews = await _filter_previews_by_profile(
            previews,
            interest_keywords=keywords,
            profile_embedding=profile_embedding,
            min_similarity=s.medium_min_profile_similarity,
        )
        previews = previews[:per_digest_limit]
        if not previews:
            log.info("medium: no on-profile previews in digest '%s'", item.title)
            continue

        urls = [p["url"] for p in previews]
        fetched = await fetch_medium_articles(urls)
        label = source_name or item.source_name or "Medium"

        if fetched:
            for article in fetched:
                article.source_name = label
                if source_id:
                    article.source_id = source_id
                article.meta = {**article.meta, "from_medium_digest": True}
            fetched = _filter_by_age(fetched, max_age_days=s.medium_max_article_age_days)
            if fetched:
                results.extend(fetched)
                log.info(
                    "medium: expanded digest '%s' into %d on-profile articles for %s",
                    item.title, len(fetched), label,
                )
            continue

        fallbacks = _fallback_items(
            previews,
            source_name=label,
            source_id=source_id,
            digest_received_at=item.published_at,
        )
        fallbacks = _filter_by_age(fallbacks, max_age_days=s.medium_max_article_age_days)
        if fallbacks:
            results.extend(fallbacks)

    return results
