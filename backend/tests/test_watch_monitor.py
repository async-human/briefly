"""Watched-entity catalog, scoring, and dedup — no network."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from briefly_api.services.watch.catalog import (
    catalog_match,
    catalog_pages,
    generate_aliases,
    google_news_url,
    match_terms_for,
    topic_terms,
)
from briefly_api.services.watch.relevance import (
    WatchHit,
    canonicalize_url,
    dedupe_hits,
    recency_bonus,
    score_hit,
    title_similarity,
)


def test_catalog_openai_and_unknown():
    assert catalog_match("OpenAI")["name"] == "OpenAI"
    assert catalog_match("AnthropicAI")["name"] == "Anthropic"
    assert catalog_match("Cummins")["name"] == "Cummins"
    assert catalog_match("Sarvam AI")["name"] == "Sarvam"
    assert catalog_match("Totally Unknown Co") is None
    assert catalog_pages("OpenAI")
    assert not catalog_pages("Cummins")


def test_aliases_include_compact_and_domain():
    aliases = generate_aliases("OpenAI")
    lowered = {a.lower() for a in aliases}
    assert "openai" in lowered
    assert "openai.com" in lowered


def test_topic_terms_expand():
    terms = topic_terms("LLM fine-tuning")
    assert any("lora" in t.lower() for t in terms)


def test_google_news_url_quotes_entity():
    url = google_news_url("Anthropic")
    assert "news.google.com/rss/search" in url
    assert "Anthropic" in url or "Anthropic" in url.replace("+", " ")


def test_match_terms_merge_catalog_aliases():
    terms = match_terms_for("Anthropic", "company", [], [])
    assert any("claude" in t.lower() for t in terms)


def test_official_blog_scores_above_threshold():
    now = datetime.now(timezone.utc)
    hit = WatchHit(
        title="Anthropic announces Claude 4",
        url="https://www.anthropic.com/news/claude-4",
        source_name="Anthropic",
        source_type="blog",
        summary="A new model release with better coding.",
        published_at=now - timedelta(hours=2),
        is_official=True,
    )
    score = score_hit(
        hit,
        entity_name="Anthropic",
        kind="company",
        keywords=[],
        aliases=["Claude"],
        now=now,
    )
    assert score >= 0.7


def test_unrelated_story_stays_below_threshold():
    now = datetime.now(timezone.utc)
    hit = WatchHit(
        title="City council debates parking fees",
        url="https://example.com/parking",
        source_name="Local News",
        source_type="news",
        summary="Residents spoke for and against a new meter plan.",
        published_at=now - timedelta(hours=1),
    )
    score = score_hit(
        hit,
        entity_name="Anthropic",
        kind="company",
        keywords=[],
        aliases=[],
        now=now,
    )
    assert score < 0.7


def test_recency_decays():
    now = datetime.now(timezone.utc)
    assert recency_bonus(now - timedelta(hours=3), now) == 0.1
    assert recency_bonus(now - timedelta(days=5), now) == 0.0


def test_dedupe_keeps_official_and_related_urls():
    now = datetime.now(timezone.utc)
    official = WatchHit(
        title="OpenAI launches GPT-5",
        url="https://openai.com/blog/gpt-5",
        source_name="OpenAI",
        source_type="blog",
        is_official=True,
        score=0.9,
        published_at=now,
    )
    echo = WatchHit(
        title="OpenAI launches GPT-5 for developers",
        url="https://techcrunch.com/openai-gpt-5",
        source_name="TechCrunch",
        source_type="news",
        score=0.75,
        published_at=now,
    )
    clusters = dedupe_hits([echo, official])
    assert len(clusters) == 1
    assert clusters[0].is_official
    assert echo.url in clusters[0].related_urls


def test_canonicalize_strips_www_and_query():
    assert canonicalize_url("https://www.openai.com/blog/x?utm=1") == "https://openai.com/blog/x"


def test_title_similarity_high_for_near_dupes():
    assert title_similarity("OpenAI launches GPT-5", "OpenAI launches GPT-5 today") >= 0.7
