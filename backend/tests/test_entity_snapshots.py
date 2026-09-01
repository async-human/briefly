"""Entity snapshot comparison — same observation vs a real state change."""
from __future__ import annotations

from briefly_api.services.signals.snapshots import (
    aspect_label,
    event_fingerprint,
    extract_state_fields,
    normalize_state,
    same_observation,
)


def test_same_observation_exact_and_contained():
    a = "Anthropic cuts Claude API pricing 40% for enterprise plans"
    b = "Anthropic cuts Claude API pricing 40%"
    assert same_observation(a, b)
    assert same_observation(a, a)


def test_price_percent_change_is_not_the_same_observation():
    held = "Anthropic Claude API list price unchanged"
    cut = "Anthropic cuts Claude API pricing 40% for enterprise plans"
    hike = "Anthropic raises Claude API pricing 15%"
    assert not same_observation(cut, hike)
    assert not same_observation(held, cut)
    assert not same_observation("", cut)


def test_unrelated_headlines_are_not_the_same():
    assert not same_observation(
        "Anthropic cuts Claude API pricing 40%",
        "Linear changelog: introducing projects v2",
    )
    assert not same_observation(
        "Linear launches new project templates",
        "Linear launches new issue templates",
    )


def test_structured_version_recognizes_paraphrased_same_event():
    first = "OpenAI launches GPT-6 API with 1M context"
    second = "GPT-6 now available to developers with million-token context window"
    assert same_observation(first, second)
    assert extract_state_fields(first)["value"] == "gpt-6"


def test_direction_prevents_false_percent_match():
    assert not same_observation(
        "Claude API pricing cut 20%",
        "Claude API pricing increased 20%",
    )


def test_event_fingerprint_allows_reused_url_to_change():
    url = "https://example.com/pricing"
    first = event_fingerprint("pricing_positioning", "API pricing cut 20%", url)
    retry = event_fingerprint("pricing_positioning", "API pricing cut 20%", url)
    later = event_fingerprint("pricing_positioning", "API pricing cut 35%", url)
    assert first == retry
    assert first == event_fingerprint(
        "pricing_positioning",
        "API pricing cut 20%",
        f"{url}/?utm_source=newsletter",
    )
    assert first == event_fingerprint(
        "pricing_positioning",
        "API pricing cut 20%",
        "https://another-source.example/report",
    )
    assert first != later


def test_normalize_and_labels():
    assert normalize_state("  API prices cut 40%  ") == "API prices cut 40%"
    assert aspect_label("pricing_positioning") == "pricing"
    assert aspect_label("model_api") == "API"
    assert aspect_label("product_release") == "product"
