"""Six-point brief field mapping and markdown export."""
from __future__ import annotations

from datetime import datetime, timezone

from briefly_api.agents.briefing_writer import _drafts_from_llm, _fallback_action, _fallback_who
from briefly_api.agents.context import PipelineContext, RawItem, UserContext


def _item() -> RawItem:
    return RawItem(
        id="c1",
        source_id="s1",
        source_type="rss",
        source_name="The Information",
        title="Anthropic raises $2.5B",
        url="https://example.com/a",
        author=None,
        published_at=datetime.now(timezone.utc),
        clean_text="Anthropic raised money.",
        content_hash="h1",
        summary="Anthropic closed a large round.",
    )


def _ctx() -> PipelineContext:
    user = UserContext(
        user_id="u1",
        email="a@b.com",
        name="Ada",
        profile={"role": "Founder", "goal": "raise a Series A"},
        recent_digest_items=[],
        seen_content_hashes=set(),
        active_story_threads=[],
        topic_clusters=[],
    )
    return PipelineContext(user=user, run_date="2026-08-31")


def test_llm_json_maps_six_point_fields():
    item = _item()
    ctx = _ctx()
    drafts = _drafts_from_llm(
        [item],
        {
            "c1": {
                "headline": "Anthropic closes $2.5B round",
                "summary": "The round funds a 100B-parameter model.",
                "why_it_matters_to_you": "You're raising a Series A.",
                "who_it_affects": "AI infrastructure founders raising now.",
                "suggested_action": "Revisit your timing memo.",
                "source_name": "The Information",
                "source_url": "https://example.com/a",
            }
        },
        ctx,
    )
    assert len(drafts) == 1
    assert drafts[0].who_it_affects == "AI infrastructure founders raising now."
    assert drafts[0].suggested_action == "Revisit your timing memo."


def test_llm_json_fills_six_point_fallback_when_blank():
    item = _item()
    ctx = _ctx()
    drafts = _drafts_from_llm(
        [item],
        {"c1": {"headline": item.title, "summary": item.summary, "why_it_matters_to_you": "As a founder this matters."}},
        ctx,
    )
    assert "Founder" in drafts[0].who_it_affects
    assert "Series A" in drafts[0].suggested_action


def test_fallback_who_and_action_use_profile():
    item = _item()
    profile = {"role": "Engineer", "goal": "ship an agent product"}
    assert _fallback_who(item, profile) == "Engineers tracking this story"
    assert "ship an agent product" in _fallback_action(item, profile)


def test_fallback_uses_operating_context():
    item = _item()
    profile = {
        "role": "Founder",
        "operating_context": {
            "company_name": "Northwind",
            "target_customers": "AI ops teams",
            "strategic_questions": ["Should we change model providers?"],
        },
    }
    assert "Northwind" in _fallback_who(item, profile)
    assert "model providers" in _fallback_action(item, profile)
