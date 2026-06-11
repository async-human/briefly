"""Persist per-call LLM token usage for cost visibility."""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import LlmUsage
from briefly_api.llm.usage_context import get_llm_agent, get_llm_user_id

log = logging.getLogger(__name__)


async def record_llm_usage(
    *,
    user_id: str | None = None,
    agent: str | None = None,
    model: str,
    input_tokens: int,
    output_tokens: int,
    usage_day: date | None = None,
) -> None:
    """Append one ledger row. Failures are logged and never raised to callers."""
    resolved_user = user_id if user_id is not None else get_llm_user_id()
    resolved_agent = (agent or get_llm_agent() or "unknown").strip() or "unknown"
    day = usage_day or datetime.now(timezone.utc).date()

    try:
        async with SessionLocal() as session:
            session.add(
                LlmUsage(
                    user_id=resolved_user,
                    agent=resolved_agent,
                    model=model,
                    input_tokens=max(0, int(input_tokens)),
                    output_tokens=max(0, int(output_tokens)),
                    usage_day=day,
                )
            )
            await session.commit()
    except Exception:
        log.warning(
            "Failed to record LLM usage (user=%s agent=%s model=%s)",
            resolved_user,
            resolved_agent,
            model,
            exc_info=True,
        )
