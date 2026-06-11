"""Optional context for LLM usage ledger (pipeline / background jobs)."""
from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Iterator

_llm_user_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("llm_user_id", default=None)
_llm_agent: contextvars.ContextVar[str | None] = contextvars.ContextVar("llm_agent", default=None)


def get_llm_user_id() -> str | None:
    return _llm_user_id.get()


def get_llm_agent() -> str | None:
    return _llm_agent.get()


@contextmanager
def llm_usage_scope(*, user_id: str | None = None, agent: str | None = None) -> Iterator[None]:
    """Set default user_id / agent for nested LLM calls in a pipeline run."""
    user_token = _llm_user_id.set(user_id) if user_id is not None else None
    agent_token = _llm_agent.set(agent) if agent is not None else None
    try:
        yield
    finally:
        if user_token is not None:
            _llm_user_id.reset(user_token)
        if agent_token is not None:
            _llm_agent.reset(agent_token)
