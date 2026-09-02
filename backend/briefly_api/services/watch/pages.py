"""Pinned official-page change detection for watched companies.

Not a site crawler. Pages come from the catalog, homepage/nav resolution,
or a URL the user pins. First successful fetch is a baseline with no alert.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
import trafilatura
from sqlalchemy import select

from briefly_api.db.models import EntitySource, WatchedEntity
from briefly_api.services.url_scraper import UrlFetchError, _BROWSER_UA, fetch_html
from briefly_api.services.watch.relevance import WatchHit, canonicalize_url

log = logging.getLogger(__name__)

PAGE_SOURCE_TYPES = frozenset({"pricing", "docs", "changelog"})
PAGE_LABEL = {
    "pricing": "pricing page",
    "docs": "docs page",
    "changelog": "changelog",
}

MIN_EXTRACT_CHARS = 200
MAX_EXTRACT_STORE = 80_000
MAX_PAGES_PER_ENTITY = 3
_ROBOTS_TTL_SECONDS = 3600.0

_NOISE_LINE = re.compile(
    r"^(cookie|privacy policy|terms of service|accept all|reject all|"
    r"sign in|log in|subscribe|skip to|menu|navigation)\b",
    re.I,
)
_STAMP_LINE = re.compile(
    r"^(last\s+updated|updated\s+\d|published\s+\d|as of\s+\d)\b",
    re.I,
)
_RELATIVE_TIME = re.compile(r"\b\d+\s+(second|minute|hour|day)s?\s+ago\b", re.I)
_INTERESTING = re.compile(r"[$€£₹]|\d+(?:\.\d+)?\s*%|\b\d+\.\d+\b")
_SECRET_LINE = re.compile(
    r"authorization\s*:|\bbearer\b|\bapi[_-]?key\b|\bx-api-key\b|"
    r"\bsk-[a-z0-9]{8,}|\bcurl\b|(?:^|[\s\"'`])-H\b|"
    r"\$\{?(?:OPENAI|ANTHROPIC|GROQ|AZURE|GOOGLE|COHERE)_API_KEY\}?",
    re.I,
)
_CODE_LINE = re.compile(
    r"[{};]|=>|===|function\s|const\s|import\s|\"model\":|`[^`]+`|"
    r"^(?:\$|#|>>>|from\s|import\s|-H\b)",
)
_TABLE_RULE = re.compile(r"^\|?\s*:?-{3,}")
_MONEY = re.compile(r"[$€£₹]\s*\d+(?:,\d{3})*(?:\.\d+)?")
_HEADER_CELL = re.compile(
    r"^(model|input|output|cached|price|pricing|standard|batch|flex|priority)$",
    re.I,
)
_PRODUCT_WORD = re.compile(
    r"\b(gpt|claude|gemini|llama|mistral|model|token|price|plan|cost|credit)\b",
    re.I,
)

_robots_cache: dict[str, tuple[float, RobotFileParser | None | str]] = {}


@dataclass(frozen=True)
class ExtractDecision:
    kind: str  # thin | baseline | unchanged | changed
    extract: str
    digest: str
    excerpt: str
    previous_excerpt: str
    error: str | None = None


def canonicalize_extract(text: str) -> str:
    """Stable text for hashing: collapse whitespace, drop cookie/nav/timestamp lines."""
    lines: list[str] = []
    for raw in (text or "").splitlines():
        line = " ".join(raw.split()).strip()
        if len(line) < 2:
            continue
        if _NOISE_LINE.match(line) or _STAMP_LINE.match(line) or _RELATIVE_TIME.search(line):
            continue
        lines.append(line)
    return "\n".join(lines)


def hash_extract(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def is_thin(text: str) -> bool:
    return len(text or "") < MIN_EXTRACT_CHARS


def _is_secret_line(line: str) -> bool:
    return bool(_SECRET_LINE.search(line or ""))


def _looks_like_code(line: str) -> bool:
    text = line or ""
    if _is_secret_line(text):
        return True
    return bool(_CODE_LINE.search(text))


def _visible_lines(extract: str) -> list[str]:
    out: list[str] = []
    for raw in canonicalize_extract(extract).splitlines():
        line = raw.strip()
        if len(line) < 2 or _is_secret_line(line) or _TABLE_RULE.match(line):
            continue
        out.append(line)
    return out


def _format_table_row(line: str) -> str | None:
    """Turn a markdown price row into 'model  $X in · $Y out'. Never invent amounts."""
    if "|" not in (line or ""):
        return None
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    cells = [c for c in cells if c and not re.fullmatch(r":?-{3,}:?", c)]
    if not cells:
        return None
    moneys: list[str] = []
    percents: list[str] = []
    name: str | None = None
    for cell in cells:
        found_money = _MONEY.findall(cell)
        if found_money:
            moneys.extend("".join(m.split()) for m in found_money)
            continue
        if "%" in cell:
            percents.append(re.sub(r"\*+$", "", cell).strip())
            continue
        if name is None and not _HEADER_CELL.match(cell):
            name = cell
    if name and _HEADER_CELL.match(name):
        return None
    if moneys:
        if len(moneys) >= 4:
            in_p, out_p = moneys[0], moneys[3]
        elif len(moneys) >= 2:
            in_p, out_p = moneys[0], moneys[-1]
        else:
            priced = moneys[0]
            return f"{name} · {priced}".strip(" ·") if name else priced
        body = f"{in_p} in · {out_p} out"
        return f"{name} · {body}".strip(" ·") if name else body
    if percents and name:
        return f"{name} · {percents[0]}"
    return None


def changed_excerpt(old: str, new: str, *, limit: int = 800) -> str:
    """Lines that appeared in `new`. Prefer prices, percents, and numbers."""
    old_set = {ln.strip() for ln in (old or "").splitlines() if ln.strip()}
    added = [
        ln.strip()
        for ln in (new or "").splitlines()
        if ln.strip() and ln.strip() not in old_set and not _is_secret_line(ln)
    ]
    if not added:
        cleaned = "\n".join(_visible_lines(new))
        return cleaned[:limit]
    interesting = [ln for ln in added if _INTERESTING.search(ln)]
    ranked = interesting + [ln for ln in added if ln not in interesting]
    return "\n".join(ranked)[:limit]


def known_excerpt(extract: str, *, limit: int = 280, source_type: str | None = None) -> str:
    """Last-known copy from a stored extract. Prefer prices. Never invent. Never leak auth."""
    lines = _visible_lines(extract)
    if not lines:
        return ""
    facts: list[str] = []
    seen: set[str] = set()

    def add(fact: str) -> None:
        text = " ".join((fact or "").split()).strip()
        if len(text) < 3 or _is_secret_line(text):
            return
        key = text.lower()
        if key in seen:
            return
        seen.add(key)
        facts.append(text)

    for ln in lines:
        if "|" in ln:
            continue
        if _looks_like_code(ln):
            continue
        if _INTERESTING.search(ln) and _PRODUCT_WORD.search(ln):
            add(ln)
            if source_type in {"docs", "changelog"}:
                break

    if source_type in (None, "pricing") or not facts:
        for ln in lines:
            formatted = _format_table_row(ln)
            if formatted:
                add(formatted)
            if len(facts) >= 3:
                break

    if not facts:
        for ln in lines:
            if _looks_like_code(ln) or "|" in ln:
                continue
            if _INTERESTING.search(ln):
                add(ln[:180])
            if len(facts) >= 2:
                break

    if not facts and source_type == "docs":
        for ln in lines:
            if _looks_like_code(ln) or len(ln) < 24:
                continue
            if re.search(r"\b(api|model|endpoint|sdk|version)\b", ln, re.I):
                add(ln[:180])
                break

    out: list[str] = []
    used = 0
    for fact in facts[:3]:
        if used >= limit:
            break
        take = fact[: max(0, limit - used)]
        if not take:
            break
        out.append(take)
        used += len(take) + 1
    return "\n".join(out).strip()[:limit]


def evaluate_extract(
    previous_hash: str | None,
    previous_extract: str | None,
    extract: str,
) -> ExtractDecision:
    cleaned = canonicalize_extract(extract)
    if is_thin(cleaned):
        return ExtractDecision(
            kind="thin",
            extract=cleaned,
            digest="",
            excerpt="",
            previous_excerpt="",
            error="extract too thin (login wall or JavaScript shell)",
        )
    digest = hash_extract(cleaned)
    if not (previous_hash or "").strip():
        return ExtractDecision(
            kind="baseline",
            extract=cleaned,
            digest=digest,
            excerpt="",
            previous_excerpt="",
        )
    if previous_hash == digest:
        return ExtractDecision(
            kind="unchanged",
            extract=cleaned,
            digest=digest,
            excerpt="",
            previous_excerpt="",
        )
    excerpt = changed_excerpt(previous_extract or "", cleaned)
    gone = changed_excerpt(cleaned, previous_extract or "")
    return ExtractDecision(
        kind="changed",
        extract=cleaned,
        digest=digest,
        excerpt=excerpt,
        previous_excerpt=gone[:240],
    )


def extract_visible_text(html: str, url: str) -> str:
    from briefly_api.services.watch.scrape import extract_embedded_text, is_challenge_html

    if is_challenge_html(html or ""):
        return ""
    text = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=True,
        include_links=False,
    ) or ""
    if not is_thin(canonicalize_extract(text)):
        return text
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html or "", "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    fallback = soup.get_text("\n")
    if not is_thin(canonicalize_extract(fallback)):
        return fallback
    return extract_embedded_text(html or "")


def _robots_origin(url: str) -> str:
    parsed = urlparse(url)
    scheme = parsed.scheme or "https"
    return f"{scheme}://{parsed.netloc}"


def _load_robots(origin: str) -> RobotFileParser | None | str:
    """Parser, None (allow all), or 'unreachable'."""
    now = datetime.now(timezone.utc).timestamp()
    cached = _robots_cache.get(origin)
    if cached and now - cached[0] < _ROBOTS_TTL_SECONDS:
        return cached[1]
    robots_url = urljoin(origin.rstrip("/") + "/", "robots.txt")
    try:
        with httpx.Client(timeout=8.0, follow_redirects=True, headers={"User-Agent": _BROWSER_UA}) as client:
            resp = client.get(robots_url)
            if resp.status_code in (404, 410):
                _robots_cache[origin] = (now, None)
                return None
            if resp.status_code >= 400:
                _robots_cache[origin] = (now, "unreachable")
                return "unreachable"
            parser = RobotFileParser()
            parser.set_url(robots_url)
            parser.parse(resp.text.splitlines())
            _robots_cache[origin] = (now, parser)
            return parser
    except httpx.HTTPError:
        _robots_cache[origin] = (now, "unreachable")
        return "unreachable"


def robots_status(url: str) -> str:
    """allow | disallow | unreachable."""
    origin = _robots_origin(url)
    loaded = _load_robots(origin)
    if loaded == "unreachable":
        return "unreachable"
    if loaded is None:
        return "allow"
    try:
        allowed = loaded.can_fetch(_BROWSER_UA, url)
    except Exception:
        return "unreachable"
    return "allow" if allowed else "disallow"


def _mark_error(src: EntitySource, now: datetime, message: str, *, count_failure: bool) -> None:
    src.last_fetched = now
    src.last_error = message[:500]
    if count_failure:
        src.consecutive_failures = int(src.consecutive_failures or 0) + 1


def _mark_ok(src: EntitySource, now: datetime, digest: str, extract: str) -> None:
    src.last_fetched = now
    src.last_error = None
    src.consecutive_failures = 0
    src.content_hash = digest
    src.last_extract = extract[:MAX_EXTRACT_STORE]


def _hit_for_change(entity: WatchedEntity, src: EntitySource, decision: ExtractDecision, now: datetime) -> WatchHit:
    kind = PAGE_LABEL.get(src.source_type, "official page")
    canonical = canonicalize_url(src.url) or src.url
    excerpt = decision.excerpt or decision.extract[:800]
    return WatchHit(
        title=f"{entity.name} {kind} changed",
        url=canonical,
        source_name=f"{entity.name} · official {kind}",
        source_type=src.source_type,
        summary=excerpt[:1500],
        published_at=now,
        is_official=True,
        score=0.95,
        related_urls=[canonical],
        previous_state=decision.previous_excerpt,
    )


def _prefer_live_sources(sources: list[EntitySource]) -> list[EntitySource]:
    """One URL per kind. Prefer a stored extract over a blocked marketing duplicate."""
    def rank(src: EntitySource) -> tuple[int, int, int]:
        failing = 1 if (src.last_error or "").strip() else 0
        hashed = 0 if src.content_hash else 1
        host = (urlparse(src.url or "").netloc or "").lower()
        specific = 0 if any(
            host.startswith(p) for p in ("developers.", "developer.", "docs.", "platform.", "api.")
        ) else 1
        return (failing, hashed, specific)

    best: dict[str, EntitySource] = {}
    for src in sources:
        cur = best.get(src.source_type)
        if cur is None or rank(src) < rank(cur):
            best[src.source_type] = src
    return [best[kind] for kind in ("pricing", "docs", "changelog") if kind in best]


async def _ingest_source(
    src: EntitySource,
    entity_name: str,
    now: datetime,
    *,
    timeout: float = 25.0,
) -> ExtractDecision | None:
    """Fetch one official page and store extract. None means not stored."""
    from briefly_api.services.watch.scrape import is_challenge_html

    status = robots_status(src.url)
    if status == "disallow":
        _mark_error(src, now, "robots.txt disallows this URL", count_failure=False)
        return None
    if status == "unreachable":
        _mark_error(src, now, "robots.txt unreachable", count_failure=True)
        return None
    try:
        _final_url, html = await fetch_html(src.url, timeout=timeout)
        if is_challenge_html(html):
            _mark_error(src, now, "bot challenge page (Cloudflare or similar)", count_failure=True)
            return None
        raw = extract_visible_text(html, src.url)
    except UrlFetchError as exc:
        _mark_error(src, now, str(exc)[:500], count_failure=True)
        log.debug("Watch page fetch failed %s (%s): %s", entity_name, src.source_type, exc)
        return None
    except Exception as exc:
        _mark_error(src, now, f"fetch failed: {exc}"[:500], count_failure=True)
        log.debug("Watch page fetch failed %s (%s): %s", entity_name, src.source_type, exc)
        return None

    decision = evaluate_extract(src.content_hash, src.last_extract, raw)
    if decision.kind == "thin":
        _mark_error(src, now, decision.error or "extract too thin", count_failure=True)
        return None
    _mark_ok(src, now, decision.digest, decision.extract)
    return decision


async def hydrate_official_pages(session, entities: list, *, limit: int = 9) -> int:
    """Seed catalog URLs and fetch last-known copy now. No alerts. For the glance."""
    from briefly_api.services.watch.sources import seed_sources

    now = datetime.now(timezone.utc)
    for entity in entities:
        if getattr(entity, "kind", None) not in {"company", "product"}:
            continue
        try:
            await seed_sources(session, entity)
        except Exception:
            log.debug("Watch seed skipped for %s", getattr(entity, "name", "?"), exc_info=True)
    await session.flush()

    need: list[tuple[str, EntitySource]] = []
    for entity in entities:
        if getattr(entity, "kind", None) not in {"company", "product"}:
            continue
        rows = (
            await session.execute(
                select(EntitySource).where(
                    EntitySource.entity_id == entity.id,
                    EntitySource.is_active.is_(True),
                    EntitySource.source_type.in_(tuple(PAGE_SOURCE_TYPES)),
                )
            )
        ).scalars().all()
        for src in _prefer_live_sources(rows):
            if src.content_hash and src.last_extract and not (src.last_error or "").strip():
                continue
            need.append((entity.name, src))
    need.sort(key=lambda item: (0 if item[1].source_type == "pricing" else 1, item[0].lower()))
    batch = need[:limit]
    if not batch:
        return 0

    async def one(name: str, src: EntitySource) -> bool:
        decision = await _ingest_source(src, name, now, timeout=12.0)
        return bool(decision)

    results = await asyncio.gather(*(one(name, src) for name, src in batch), return_exceptions=True)
    stored = sum(1 for item in results if item is True)
    if stored:
        log.info("Hydrated %d official pages for glance", stored)
    return stored


async def check_entity_pages(
    session,
    entity: WatchedEntity,
    *,
    min_interval_minutes: int,
    force: bool = False,
) -> tuple[list[WatchHit], int]:
    sources = (
        await session.execute(
            select(EntitySource).where(
                EntitySource.entity_id == entity.id,
                EntitySource.is_active.is_(True),
                EntitySource.source_type.in_(tuple(PAGE_SOURCE_TYPES)),
            )
        )
    ).scalars().all()
    if not sources:
        return [], 0
    sources = _prefer_live_sources(sources)

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=max(5, min_interval_minutes))
    hits: list[WatchHit] = []
    checked = 0

    for src in sources[:MAX_PAGES_PER_ENTITY]:
        if not force and src.last_fetched:
            lf = src.last_fetched if src.last_fetched.tzinfo else src.last_fetched.replace(tzinfo=timezone.utc)
            if lf > cutoff:
                continue
        checked += 1
        decision = await _ingest_source(src, entity.name, now)
        if decision is None:
            continue
        if decision.kind == "changed":
            hits.append(_hit_for_change(entity, src, decision, now))
            log.info("Watch page changed: %s %s", entity.name, src.source_type)
        elif decision.kind == "baseline":
            log.info("Watch page baseline stored: %s %s", entity.name, src.source_type)

    return hits, checked
