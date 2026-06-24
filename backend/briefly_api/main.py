from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from briefly_api.api.router import api_router
from briefly_api.config import get_settings
from briefly_api.db.engine import init_db, close_db
from briefly_api.ingestion.smtp_server import start_smtp_server
from briefly_api.services.embedding_guard import validate_embedding_configuration

# Observability is optional — a missing/broken Sentry SDK must never stop the
# API from booting. It's pinned in requirements, so production still gets it.
try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    _SENTRY_AVAILABLE = True
except ImportError:
    _SENTRY_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_settings = get_settings()
if _settings.sentry_dsn and _SENTRY_AVAILABLE:
    sentry_sdk.init(
        dsn=_settings.sentry_dsn,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=_settings.sentry_traces_sample_rate,
        environment=_settings.app_env,
        send_default_pii=False,
    )
    logger.info("Sentry initialised (env=%s)", _settings.app_env)
elif _settings.sentry_dsn and not _SENTRY_AVAILABLE:
    logger.warning("SENTRY_DSN is set but sentry-sdk is not installed — error tracking disabled")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()

    settings.validate_production_security()

    if not settings.runs_web_server:
        logger.error("Web process started with BRIEFLY_PROCESS_ROLE=worker — use workers.runner instead")
        raise RuntimeError("Invalid process role for web server")

    try:
        await init_db()
    except Exception:
        logger.exception("Database startup failed — check DATABASE_URL and Supabase SSL/password")
        raise

    validate_embedding_configuration()

    try:
        from briefly_api.services.digest_failure import reschedule_stuck_failures

        await reschedule_stuck_failures()
    except Exception:
        logger.warning("Could not reschedule stuck failures — non-fatal", exc_info=True)

    if settings.telegram_enabled and settings.api_public_url:
        try:
            from briefly_api.services.telegram import register_webhook

            await register_webhook()
        except Exception:
            logger.warning("Could not register Telegram webhook — non-fatal", exc_info=True)

    background_tasks: list[asyncio.Task] = []
    smtp_controller = None

    # Dev convenience: single process runs workers inline when process_role=all
    if settings.process_role == "all":
        from briefly_api.services.background_jobs import background_job_loop, ensure_job_handlers
        from briefly_api.workers.enrichment_worker import continuous_enrichment_loop
        from briefly_api.workers.scheduler import digest_scheduler_loop

        ensure_job_handlers()
        background_tasks.append(asyncio.create_task(digest_scheduler_loop()))
        if settings.enrichment_worker_enabled:
            background_tasks.append(asyncio.create_task(continuous_enrichment_loop()))
        background_tasks.append(asyncio.create_task(background_job_loop()))
        logger.info("Digest scheduler + enrichment + jobs started (all-in-one dev mode)")

        if settings.smtp_ingestion_active:
            smtp_controller = start_smtp_server(settings)
    else:
        logger.info("Web-only mode — background workers run in separate process")

    yield

    for task in background_tasks:
        task.cancel()
    for task in background_tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass
    if background_tasks:
        logger.info("Background tasks stopped")

    if smtp_controller:
        smtp_controller.stop()
        logger.info("SMTP ingestion server stopped")

    try:
        from briefly_api.api.routes.orb_ws import shutdown_active_orb_turns

        await shutdown_active_orb_turns()
    except Exception:
        logger.warning("Orb turn shutdown failed — non-fatal", exc_info=True)

    try:
        await close_db()
        logger.info("Database pool closed")
    except Exception:
        logger.warning("Database pool close failed — non-fatal", exc_info=True)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(api_router)

    if settings.audio_enabled:
        from pathlib import Path

        Path(settings.audio_storage_path).mkdir(parents=True, exist_ok=True)
        app.mount("/audio", StaticFiles(directory=settings.audio_storage_path), name="audio")

    return app


app = create_app()
