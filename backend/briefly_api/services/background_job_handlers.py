"""Job handler registrations — kept separate to avoid import cycles."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from briefly_api.services.background_jobs import register_job_handler


async def _post_pipeline(payload: dict[str, Any]) -> None:
    from briefly_api.agents.pipeline import run_post_pipeline_agents_job

    await run_post_pipeline_agents_job(payload)


async def _footprint(_payload: dict[str, Any]) -> None:
    from briefly_api.workers.scheduler import run_footprint_scan_job

    await run_footprint_scan_job()


async def _weekly_intelligence(_payload: dict[str, Any]) -> None:
    from briefly_api.workers.scheduler import run_weekly_intelligence_job

    await run_weekly_intelligence_job()


async def _story_thread(_payload: dict[str, Any]) -> None:
    from briefly_api.workers.scheduler import run_story_thread_agent_job

    await run_story_thread_agent_job()


async def _proactive(_payload: dict[str, Any]) -> None:
    from briefly_api.services.proactive_notifier import send_pending_proactive_alerts

    await send_pending_proactive_alerts()


async def _weekly_reports(payload: dict[str, Any]) -> None:
    from briefly_api.services.weekly_email import send_weekly_reports_for_due_users

    now_s = payload.get("now_utc")
    now = datetime.fromisoformat(now_s) if now_s else datetime.now(timezone.utc)
    await send_weekly_reports_for_due_users(now)


def register_all_job_handlers() -> None:
    register_job_handler("post_pipeline_agents", _post_pipeline)
    register_job_handler("footprint_scan", _footprint)
    register_job_handler("weekly_intelligence", _weekly_intelligence)
    register_job_handler("story_thread_agent", _story_thread)
    register_job_handler("proactive_alerts", _proactive)
    register_job_handler("weekly_reports", _weekly_reports)
