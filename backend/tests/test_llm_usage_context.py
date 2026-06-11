"""LLM usage context helpers."""
from __future__ import annotations

from briefly_api.llm.usage_context import get_llm_agent, get_llm_user_id, llm_usage_scope


def test_llm_usage_scope_sets_and_resets():
    assert get_llm_user_id() is None
    assert get_llm_agent() is None

    with llm_usage_scope(user_id="u1", agent="pipeline"):
        assert get_llm_user_id() == "u1"
        assert get_llm_agent() == "pipeline"

    assert get_llm_user_id() is None
    assert get_llm_agent() is None
