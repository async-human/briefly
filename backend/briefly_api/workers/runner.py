"""
Worker process entrypoint — scheduler, enrichment, and background jobs.

Usage:
  BRIEFLY_PROCESS_ROLE=worker python -m briefly_api.workers.runner
"""
from __future__ import annotations

import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


async def _run() -> None:
    from briefly_api.config import get_settings
    from briefly_api.db.engine import init_db
    from briefly_api.services.background_jobs import background_job_loop, ensure_job_handlers
    from briefly_api.services.embedding_guard import validate_embedding_configuration
    from briefly_api.workers.enrichment_worker import continuous_enrichment_loop
    from briefly_api.workers.scheduler import digest_scheduler_loop

    settings = get_settings()
    if not settings.runs_background_workers:
        log.error("BRIEFLY_PROCESS_ROLE must be worker or all — got %s", settings.process_role)
        sys.exit(1)

    await init_db()
    validate_embedding_configuration()

    if settings.scheduler_lock_strict and not (settings.redis_url or "").strip():
        log.error("Production worker requires REDIS_URL for scheduler locks")
        sys.exit(1)

    ensure_job_handlers()
    log.info("Briefly worker starting (env=%s)", settings.app_env)

    tasks = [
        asyncio.create_task(digest_scheduler_loop(), name="scheduler"),
        asyncio.create_task(background_job_loop(), name="background_jobs"),
    ]
    if settings.enrichment_worker_enabled:
        tasks.append(asyncio.create_task(continuous_enrichment_loop(), name="enrichment"))

    from briefly_api.ingestion.smtp_server import start_smtp_server

    smtp_controller = None
    if settings.smtp_ingestion_active:
        smtp_controller = start_smtp_server(settings)

    try:
        await asyncio.gather(*tasks)
    finally:
        if smtp_controller:
            smtp_controller.stop()


def main() -> None:
    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        log.info("Worker stopped")


if __name__ == "__main__":
    main()
