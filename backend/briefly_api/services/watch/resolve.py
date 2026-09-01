"""Resolve which official pages to watch for a company.

We do not crawl the site. For each watched company we try, in order:

1. Catalog pins (known companies)
2. Marketing homepage plus sibling developer/docs/platform hosts
3. Labels on those pages (Pricing, Docs, Changelog)
4. sitemap.xml (and one level of sitemap index)
5. Same-host well-known paths, only after a page actually loaded,
   and only if the URL returns readable content

A candidate is pinned only after that confirmation. A 404 is not a source.
If we cannot resolve a page, coverage is news/RSS only — we do not pretend
the official surface is watched.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.db.models import EntitySource, WatchedEntity
from briefly_api.services.url_scraper import UrlFetchError, fetch_html
from briefly_api.services.watch.catalog import catalog_match, catalog_pages, normalize_name
from briefly_api.services.watch.pages import (
    PAGE_SOURCE_TYPES,
    canonicalize_extract,
    extract_visible_text,
    is_thin,
    known_excerpt,
    robots_status,
)
from briefly_api.services.watch.relevance import canonicalize_url
from briefly_api.services.watch.scrape import (
    classify_page_url,
    extract_labeled_links,
    host_of as _host,
    is_challenge_html,
    is_sitemap_index,
    pages_from_sitemap,
    sibling_origins,
    sitemap_locs,
    well_known_candidates,
)

log = logging.getLogger(__name__)

_DISCOVERY_TTL = timedelta(hours=24)
_MAX_CONFIRMS = 10
_SITEMAP_CHILDREN = 3

# Re-export for existing tests and pin API.
__all__ = [
    "classify_page_url",
    "coverage_from_sources",
    "extract_labeled_links",
    "homepage_candidates",
    "maybe_discover_pages",
    "pages_from_sitemap",
    "pin_official_page",
    "well_known_candidates",
]


def homepage_candidates(name: str, *, source_hosts: list[str] | None = None) -> list[str]:
    """Homepages we may open. Guesses are probes, not watched sources."""
    out: list[str] = []
    seen: set[str] = set()

    def add(url: str) -> None:
        key = canonicalize_url(url)
        if not key or key in seen:
            return
        seen.add(key)
        out.append(url if url.startswith("http") else f"https://{url}")

    catalog = catalog_match(name)
    if catalog:
        site = str(catalog.get("site") or "").strip()
        if site:
            add(site)
            for sibling in sibling_origins(site):
                add(sibling)
        blog = str(catalog.get("blog") or "").strip()
        if blog:
            parsed = urlparse(blog)
            if parsed.netloc:
                add(f"{parsed.scheme or 'https'}://{parsed.netloc}")
        for _kind, page in catalog_pages(name):
            parsed = urlparse(page)
            if parsed.netloc:
                add(f"{parsed.scheme or 'https'}://{parsed.netloc}")
    slug = normalize_name(name).replace(" ", "")
    if slug:
        add(f"https://www.{slug}.com")
        add(f"https://{slug}.com")
        add(f"https://{slug}.ai")
        add(f"https://www.{slug}.ai")
        for sibling in sibling_origins(f"{slug}.com"):
            add(sibling)
        for sibling in sibling_origins(f"{slug}.ai"):
            add(sibling)
    for host in source_hosts or []:
        host = (host or "").removeprefix("www.")
        if host and "." in host and "google.com" not in host and "github.com" not in host:
            add(f"https://{host}")
            for sibling in sibling_origins(host):
                add(sibling)
    return out[:12]


def coverage_from_sources(sources: list[EntitySource]) -> dict:
    pages = []
    for src in sources:
        if src.source_type not in PAGE_SOURCE_TYPES:
            continue
        error = (src.last_error or "").strip()
        if "robots.txt disallows" in error:
            status = "blocked"
        elif error:
            status = "failing"
        elif src.content_hash:
            status = "watching"
        else:
            status = "pending"
        excerpt = known_excerpt(getattr(src, "last_extract", None) or "") or None
        pages.append(
            {
                "source_type": src.source_type,
                "url": src.url,
                "status": status,
                "last_error": error or None,
                "excerpt": excerpt,
            }
        )
    kinds = {p["source_type"] for p in pages}
    live = {p["source_type"] for p in pages if p["status"] in {"watching", "pending"}}
    found = {p["source_type"] for p in pages if p["status"] in {"watching", "pending", "failing", "blocked"}}
    if len(live) >= 3:
        status = "official"
        note = "Watching official pricing, docs, and changelog pages."
    elif live:
        missing = [k for k in ("pricing", "docs", "changelog") if k not in kinds]
        status = "partial"
        watched = ", ".join(sorted(live))
        note = (
            f"Watching official {watched}. "
            + (f"Not yet watching {', '.join(missing)}. " if missing else "")
            + "News and RSS still run."
        )
    elif found:
        status = "partial"
        blocked = ", ".join(sorted(found))
        note = (
            f"Found official {blocked}, but the page was blocked or unreadable this cycle. "
            "News and RSS still run."
        )
    else:
        status = "news_only"
        note = (
            "No official pricing, docs, or changelog page resolved yet. "
            "News and RSS still run. Pin a URL if we missed the page."
        )
    return {"status": status, "pages": pages, "note": note}


def _set_discovery(entity: WatchedEntity, *, status: str, note: str, homepage: str = "") -> None:
    rules = dict(entity.monitoring_rules or {})
    rules["page_discovery"] = {
        "attempted_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "note": note,
        "homepage": homepage,
    }
    entity.monitoring_rules = rules


async def pin_official_page(session, entity: WatchedEntity, source_type: str, url: str) -> EntitySource | None:
    if source_type not in PAGE_SOURCE_TYPES:
        return None
    canonical = canonicalize_url(url) or url.strip()
    if not canonical.startswith("http"):
        return None
    await session.execute(
        pg_insert(EntitySource)
        .values(
            id=str(uuid.uuid4()),
            entity_id=entity.id,
            source_type=source_type,
            url=canonical,
            is_active=True,
        )
        .on_conflict_do_nothing(index_elements=["entity_id", "url"])
    )
    await session.flush()
    row = (
        await session.execute(
            select(EntitySource).where(
                EntitySource.entity_id == entity.id,
                EntitySource.url == canonical,
            )
        )
    ).scalar_one_or_none()
    if row and row.source_type not in PAGE_SOURCE_TYPES:
        row.source_type = source_type
    return row


async def _confirm_readable(url: str) -> bool:
    if robots_status(url) != "allow":
        return False
    try:
        _final, html = await fetch_html(url)
        if is_challenge_html(html):
            return False
        text = extract_visible_text(html, url)
    except (UrlFetchError, Exception):
        return False
    return not is_thin(canonicalize_extract(text))


async def _open_homepage(guesses: list[str]) -> tuple[str, str]:
    for guess in guesses:
        if robots_status(guess) != "allow":
            continue
        try:
            final_url, html = await fetch_html(guess)
        except Exception:
            continue
        if is_challenge_html(html):
            continue
        homepage = canonicalize_url(final_url) or guess
        return homepage, html
    return "", ""


async def _sitemap_pages(homepage: str, entity_name: str, missing: set[str], seen_urls: set[str]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    sitemap_url = urljoin(homepage.rstrip("/") + "/", "sitemap.xml")
    try:
        if robots_status(sitemap_url) != "allow":
            return out
        _final, xml = await fetch_html(sitemap_url)
    except Exception:
        return out
    xmls = [xml]
    if is_sitemap_index(xml):
        for child in sitemap_locs(xml, limit=_SITEMAP_CHILDREN):
            try:
                if robots_status(child) != "allow":
                    continue
                _f, child_xml = await fetch_html(child)
                xmls.append(child_xml)
            except Exception:
                continue
    for blob in xmls:
        for kind, url in pages_from_sitemap(blob, homepage, entity_name):
            if kind in missing and url not in seen_urls:
                out.append((kind, url))
                seen_urls.add(url)
    return out


async def maybe_discover_pages(session, entity: WatchedEntity, *, force: bool = False) -> None:
    """Find official pages for a company. Does not recurse the site."""
    if entity.kind not in {"company", "product"}:
        _set_discovery(entity, status="skipped", note="Topics and people stay on news and RSS.")
        return

    existing = (
        await session.execute(
            select(EntitySource).where(EntitySource.entity_id == entity.id)
        )
    ).scalars().all()
    have = {s.source_type for s in existing if s.source_type in PAGE_SOURCE_TYPES and not (s.last_error or "").strip()}
    rules = dict(entity.monitoring_rules or {})
    previous = dict(rules.get("page_discovery") or {})
    attempted = previous.get("attempted_at")
    if not force and attempted:
        try:
            ts = datetime.fromisoformat(str(attempted).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - ts < _DISCOVERY_TTL and len(have) >= 3:
                return
            if datetime.now(timezone.utc) - ts < _DISCOVERY_TTL and not force:
                # Retry sooner when coverage is still news-only / partial.
                if have:
                    return
        except ValueError:
            pass

    missing = {k for k in PAGE_SOURCE_TYPES if k not in have}
    if not missing:
        _set_discovery(entity, status="official", note="Catalog or earlier discovery already pinned three pages.")
        return

    hosts = [_host(s.url) for s in existing]
    homepage, html = await _open_homepage(homepage_candidates(entity.name, source_hosts=hosts))

    wanted: list[tuple[str, str]] = []
    seen_urls: set[str] = {canonicalize_url(s.url) for s in existing}

    for kind, url in catalog_pages(entity.name):
        key = canonicalize_url(url) or url
        if kind in missing and key not in seen_urls:
            wanted.append((kind, key))
            seen_urls.add(key)

    if homepage and html:
        for kind, url in extract_labeled_links(homepage, html, entity.name):
            if kind in missing and url not in seen_urls:
                wanted.append((kind, url))
                seen_urls.add(url)
        still = missing - {k for k, _ in wanted}
        if still:
            for kind, url in await _sitemap_pages(homepage, entity.name, still, seen_urls):
                wanted.append((kind, url))
        still = missing - {k for k, _ in wanted}
        wanted.extend(
            (kind, url)
            for kind, url in well_known_candidates(homepage, still)
            if url not in seen_urls
        )

    if not wanted and not homepage:
        _set_discovery(
            entity,
            status="news_only",
            note="Could not open a company homepage or developer site. News and RSS still run.",
        )
        return

    confirms = 0
    pinned = 0
    filled: set[str] = set()
    for kind, url in wanted:
        if kind in have or kind in filled:
            continue
        if confirms >= _MAX_CONFIRMS:
            break
        confirms += 1
        if not await _confirm_readable(url):
            continue
        row = await pin_official_page(session, entity, kind, url)
        if row:
            filled.add(kind)
            pinned += 1
            log.info("Watch page resolved: %s %s → %s", entity.name, kind, url)

    have |= filled
    if len(have) >= 3:
        status = "official"
        note = "Resolved official pricing, docs, and changelog pages."
    elif have:
        status = "partial"
        note = (
            "Resolved official "
            + ", ".join(sorted(have))
            + ". Missing kinds were not confirmed on the site."
        )
    else:
        status = "news_only"
        note = (
            "Opened a company site, but no pricing, docs, or changelog page confirmed. "
            "News and RSS still run."
        )
    _set_discovery(entity, status=status, note=note, homepage=homepage)
    if pinned:
        log.info("Watch discover pages: %s pinned=%d status=%s", entity.name, pinned, status)
