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
    assert openai["pricing"] == "https://openai.com/api/pricing/"
    assert len(openai) <= 3
    assert catalog_pages("Totally Unknown Co") == []
    assert catalog_pages("Cummins") == []


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
    assert classify_page_url("https://linear.app/changelog") == "changelog"
    assert classify_page_url("https://docs.stripe.com/changelog") == "changelog"
    assert classify_page_url("https://platform.claude.com/docs") == "docs"
    assert classify_page_url("https://example.com/about") is None


def test_homepage_candidates_for_unknown_company():
    from briefly_api.services.watch.resolve import homepage_candidates

    urls = homepage_candidates("Cummins")
    joined = " ".join(urls).lower()
    assert "cummins.com" in joined
    assert catalog_pages("Cummins") == []


def test_nav_labels_select_official_pages_without_crawling():
    from briefly_api.services.watch.resolve import extract_labeled_links, well_known_candidates

    html = """
    <nav>
      <a href="/pricing">Pricing</a>
      <a href="https://docs.acme.com/">Docs</a>
      <a href="/blog/why-we-raised">Ignore me</a>
      <a href="/changelog">Changelog</a>
    </nav>
    """
    links = dict(extract_labeled_links("https://acme.com/", html, "Acme"))
    assert links["pricing"] == "https://acme.com/pricing"
    assert links["docs"].startswith("https://docs.acme.com")
    assert links["changelog"] == "https://acme.com/changelog"
    probes = well_known_candidates("https://acme.com/", {"pricing"})
    assert any(url.endswith("/pricing") for _, url in probes)


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

