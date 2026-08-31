"""Resolve and fetch feeds for a watched entity."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.db.models import EntitySource, WatchedEntity
from briefly_api.services.articles import FetchedArticle
from briefly_api.services.rss import fetch_rss_articles
from briefly_api.services.watch.catalog import (
    catalog_match,
    github_atom_url,
    google_news_url,
    normalize_name,
)
from briefly_api.services.watch.relevance import WatchHit, canonicalize_url

log = logging.getLogger(__name__)

_FETCH_LIMIT = 8


def _is_official(url: str, entity_name: str) -> bool:
    host = (urlparse(url or "").netloc or "").lower().removeprefix("www.")
    slug = normalize_name(entity_name).replace(" ", "")
    return bool(slug) and slug in host.replace("-", "")


async def seed_sources(session, entity: WatchedEntity) -> list[EntitySource]:
    """Attach catalog + Google News sources. Idempotent on (entity_id, url)."""
    wanted: list[tuple[str, str]] = []
    catalog = catalog_match(entity.name)
    if catalog:
        blog = catalog.get("blog")
        if blog:
            wanted.append(("blog", blog))
        github = catalog.get("github")
        if github:
            wanted.append(("github", github_atom_url(github)))
    wanted.append(("news", google_news_url(entity.name)))

    existing = {
        canonicalize_url(row.url): row
        for row in (
            await session.execute(
                select(EntitySource).where(EntitySource.entity_id == entity.id)
            )
        ).scalars().all()
    }

    created: list[EntitySource] = []
    for source_type, url in wanted:
        key = canonicalize_url(url)
        if not key or key in existing:
            continue
        row = EntitySource(entity_id=entity.id, source_type=source_type, url=url)
        session.add(row)
        existing[key] = row
        created.append(row)

    if created:
        await session.flush()
    return list(existing.values())


async def maybe_discover_blog(session, entity: WatchedEntity) -> None:
    """Best-effort RSS discovery for companies not in the catalog."""
    if entity.kind not in {"company", "product"}:
        return
    catalog = catalog_match(entity.name)
    if catalog and catalog.get("blog"):
        return
    has_blog = (
        await session.execute(
            select(EntitySource.id).where(
                EntitySource.entity_id == entity.id,
                EntitySource.source_type == "blog",
                EntitySource.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if has_blog:
        return

    from briefly_api.services.url_scraper import discover_rss_feed

    slug = normalize_name(entity.name).replace(" ", "")
    guesses = [
        f"https://www.{slug}.com",
        f"https://{slug}.ai",
        f"https://www.{slug}.ai",
        f"https://{slug}.com/news",
        f"https://{slug}.com/blog",
    ]
    for guess in guesses[:3]:
        try:
            feed = await discover_rss_feed(guess)
        except Exception:
            continue
        if not feed:
            continue
        await session.execute(
            pg_insert(EntitySource)
            .values(
                id=str(uuid.uuid4()),
                entity_id=entity.id,
                source_type="blog",
                url=feed,
                is_active=True,
            )
            .on_conflict_do_nothing(index_elements=["entity_id", "url"])
        )
        await session.flush()
        log.info("Watch discover: %s → %s", entity.name, feed)
        return


async def fetch_entity_hits(
    session,
    entity: WatchedEntity,
    *,
    min_interval_minutes: int,
    since: datetime | None,
) -> tuple[list[WatchHit], int]:
    sources = (
        await session.execute(
            select(EntitySource).where(
                EntitySource.entity_id == entity.id,
                EntitySource.is_active.is_(True),
            )
        )
    ).scalars().all()
    if not sources:
        sources = await seed_sources(session, entity)

    now = datetime.now(timezone.utc)
    hits: list[WatchHit] = []
    checked = 0
    cutoff = now - timedelta(minutes=max(5, min_interval_minutes))

    for src in sources:
        if src.last_fetched:
            lf = src.last_fetched if src.last_fetched.tzinfo else src.last_fetched.replace(tzinfo=timezone.utc)
            if lf > cutoff:
                continue
        checked += 1
        articles: list[FetchedArticle] = []
        try:
            articles = await fetch_rss_articles(
                src.url,
                limit=_FETCH_LIMIT,
                source_name=f"{entity.name} · {src.source_type}",
            )
        except Exception as exc:
            log.debug("Watch fetch failed %s (%s): %s", entity.name, src.source_type, exc)
        src.last_fetched = now
        for art in articles:
            url = canonicalize_url(art.url or "")
            if not url:
                continue
            published = art.published_at
            if since and published:
                pub = published if published.tzinfo else published.replace(tzinfo=timezone.utc)
                if pub < since:
                    continue
            hits.append(
                WatchHit(
                    title=(art.title or "").strip(),
                    url=url,
                    source_name=art.source_name or src.source_type,
                    source_type=src.source_type,
                    summary=(art.summary or art.clean_text or "")[:1500],
                    published_at=published,
                    is_official=src.source_type == "blog" or _is_official(url, entity.name),
                )
            )
    return hits, checked
