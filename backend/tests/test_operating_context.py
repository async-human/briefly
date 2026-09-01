"""Operating context normalize/format/questions."""
from __future__ import annotations

from briefly_api.services.operating_context import (
    distinctive_tokens,
    format_operating_context,
    has_operating_context,
    merge_operating_context,
    normalize_operating_context,
    questions_hit_by_text,
)


def test_normalize_trims_and_caps_questions():
    ctx = normalize_operating_context({
        "company_name": "  Northwind  ",
        "competitors": ["OpenAI", "openai", "Anthropic", ""],
        "strategic_questions": [
            "Should we change model providers?",
            "Should we change model providers?",
            "x",
            "What is our pricing response if Anthropic cuts API prices?",
        ],
    })
    assert ctx["company_name"] == "Northwind"
    assert ctx["competitors"] == ["OpenAI", "Anthropic"]
    assert len(ctx["strategic_questions"]) == 2
    assert ctx["strategic_questions"][0].startswith("Should we")


def test_merge_patches_only_provided_keys():
    existing = normalize_operating_context({"company_name": "Acme", "product": "Copilot"})
    merged = merge_operating_context(existing, {"product": "Ops copilot", "competitors": ["Linear"]})
    assert merged["company_name"] == "Acme"
    assert merged["product"] == "Ops copilot"
    assert merged["competitors"] == ["Linear"]


def test_format_includes_competitors_and_questions():
    text = format_operating_context({
        "company_name": "Northwind",
        "competitors": ["Anthropic"],
        "strategic_questions": ["Should we switch model providers?"],
    })
    assert "Northwind" in text
    assert "Anthropic" in text
    assert "switch model providers" in text
    assert has_operating_context({"company_name": "Northwind"})
    assert not has_operating_context({})


def test_questions_hit_by_distinctive_tokens():
    ctx = {"strategic_questions": ["Should we change model providers this quarter?"]}
    hits = questions_hit_by_text(ctx, "Anthropic cut API prices for their model providers")
    assert hits
    assert not questions_hit_by_text(ctx, "City council debates parking")
    assert not questions_hit_by_text(ctx, "Our pricing changed this quarter")
    assert distinctive_tokens("Should we change model providers this quarter?") == [
        "change", "model", "providers", "quarter",
    ]
