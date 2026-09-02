"""Pinned official-page change detection — no live network."""
from __future__ import annotations

from briefly_api.services.signals.detectors import DETECTOR_MODEL_API, DETECTOR_PRICING, classify_change
from briefly_api.services.watch.catalog import catalog_pages
from briefly_api.services.watch.pages import (
    PAGE_SOURCE_TYPES,
    canonicalize_extract,
    changed_excerpt,
    evaluate_extract,
    hash_extract,
    robots_status,
)


def test_catalog_pins_openai_pricing_and_skips_unknown():
    openai = dict(catalog_pages("OpenAI"))
    assert openai["pricing"] == "https://developers.openai.com/api/docs/pricing"
    assert openai["docs"].startswith("https://developers.openai.com/")
    assert openai["changelog"].startswith("https://developers.openai.com/")
    assert len(openai) <= 3
    assert catalog_pages("Totally Unknown Co") == []
    assert catalog_pages("Cummins") == []
    sarvam = dict(catalog_pages("Sarvam"))
    assert "api-pricing" in sarvam["pricing"]
    nvidia = dict(catalog_pages("nvidia"))
    assert nvidia["docs"].startswith("https://docs.nvidia.com")


def test_catalog_anthropic_has_official_pages():
    pages = dict(catalog_pages("Anthropic"))
    assert pages["pricing"].startswith("https://claude.com/")
    assert "changelog" in pages
    assert set(pages) <= PAGE_SOURCE_TYPES


def test_canonicalize_drops_cookie_and_relative_time():
    raw = "GPT-4o $5.00\nAccept all cookies\nUpdated 3 hours ago\nUpdated pricing for GPT-4o $20"
    cleaned = canonicalize_extract(raw)
    assert "GPT-4o $5.00" in cleaned
    assert "Updated pricing for GPT-4o $20" in cleaned
    assert "cookies" not in cleaned.lower()
    assert "hours ago" not in cleaned


def test_same_hash_is_unchanged():
    text = canonicalize_extract(
        "Input $5.00 / 1M tokens\nOutput $30.00 / 1M tokens\n" + ("batch processing available. " * 12)
    )
    digest = hash_extract(text)
    decision = evaluate_extract(digest, text, text)
    assert decision.kind == "unchanged"
    assert len(text) >= 200


def test_first_fetch_is_baseline_with_no_excerpt():
    page = "Input $5.00 / 1M tokens\nOutput $30.00 / 1M tokens\n" + ("batch discount. " * 20)
    decision = evaluate_extract(None, None, page)
    assert decision.kind == "baseline"
    assert decision.excerpt == ""
    assert decision.digest


def test_thin_extract_is_error_not_baseline():
    decision = evaluate_extract(None, None, "Loading…")
    assert decision.kind == "thin"
    assert decision.error
    assert not decision.digest


def test_percent_and_price_change_in_excerpt():
    old = canonicalize_extract(
        "GPT-4o input $5.00 / 1M tokens\nEnterprise plan 20% discount\n" + ("stable copy. " * 15)
    )
    new = canonicalize_extract(
        "GPT-4o input $2.50 / 1M tokens\nEnterprise plan 40% discount\n" + ("stable copy. " * 15)
    )
    decision = evaluate_extract(hash_extract(old), old, new)
    assert decision.kind == "changed"
    assert "$2.50" in decision.excerpt
    assert "40%" in decision.excerpt
    excerpt = changed_excerpt(old, new)
    assert "$2.50" in excerpt
    assert "40%" in excerpt


def test_robots_disallow(monkeypatch):
    class Deny:
        def can_fetch(self, _ua, _url):
            return False

    monkeypatch.setattr("briefly_api.services.watch.pages._load_robots", lambda _origin: Deny())
    assert robots_status("https://example.com/pricing") == "disallow"


def test_robots_allow_when_missing(monkeypatch):
    monkeypatch.setattr("briefly_api.services.watch.pages._load_robots", lambda _origin: None)
    assert robots_status("https://example.com/pricing") == "allow"


def test_pricing_source_type_forces_pricing_detector():
    result = classify_change(
        title="OpenAI pricing page changed",
        summary="GPT-5.6 Sol Input $4.00 / 1M tokens",
        source_type="pricing",
        entity_name="OpenAI",
        entity_kind="company",
        previous_state="GPT-5.6 Sol Input $5.00 / 1M tokens",
    )
    assert result.detector_type == DETECTOR_PRICING
    assert result.confidence >= 0.88
    assert "$4.00" in result.new_state
    assert "$5.00" in result.previous_state


def test_docs_source_type_forces_model_api_detector():
    result = classify_change(
        title="Anthropic docs page changed",
        summary="New Messages API endpoint and rate limit.",
        source_type="docs",
        entity_name="Anthropic",
        entity_kind="company",
    )
    assert result.detector_type == DETECTOR_MODEL_API


def test_classify_page_url_prefers_pricing_over_docs_path():
    from briefly_api.services.watch.resolve import classify_page_url

    assert classify_page_url("https://openai.com/api/pricing/") == "pricing"
    assert classify_page_url("https://developers.openai.com/api/docs/pricing") == "pricing"
    assert classify_page_url("https://www.sarvam.ai/api-pricing") == "pricing"
    assert classify_page_url("https://linear.app/changelog") == "changelog"
    assert classify_page_url("https://docs.stripe.com/changelog") == "changelog"
    assert classify_page_url("https://platform.claude.com/docs") == "docs"
    assert classify_page_url("https://docs.nvidia.com/") == "docs"
    assert classify_page_url("https://developers.openai.com/llms.txt") is None
    assert classify_page_url("https://www.sarvam.ai/products/doc-agents") is None
    assert classify_page_url("https://platform.openai.com/login") is None
    assert classify_page_url("https://example.com/about") is None


def test_homepage_candidates_for_unknown_company():
    from briefly_api.services.watch.resolve import homepage_candidates

    urls = homepage_candidates("Cummins")
    joined = " ".join(urls).lower()
    assert "cummins.com" in joined
    assert catalog_pages("Cummins") == []


def test_homepage_candidates_include_developer_siblings():
    from briefly_api.services.watch.resolve import homepage_candidates
    from briefly_api.services.watch.scrape import sibling_origins

    urls = " ".join(homepage_candidates("OpenAI")).lower()
    assert "developers.openai.com" in urls
    siblings = " ".join(sibling_origins("https://openai.com"))
    assert "developers.openai.com" in siblings
    assert "platform.openai.com" in siblings


def test_nav_labels_select_official_pages_without_crawling():
    from briefly_api.services.watch.resolve import extract_labeled_links, well_known_candidates

    html = """
    <nav>
      <a href="/pricing"><span>Pricing</span></a>
      <a href="https://docs.acme.com/">Docs</a>
      <a href="/blog/why-we-raised">Ignore me</a>
      <a href="/changelog">Changelog</a>
    </nav>
    <script type="application/json">{"next":"https://acme.com/api-pricing"}</script>
    """
    links = dict(extract_labeled_links("https://acme.com/", html, "Acme"))
    assert links["pricing"] == "https://acme.com/pricing"
    assert links["docs"].startswith("https://docs.acme.com")
    assert links["changelog"] == "https://acme.com/changelog"
    probes = well_known_candidates("https://acme.com/", {"pricing"})
    assert any(url.endswith("/pricing") for _, url in probes)
    assert any("api-pricing" in url for _, url in probes)


def test_sitemap_picks_official_paths_only():
    from briefly_api.services.watch.resolve import pages_from_sitemap

    xml = """
    <urlset>
      <loc>https://acme.com/blog/hello-world</loc>
      <loc>https://acme.com/pricing</loc>
      <loc>https://other.com/pricing</loc>
      <loc>https://acme.com/docs/api</loc>
    </urlset>
    """
    found = dict(pages_from_sitemap(xml, "https://acme.com/", "Acme"))
    assert found["pricing"] == "https://acme.com/pricing"
    assert found["docs"] == "https://acme.com/docs/api"
    assert "https://other.com/pricing" not in found.values()


def test_coverage_news_only_when_no_pages():
    from types import SimpleNamespace

    from briefly_api.services.watch.resolve import coverage_from_sources

    cov = coverage_from_sources([
        SimpleNamespace(source_type="news", url="https://news.google.com/x", last_error=None, content_hash=None),
    ])
    assert cov["status"] == "news_only"
    assert "Pin a URL" in cov["note"] or "pin" in cov["note"].lower()


def test_coverage_includes_last_known_excerpt():
    from types import SimpleNamespace

    from briefly_api.services.watch.pages import known_excerpt
    from briefly_api.services.watch.resolve import coverage_from_sources

    extract = "GPT-4o input $2.50 / 1M tokens\nEnterprise plan 40% discount\n" + ("stable copy. " * 20)
    snippet = known_excerpt(extract)
    assert "$2.50" in snippet
    assert "40%" in snippet
    assert "stable copy" not in snippet or snippet.index("$2.50") < snippet.find("stable")

    cov = coverage_from_sources([
        SimpleNamespace(
            source_type="pricing",
            url="https://openai.com/api/pricing/",
            last_error=None,
            content_hash="abc",
            last_extract=extract,
        ),
    ])
    assert cov["status"] in {"partial", "official"}
    assert cov["pages"][0]["excerpt"]
    assert "$2.50" in cov["pages"][0]["excerpt"]


def test_coverage_failing_page_is_not_news_only():
    from types import SimpleNamespace

    from briefly_api.services.watch.resolve import coverage_from_sources

    cov = coverage_from_sources([
        SimpleNamespace(
            source_type="pricing",
            url="https://openai.com/api/pricing/",
            last_error="openai.com blocks automated access (403)",
            content_hash=None,
            last_extract=None,
        ),
    ])
    assert cov["status"] == "partial"
    assert cov["pages"][0]["status"] == "failing"
    assert "unreadable" in cov["note"].lower() or "blocked" in cov["note"].lower()


def test_embedded_json_prices_and_challenge_html():
    from briefly_api.services.watch.pages import extract_visible_text
    from briefly_api.services.watch.scrape import extract_embedded_text, is_challenge_html, is_sitemap_index

    html = """
    <html><body><div>Loading</div>
    <script type="application/ld+json">{"offers":[{"price":"2.50","priceCurrency":"USD"}]}</script>
    </body></html>
    """
    text = extract_embedded_text(html)
    assert "2.50" in text
    assert "$" in text or "USD" in text
    visible = extract_visible_text(html, "https://example.com/pricing")
    assert "2.50" in visible
    assert is_challenge_html("<html><title>Just a moment...</title><body>cf-browser-verification</body></html>")
    assert is_sitemap_index("<sitemapindex><sitemap><loc>https://acme.com/s.xml</loc></sitemap></sitemapindex>")


def test_prefer_developer_pricing_over_blocked_marketing():
    from types import SimpleNamespace

    from briefly_api.services.watch.pages import _prefer_live_sources

    old = SimpleNamespace(
        source_type="pricing",
        url="https://openai.com/api/pricing",
        last_error="403",
        content_hash=None,
        consecutive_failures=2,
    )
    new = SimpleNamespace(
        source_type="pricing",
        url="https://developers.openai.com/api/docs/pricing",
        last_error=None,
        content_hash=None,
        consecutive_failures=0,
    )
    picked = _prefer_live_sources([old, new])
    assert len(picked) == 1
    assert "developers.openai.com" in picked[0].url


def test_ingest_stores_pricing_extract(monkeypatch):
    import asyncio
    from datetime import datetime, timezone
    from types import SimpleNamespace

    from briefly_api.services.watch.pages import _ingest_source

    async def fake_fetch(url, timeout=25.0):
        body = "GPT-4o input $2.50 / 1M tokens\n" + ("Official API pricing. " * 20)
        return url, f"<html><body>{body}</body></html>"

    monkeypatch.setattr("briefly_api.services.watch.pages.fetch_html", fake_fetch)
    monkeypatch.setattr("briefly_api.services.watch.pages.robots_status", lambda _url: "allow")
    src = SimpleNamespace(
        url="https://developers.openai.com/api/docs/pricing",
        source_type="pricing",
        content_hash=None,
        last_extract=None,
        last_error=None,
        last_fetched=None,
        consecutive_failures=0,
    )
    decision = asyncio.run(_ingest_source(src, "OpenAI", datetime.now(timezone.utc)))
    assert decision is not None
    assert decision.kind == "baseline"
    assert src.content_hash
    assert "$2.50" in (src.last_extract or "")
    assert src.last_error is None

