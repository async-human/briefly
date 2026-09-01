"""Resolve which official pages to watch for a company.

We do not crawl the site. For each watched company we try, in order:

1. Catalog pins (known companies)
2. Labels on the company homepage (Pricing, Docs, Changelog)
3. sitemap.xml paths that clearly match those surfaces
4. Same-host well-known paths, only after a homepage actually loaded,
   and only if the URL returns readable content

A candidate is pinned only after that confirmation. A 404 is not a source.
If we cannot resolve a page, coverage is news/RSS only — we do not pretend
the official surface is watched.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from briefly_api.db.models import EntitySource, WatchedEntity
from briefly_api.services.url_scraper import UrlFetchError, fetch_html
from briefly_api.services.watch.catalog import catalog_match, normalize_name
from briefly_api.services.watch.pages import (
    PAGE_SOURCE_TYPES,
    canonicalize_extract,
    extract_visible_text,
    is_thin,
    robots_status,
)
from briefly_api.services.watch.relevance import canonicalize_url

log = logging.getLogger(__name__)

_DISCOVERY_TTL = timedelta(hours=24)
_MAX_CONFIRMS = 6
_SITEMAP_LOCS = 80

_PRICING = re.compile(
    r"\b(pricing|plans?|price list|packaging|api pricing)\b", re.I
)
_CHANGELOG = re.compile(
    r"\b(changelog|release notes|what'?s new|releases|release notes)\b", re.I
)
_DOCS = re.compile(
    r"\b(docs?|documentation|api reference|developers?|developer hub)\b", re.I
)
_PATH_PRICING = re.compile(r"/(?:api/)?pricing(?:/|$)|/plans(?:/|$)", re.I)
_PATH_CHANGELOG = re.compile(
    r"/(?:changelog|releases|release-notes|whats-new|what's-new)(?:/|$)", re.I
)
_PATH_DOCS = re.compile(r"/(?:docs?|documentation|developers?|api)(?:/|$)", re.I)

_PROBES = {
    "pricing": ("/pricing", "/plans"),
    "changelog": ("/changelog", "/releases"),
    "docs": ("/docs", "/developers"),
}

_RELATED_PREFIX = ("docs.", "platform.", "developers.", "developer.", "api.")


def classify_page_url(url: str, anchor: str = "") -> str | None:
    """Map a URL (and optional link text) to pricing | docs | changelog."""
    parsed = urlparse(url or "")
    path = parsed.path or "/"
    host = (parsed.netloc or "").lower()
    blob = f"{anchor} {path} {host}"
    if _PRICING.search(blob) or _PATH_PRICING.search(path):
        return "pricing"
    if _CHANGELOG.search(blob) or _PATH_CHANGELOG.search(path):
        return "changelog"
    if _DOCS.search(blob) or _PATH_DOCS.search(path):
        return "docs"
    if any(host.startswith(p) for p in _RELATED_PREFIX):
        return "docs"
    return None


def _host(url: str) -> str:
    return (urlparse(url or "").netloc or "").lower().removeprefix("www.")


def _related_host(page_url: str, link_url: str, entity_name: str) -> bool:
    page_host = _host(page_url)
    link_host = _host(link_url)
    if not page_host or not link_host:
        return False
    if page_host == link_host:
        return True
    if link_host.endswith("." + page_host) or page_host.endswith("." + link_host):
        return True
    slug = normalize_name(entity_name).replace(" ", "")
    return bool(slug) and len(slug) >= 4 and slug in link_host.replace("-", "")


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
        blog = str(catalog.get("blog") or "").strip()
        if blog:
            parsed = urlparse(blog)
            if parsed.netloc:
                add(f"{parsed.scheme or 'https'}://{parsed.netloc}")
    slug = normalize_name(name).replace(" ", "")
    if slug:
        add(f"https://www.{slug}.com")
        add(f"https://{slug}.com")
        add(f"https://{slug}.ai")
        add(f"https://www.{slug}.ai")
    for host in source_hosts or []:
        host = (host or "").removeprefix("www.")
        if host and "." in host and "google.com" not in host and "github.com" not in host:
            add(f"https://{host}")
    return out[:6]


def extract_labeled_links(page_url: str, html: str, entity_name: str) -> list[tuple[str, str]]:
    """Official-surface links declared on the homepage. At most one URL per kind."""
    found: dict[str, str] = {}
    for match in re.finditer(
        r"<a\b[^>]*\bhref=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>",
        html or "",
        re.I | re.S,
    ):
        href = match.group(1).strip()
        if not href or href.startswith(("#", "mailto:", "javascript:", "tel:")):
            continue
        text = re.sub(r"<[^>]+>", " ", match.group(2))
        text = " ".join(text.split())
        absolute = urljoin(page_url, href).split("#", 1)[0]
        if not _related_host(page_url, absolute, entity_name):
            continue
        kind = classify_page_url(absolute, text)
        if not kind or kind in found:
            continue
        found[kind] = canonicalize_url(absolute) or absolute
        if len(found) >= 3:
            break
    return [(kind, found[kind]) for kind in ("pricing", "docs", "changelog") if kind in found]


def pages_from_sitemap(xml: str, origin: str, entity_name: str) -> list[tuple[str, str]]:
    found: dict[str, str] = {}
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml or "", re.I)
    for loc in locs[:_SITEMAP_LOCS]:
        url = loc.strip()
        if not _related_host(origin, url, entity_name):
            continue
        kind = classify_page_url(url)
        if not kind or kind in found:
            continue
        found[kind] = canonicalize_url(url) or url
        if len(found) >= 3:
            break
    return [(kind, found[kind]) for kind in ("pricing", "docs", "changelog") if kind in found]


def well_known_candidates(homepage: str, missing: set[str]) -> list[tuple[str, str]]:
    """Same-host path guesses. Callers must confirm before pinning."""
    parsed = urlparse(homepage)
    origin = f"{parsed.scheme or 'https'}://{parsed.netloc}"
    out: list[tuple[str, str]] = []
    for kind in ("pricing", "docs", "changelog"):
        if kind not in missing:
            continue
        for path in _PROBES[kind]:
            key = canonicalize_url(urljoin(origin.rstrip("/") + "/", path.lstrip("/")))
            if key:
                out.append((kind, key))
    return out


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
        pages.append(
            {
                "source_type": src.source_type,
                "url": src.url,
                "status": status,
                "last_error": error or None,
            }
        )
    kinds = {p["source_type"] for p in pages}
    watching = {p["source_type"] for p in pages if p["status"] in {"watching", "pending"}}
    if len(watching) >= 3:
        status = "official"
        note = "Watching official pricing, docs, and changelog pages."
    elif watching:
        missing = [k for k in ("pricing", "docs", "changelog") if k not in kinds]
        status = "partial"
        watched = ", ".join(sorted(watching))
        note = (
            f"Watching official {watched}. "
            + (f"Not yet watching {', '.join(missing)}. " if missing else "")
            + "News and RSS still run."
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
        text = extract_visible_text(html, url)
    except (UrlFetchError, Exception):
        return False
    return not is_thin(canonicalize_extract(text))


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
    have = {s.source_type for s in existing if s.source_type in PAGE_SOURCE_TYPES}
    rules = dict(entity.monitoring_rules or {})
    previous = dict(rules.get("page_discovery") or {})
    attempted = previous.get("attempted_at")
    if not force and attempted:
        try:
            ts = datetime.fromisoformat(str(attempted).replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - ts < _DISCOVERY_TTL:
                return
        except ValueError:
            pass

    missing = {k for k in PAGE_SOURCE_TYPES if k not in have}
    if not missing:
        _set_discovery(entity, status="official", note="Catalog or earlier discovery already pinned three pages.")
        return

    hosts = [_host(s.url) for s in existing]
    candidates = homepage_candidates(entity.name, source_hosts=hosts)
    homepage = ""
    html = ""
    for guess in candidates:
        if robots_status(guess) != "allow":
            continue
        try:
            final_url, html = await fetch_html(guess)
        except Exception:
            continue
        if is_thin(canonicalize_extract(extract_visible_text(html, guess))):
            # Homepage shells are often JS; still use the URL as origin for probes.
            homepage = canonicalize_url(final_url) or guess
            break
        homepage = canonicalize_url(final_url) or guess
        break

    if not homepage:
        _set_discovery(
            entity,
            status="news_only",
            note="Could not open a company homepage. News and RSS still run.",
        )
        return

    wanted: list[tuple[str, str]] = []
    seen_urls: set[str] = {canonicalize_url(s.url) for s in existing}
    for kind, url in extract_labeled_links(homepage, html, entity.name):
        if kind in missing and url not in seen_urls:
            wanted.append((kind, url))
            seen_urls.add(url)

    if missing - {k for k, _ in wanted}:
        try:
            sitemap_url = urljoin(homepage.rstrip("/") + "/", "sitemap.xml")
            if robots_status(sitemap_url) == "allow":
                _final, sitemap_xml = await fetch_html(sitemap_url)
                for kind, url in pages_from_sitemap(sitemap_xml, homepage, entity.name):
                    if kind in missing and url not in seen_urls:
                        wanted.append((kind, url))
                        seen_urls.add(url)
        except Exception:
            pass

    still_missing = missing - {k for k, _ in wanted}
    wanted.extend(
        (kind, url)
        for kind, url in well_known_candidates(homepage, still_missing)
        if url not in seen_urls
    )

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
            "Homepage opened, but no pricing, docs, or changelog page confirmed. "
            "News and RSS still run."
        )
    _set_discovery(entity, status=status, note=note, homepage=homepage)
    if pinned:
        log.info("Watch discover pages: %s pinned=%d status=%s", entity.name, pinned, status)
