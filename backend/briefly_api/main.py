from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from briefly_api.api.router import api_router
from briefly_api.config import get_settings
from briefly_api.db.engine import init_db
from briefly_api.ingestion.smtp_server import start_smtp_server
from briefly_api.workers.enrichment_worker import continuous_enrichment_loop
from briefly_api.workers.scheduler import digest_scheduler_loop

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_settings = get_settings()
if _settings.sentry_dsn:
    sentry_sdk.init(
        dsn=_settings.sentry_dsn,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        traces_sample_rate=_settings.sentry_traces_sample_rate,
        environment=_settings.app_env,
        send_default_pii=False,
    )
    logger.info("Sentry initialised (env=%s)", _settings.app_env)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        await init_db()
    except Exception:
        logger.exception("Database startup failed — check DATABASE_URL and Supabase SSL/password")
        raise

    try:
        from briefly_api.services.digest_failure import reschedule_stuck_failures
        await reschedule_stuck_failures()
    except Exception:
        logger.warning("Could not reschedule stuck failures — non-fatal", exc_info=True)

    scheduler_task   = asyncio.create_task(digest_scheduler_loop())
    enrichment_task  = asyncio.create_task(continuous_enrichment_loop())
    logger.info("Digest scheduler + enrichment worker started")

    settings = get_settings()
    smtp_controller = start_smtp_server(settings)

    yield

    scheduler_task.cancel()
    enrichment_task.cancel()
    for task in (scheduler_task, enrichment_task):
        try:
            await task
        except asyncio.CancelledError:
            pass
    logger.info("Digest scheduler + enrichment worker stopped")

    if smtp_controller:
        smtp_controller.stop()
        logger.info("SMTP ingestion server stopped")


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
