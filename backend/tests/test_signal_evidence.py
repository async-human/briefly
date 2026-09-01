"""Evidence bundles, watching pin fields, and precision baseline."""
from __future__ import annotations

from types import SimpleNamespace

from briefly_api.services.operating_context import who_affected_from_context
from briefly_api.services.signals.evidence import (
    bundle_from_item,
    bundle_from_signal,
    evidence_piece,
    normalize_label,
    precision_from_labels,
    url_key,
    watching_alert_item_kwargs,
)


def test_url_key_strips_www_and_slash():
    assert url_key("https://www.Example.com/path/") == url_key("https://example.com/path")


def test_bundle_from_item_includes_sources_and_contradiction():
    item = SimpleNamespace(
        source_url="https://example.com/a",
        source_name="The Information",
        headline="Anthropic cuts API prices",
        summary="Enterprise plans moved downmarket.",
        all_sources=[{"name": "TechCrunch", "url": "https://techcrunch.com/a"}],
        contradiction_flag=True,
        contradiction_explanation="Last week you read they were holding prices.",
        relevance_score=0.81,
    )
    bundle = bundle_from_item(item)
    assert bundle["signal_id"] is None
    assert bundle["extracted_claim"].startswith("Anthropic")
    assert len(bundle["pieces"]) == 3
    assert bundle["corroborating_count"] >= 1
    assert bundle["contradictory"]


def test_bundle_from_signal_separates_corroboration():
    pieces = [
        evidence_piece(
            source_url="https://anthropic.com/pricing",
            source_name="Anthropic",
            extracted_claim="API prices cut 40%",
            supporting_passage="Enterprise plans are cheaper.",
        ),
        evidence_piece(
            source_url="https://techcrunch.com/anthropic-pricing",
            source_name="TechCrunch",
        ),
        evidence_piece(
            source_url="https://example.com/old",
            extracted_claim="Prices held last quarter",
            is_contradictory=True,
        ),
    ]
    bundle = bundle_from_signal(
        signal_id="sig-1",
        detector_type="pricing_positioning",
        confidence=0.82,
        previous_state="Claude API list price unchanged",
        new_state="API prices cut 40%",
        is_material_change=True,
        is_state_change=True,
        event_fingerprint="event-1",
        pieces=pieces,
        label="useful",
    )
    assert bundle["signal_id"] == "sig-1"
    assert bundle["corroborating_count"] == 1
    assert bundle["previous_state"]
    assert bundle["is_material_change"] is True
    assert bundle["is_state_change"] is True
    assert bundle["label"] == "useful"
    assert len(bundle["contradictory"]) == 1


def test_precision_from_labels():
    summary = precision_from_labels(["useful", "acted_on", "irrelevant", "duplicate", "incorrect"])
    assert summary["labeled"] == 5
    assert summary["useful"] == 2
    assert summary["not_useful"] == 3
    assert summary["precision"] == 0.4
    assert precision_from_labels([])["precision"] is None


def test_normalize_label_aliases():
    assert normalize_label("Useful") == "useful"
    assert normalize_label("acted") == "acted_on"
    assert normalize_label("dismissed") == "irrelevant"
    assert normalize_label("changed_my_decision") == "useful"
    assert normalize_label("nope") is None


def test_watching_alert_becomes_six_point_item():
    fields = watching_alert_item_kwargs(
        {
            "id": "a1",
            "title": "Anthropic cuts Claude API pricing",
            "what_changed": "Enterprise plans dropped 40%.",
            "why_it_matters": "Your inference budget may be high relative to the new floor.",
            "action": "Revisit the model cost memo.",
            "source_url": "https://anthropic.com/pricing",
            "source_name": "Anthropic",
            "entity_name": "Anthropic",
            "detector_type": "pricing_positioning",
            "confidence": 0.8,
            "related_urls": ["https://techcrunch.com/a"],
        },
        {"operating_context": {"company_name": "Northwind", "target_customers": "AI ops teams"}},
    )
    assert fields["headline"].startswith("Anthropic")
    assert fields["suggested_action"].startswith("Revisit")
    assert "Northwind" in (fields["who_it_affects"] or "")
    assert fields["score_breakdown"]["watch_alert_id"] == "a1"
    assert fields["duplicate_count"] == 2


def test_who_affected_from_context():
    assert "Northwind" in who_affected_from_context({"company_name": "Northwind"})
    assert who_affected_from_context({}) == ""
