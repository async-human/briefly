"""Entity snapshot comparison — same observation vs a real state change."""
from __future__ import annotations

from briefly_api.services.signals.snapshots import (
    aspect_label,
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


def test_normalize_and_labels():
    assert normalize_state("  API prices cut 40%  ") == "API prices cut 40%"
    assert aspect_label("pricing_positioning") == "pricing"
    assert aspect_label("model_api") == "API"
    assert aspect_label("product_release") == "product"
