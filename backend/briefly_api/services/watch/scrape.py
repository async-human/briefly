"""Targeted official-page scraper.

Not a site crawler. For each company we fetch a small set of official
surfaces (marketing homepage, developer/docs hosts, sitemap, well-known
pricing/docs/changelog paths) and extract links and readable copy.
No Playwright, no recursion through the whole site.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urljoin, urlparse

from briefly_api.services.watch.catalog import normalize_name
from briefly_api.services.watch.relevance import canonicalize_url

PAGE_KINDS = ("pricing", "docs", "changelog")

_PRICING = re.compile(
    r"\b(pricing|plans|price list|packaging|api pricing|api[- ]pricing)\b", re.I
)
_CHANGELOG = re.compile(
    r"\b(changelog|release notes|what'?s new)\b", re.I
)
_DOCS = re.compile(
    r"\b(docs|documentation|api reference|developer hub)\b", re.I
)
_PATH_PRICING = re.compile(
    r"/(?:api/)?(?:docs/)?pricing(?:/|$)|/api-pricing(?:/|$)|/plans(?:/|$)",
    re.I,
)
_PATH_CHANGELOG = re.compile(
    r"/(?:changelog|releases|release-notes|whats-new|what's-new)(?:/|$)",
    re.I,
)
_PATH_DOCS = re.compile(
    r"/(?:docs|documentation|developers?|api(?:/docs)?)(?:/|$)",
    re.I,
)
_RELATED_PREFIX = ("docs.", "platform.", "developers.", "developer.", "api.")
_SIBLING_PREFIXES = ("developers", "developer", "platform", "docs", "api")
_PROBES = {
    "pricing": (
        "/pricing",
        "/plans",
        "/api-pricing",
        "/api/pricing",
        "/api/docs/pricing",
        "/docs/pricing",
    ),
    "changelog": (
        "/changelog",
        "/releases",
        "/api/docs/changelog",
        "/docs/changelog",
        "/release-notes",
    ),
    "docs": ("/docs", "/developers", "/api/docs", "/documentation"),
}
_HREF_ABS = re.compile(r"https?://[^\s\"'<>]+", re.I)
_CHALLENGE = re.compile(
    r"just a moment\.\.\.|cf-browser-verification|enable javascript and cookies"
    r"|attention required|access denied",
    re.I,
)
_INTERESTING = re.compile(r"[$€£₹]|\d+(?:\.\d+)?\s*%")


_SKIP_PATH = re.compile(
    r"/(login|signin|signup|account|cart|gtc|events|blog|news)(?:/|$)",
    re.I,
)


def classify_page_url(url: str, anchor: str = "") -> str | None:
    """Map a URL (and optional link text) to pricing | docs | changelog."""
    parsed = urlparse(url or "")
    path = parsed.path or "/"
    if _SKIP_PATH.search(path):
        return None
    host = (parsed.netloc or "").lower()
    blob = f"{anchor} {path}"
    if _PRICING.search(blob) or _PATH_PRICING.search(path):
        return "pricing"
    if _CHANGELOG.search(blob) or _PATH_CHANGELOG.search(path):
        return "changelog"
    if _DOCS.search(blob) or _PATH_DOCS.search(path):
        return "docs"
    if any(host.startswith(p) for p in _RELATED_PREFIX):
        segs = [s for s in path.split("/") if s]
        if not segs or segs[0] in {"docs", "documentation", "developers", "developer", "api", "reference"}:
            return "docs"
    return None


def host_of(url: str) -> str:
    return (urlparse(url or "").netloc or "").lower().removeprefix("www.")


def registrable_root(host: str) -> str:
    host = (host or "").lower().removeprefix("www.")
    for prefix in _RELATED_PREFIX:
        if host.startswith(prefix):
            return host[len(prefix):]
    return host


def related_host(page_url: str, link_url: str, entity_name: str) -> bool:
    page_host = host_of(page_url)
    link_host = host_of(link_url)
    if not page_host or not link_host:
        return False
    if page_host == link_host:
        return True
    page_root = registrable_root(page_host)
    link_root = registrable_root(link_host)
    if page_root and page_root == link_root:
        return True
    if link_host.endswith("." + page_host) or page_host.endswith("." + link_host):
        return True
    slug = normalize_name(entity_name).replace(" ", "")
    return bool(slug) and len(slug) >= 4 and slug in link_host.replace("-", "")


def sibling_origins(url_or_host: str) -> list[str]:
    """Developer/docs/platform hosts next to a marketing domain. Not a crawl."""
    host = host_of(url_or_host) if "://" in (url_or_host or "") else (url_or_host or "")
    root = registrable_root(host)
    if not root or "." not in root:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for prefix in _SIBLING_PREFIXES:
        url = f"https://{prefix}.{root}"
        key = canonicalize_url(url)
        if key and key not in seen:
            seen.add(key)
            out.append(url)
    return out


def is_challenge_html(html: str) -> bool:
    text = html or ""
    if len(text) < 16_000 and _CHALLENGE.search(text):
        return True
    return False


def extract_embedded_text(html: str, *, limit: int = 8_000) -> str:
    """Pull price/percent lines out of JSON blobs (Next.js, JSON-LD). Never invent."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html or "", "html.parser")
    chunks: list[str] = []
    for script in soup.find_all("script"):
        stype = (script.get("type") or "").lower()
        raw = script.string or script.get_text() or ""
        if not raw or len(raw) < 20:
            continue
        if "ld+json" in stype or raw.lstrip()[:1] in "{[":
            chunks.append(raw[:80_000])
            continue
        if "$" in raw or "pric" in raw.lower():
            chunks.append(raw[:80_000])
    lines: list[str] = []
    for chunk in chunks:
        try:
            data = json.loads(chunk)
            chunk = json.dumps(data, ensure_ascii=False)
        except (TypeError, ValueError):
            chunk = re.sub(r"\\n|\\t", " ", chunk)
        for part in re.split(r"[\n\r]+", chunk):
            cleaned = " ".join(part.replace("\\u0024", "$").split())
            if _INTERESTING.search(cleaned) or (
                "price" in cleaned.lower() and re.search(r"\d", cleaned)
            ):
                lines.append(cleaned[:240])
            if len("\n".join(lines)) >= limit:
                return "\n".join(lines)[:limit]
    return "\n".join(lines)[:limit]


def extract_labeled_links(page_url: str, html: str, entity_name: str) -> list[tuple[str, str]]:
    """Official-surface links declared on a fetched page. At most one URL per kind."""
    from bs4 import BeautifulSoup

    found: dict[str, str] = {}

    def consider(url: str, anchor: str = "") -> None:
        if not url or url.startswith(("#", "mailto:", "javascript:", "tel:")):
            return
        if any(ch in url for ch in "{}[]<>"):
            return
        try:
            absolute = urljoin(page_url, url.split("#", 1)[0])
        except ValueError:
            return
        if not related_host(page_url, absolute, entity_name):
            return
        kind = classify_page_url(absolute, anchor)
        if not kind or kind in found:
            return
        found[kind] = canonicalize_url(absolute) or absolute

    soup = BeautifulSoup(html or "", "html.parser")
    for tag in soup.find_all("a", href=True):
        consider(tag["href"], tag.get_text(" ", strip=True))
        if len(found) >= 3:
            break
    if len(found) < 3:
        for href in _HREF_ABS.findall(html or ""):
            consider(href.rstrip(").,;"))
            if len(found) >= 3:
                break
    return [(kind, found[kind]) for kind in PAGE_KINDS if kind in found]


def sitemap_locs(xml: str, *, limit: int = 80) -> list[str]:
    return [loc.strip() for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml or "", re.I)[:limit]]


def is_sitemap_index(xml: str) -> bool:
    return "<sitemapindex" in (xml or "").lower()


def pages_from_sitemap(xml: str, origin: str, entity_name: str) -> list[tuple[str, str]]:
    found: dict[str, str] = {}
    for loc in sitemap_locs(xml):
        if not related_host(origin, loc, entity_name):
            continue
        kind = classify_page_url(loc)
        if not kind or kind in found:
            continue
        found[kind] = canonicalize_url(loc) or loc
        if len(found) >= 3:
            break
    return [(kind, found[kind]) for kind in PAGE_KINDS if kind in found]


def well_known_candidates(homepage: str, missing: set[str]) -> list[tuple[str, str]]:
    """Same-host path guesses. Callers must confirm before pinning."""
    parsed = urlparse(homepage)
    origin = f"{parsed.scheme or 'https'}://{parsed.netloc}"
    out: list[tuple[str, str]] = []
    for kind in PAGE_KINDS:
        if kind not in missing:
            continue
        for path in _PROBES[kind]:
            key = canonicalize_url(urljoin(origin.rstrip("/") + "/", path.lstrip("/")))
            if key:
                out.append((kind, key))
    return out
