"""Typed change detectors for the first three founder-relevant signal types."""
from __future__ import annotations

from briefly_api.services.signals.detectors import (
    DETECTOR_MODEL_API,
    DETECTOR_PRICING,
    DETECTOR_PRODUCT,
    classify_change,
)
from briefly_api.services.signals.persist import is_material_signal


def test_pricing_change():
    result = classify_change(
        title="Anthropic cuts Claude API pricing 40% for enterprise plans",
        summary="New packaging moves the flagship model downmarket.",
        entity_name="Anthropic",
        entity_kind="company",
    )
    assert result.detector_type == DETECTOR_PRICING
    assert result.confidence >= 0.5
    assert "pricing" in result.extracted_claim.lower() or "API" in result.extracted_claim


def test_model_api_release():
    result = classify_change(
        title="OpenAI launches GPT-5 in the API with a larger context window",
        summary="The new model is available via API. Older endpoints are deprecated.",
        entity_name="OpenAI",
        entity_kind="company",
    )
    assert result.detector_type == DETECTOR_MODEL_API
    assert result.confidence >= 0.5


def test_product_changelog():
    result = classify_change(
        title="Linear changelog: introducing projects v2",
        summary="What's new this week in the product.",
        source_type="changelog",
        entity_name="Linear",
        entity_kind="product",
    )
    assert result.detector_type == DETECTOR_PRODUCT
    assert result.supporting_passage


def test_unrelated_is_other():
    result = classify_change(
        title="City council debates parking fees",
        summary="Local news only.",
        entity_name="Anthropic",
    )
    assert result.detector_type == "other"
    assert result.confidence < 0.4


def test_materiality_requires_confident_and_company_relevant_change():
    base = {
        "detector_type": DETECTOR_PRICING,
        "detector_confidence": 0.8,
        "relevance_score": 0.9,
        "is_urgent": False,
        "why_it_matters": "This changes our model economics.",
    }
    assert is_material_signal(**base)
    assert not is_material_signal(**{**base, "relevance_score": 0.4})
    assert not is_material_signal(**{**base, "detector_confidence": 0.4})
    assert not is_material_signal(**{**base, "why_it_matters": ""})
    assert is_material_signal(**{**base, "relevance_score": 0.4, "is_urgent": True})
