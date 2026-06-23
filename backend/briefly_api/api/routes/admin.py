"""
briefly_api/api/routes/admin.py

Operator-only endpoints, gated by the X-Admin-Key header (settings.admin_key).
Not for end users — these run internal tooling against the deployed instance so
we can operate Briefly without local setup.

  GET /admin/eval/run?suite=grounded_email   → run an eval suite, return the report
"""
from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import get_db

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(x_admin_key: str | None, settings: Settings) -> None:
    configured = (settings.admin_key or "").strip()
    if not configured or configured == "change-me-admin-key":
        # Refuse rather than run with the insecure default.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="ADMIN_KEY is not set to a secure value on this deployment.",
        )
    if not x_admin_key or not hmac.compare_digest(x_admin_key, configured):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid admin key.")


@router.get("/eval/run")
async def run_eval(
    suite: str | None = Query(None, description="Suite name, or omit to run all"),
    x_admin_key: str | None = Header(None, alias="X-Admin-Key"),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Run the eval harness on the deployed instance and return the report.

    The baseline command for the roadmap — gives faithfulness / task-success
    numbers using the live model + config, with no local setup."""
    _require_admin(x_admin_key, settings)

    from briefly_api.eval.harness import run_suite
    from briefly_api.eval.run import _SUITES

    names = [suite] if suite else list(_SUITES)
    summaries = []
    overall_ok = True
    for name in names:
        builder = _SUITES.get(name)
        if not builder:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Unknown suite '{name}'. Available: {', '.join(_SUITES)}",
            )
        suite_name, cases, runner, scorers, min_pass = builder()
        report = await run_suite(suite_name, cases, runner, scorers)
        s = report.summary()
        s["gate"] = {"min_pass_rate": min_pass, "passed": report.gate(min_pass)}
        overall_ok = overall_ok and report.gate(min_pass)
        summaries.append(s)

    log.info("admin eval run: suites=%s ok=%s", names, overall_ok)
    return {"suites": summaries, "ok": overall_ok}


@router.get("/agent-runs")
async def list_agent_runs(
    limit: int = Query(20, ge=1, le=100),
    x_admin_key: str | None = Header(None, alias="X-Admin-Key"),
    settings: Settings = Depends(get_settings),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Inspect the act-layer audit log — recent agent runs with their tool traces.
    Observability: see what the agent did, how it ended, and how long it took."""
    _require_admin(x_admin_key, settings)

    from briefly_api.db.models import AgentRun

    rows = (
        await db.execute(
            select(AgentRun).order_by(AgentRun.created_at.desc()).limit(limit)
        )
    ).scalars().all()

    return {
        "count": len(rows),
        "runs": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "surface": r.surface,
                "goal": r.goal,
                "answer": r.answer,
                "tools_used": r.tools_used,
                "stopped_reason": r.stopped_reason,
                "duration_ms": r.duration_ms,
                "steps": r.steps,
                "thread_id": r.thread_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }
