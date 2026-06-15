from __future__ import annotations

import logging
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from briefly_api.config import get_settings
from briefly_api.db.models import Base

logger = logging.getLogger(__name__)
_settings = get_settings()


def _connect_args(database_url: str) -> dict:
    """Supabase (and most hosted Postgres) require SSL from Railway."""
    if "supabase" in database_url or "sslmode=require" in database_url:
        return {"ssl": "require"}
    return {}


engine = create_async_engine(
    _settings.database_url,
    echo=_settings.app_env == "development",
    connect_args=_connect_args(_settings.database_url),
    # Sized for web requests + scheduler + enrichment worker sharing one process.
    # pre_ping recovers from hosted-Postgres idle disconnects (Supabase/Railway);
    # recycle keeps connections younger than typical LB idle timeouts.
    pool_size=_settings.db_pool_size,
    max_overflow=_settings.db_max_overflow,
    pool_timeout=30,
    pool_pre_ping=True,
    pool_recycle=1800,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db() -> None:
    async with engine.begin() as conn:
        try:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception as exc:
            logger.warning("vector extension: %s (enable it in Supabase SQL Editor if missing)", exc)
        await conn.run_sync(Base.metadata.create_all)
        # Migrate source_type from Postgres enum to varchar (existing deployments).
        try:
            await conn.execute(
                text("""
                    DO $$
                    BEGIN
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'sources'
                              AND column_name = 'source_type'
                              AND udt_name = 'sourcetype'
                        ) THEN
                            ALTER TABLE sources
                                ALTER COLUMN source_type TYPE VARCHAR(50)
                                USING source_type::text;
                        END IF;
                    END $$;
                """)
            )
        except Exception as exc:
            logger.warning("source_type migration: %s", exc)
        try:
            await conn.execute(
                text("""
                    ALTER TABLE user_profiles
                    ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE
                """)
            )
        except Exception as exc:
            logger.warning("onboarding_completed migration: %s", exc)
        try:
            await conn.execute(
                text("""
                    ALTER TABLE digests
                    ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb
                """)
            )
        except Exception as exc:
            logger.warning("digest.meta migration: %s", exc)
        for stmt in (
            "ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS contradiction_flag BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS contradiction_explanation TEXT",
        ):
            try:
                await conn.execute(text(stmt))
            except Exception as exc:
                logger.warning("digest_items intelligence migration: %s", exc)
        try:
            await conn.execute(
                text("""
                    ALTER TABLE user_profiles
                    ADD COLUMN IF NOT EXISTS suggested_sources JSONB DEFAULT '[]'::jsonb
                """)
            )
        except Exception as exc:
            logger.warning("suggested_sources migration: %s", exc)
        for stmt in (
            "ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS score_breakdown JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS brief_style VARCHAR(32) DEFAULT 'analyst'",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS brief_language VARCHAR(8) DEFAULT 'en'",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS profile_meta JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS ingest_time VARCHAR(5) DEFAULT '03:00'",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS auto_expand_sources BOOLEAN DEFAULT FALSE",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_ingestion_at TIMESTAMPTZ",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS ingestion_meta JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS source_weights JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS source_topic_weights JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS activity_feed JSONB DEFAULT '[]'::jsonb",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS pending_source_discoveries JSONB DEFAULT '[]'::jsonb",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS sources_discovery_confirmed_at TIMESTAMPTZ",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS discovery_last_run_at TIMESTAMPTZ",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS discovery_meta JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS discovered_articles JSONB DEFAULT '[]'::jsonb",
            "ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS discovered_articles_at TIMESTAMPTZ",
        ):
            try:
                await conn.execute(text(stmt))
            except Exception as exc:
                logger.warning("profile migration: %s", exc)
        # Columns added to pre-existing tables by migrations 006/007 that the
        # legacy create_all() + alembic-stamp path can skip (see ensure_migrations).
        for stmt in (
            "ALTER TABLE behavioral_fingerprints ADD COLUMN IF NOT EXISTS weekly_snapshot JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE follow_up_threads ADD COLUMN IF NOT EXISTS content_id VARCHAR(36)",
            "CREATE INDEX IF NOT EXISTS ix_follow_up_threads_content_id ON follow_up_threads (content_id)",
        ):
            try:
                await conn.execute(text(stmt))
            except Exception as exc:
                logger.warning("cross-table migration: %s", exc)
        try:
            await conn.execute(text("""
                UPDATE user_profiles
                SET sources_discovery_confirmed_at = NOW()
                WHERE sources_discovery_confirmed_at IS NULL
                  AND onboarding_completed = TRUE
                  AND EXISTS (
                    SELECT 1 FROM sources WHERE sources.user_id = user_profiles.user_id LIMIT 1
                  )
            """))
        except Exception as exc:
            logger.warning("discovery backfill: %s", exc)
    logger.info("Database initialized (run `alembic upgrade head` for versioned migrations)")
    await verify_schema_columns()


async def verify_schema_columns() -> None:
    """
    Compare every ORM-mapped column against the live database and log any drift.

    Non-fatal by design: a missing column is logged at ERROR (so it surfaces in
    Sentry/Railway logs at boot) rather than 500-ing every request that touches
    the table. This is the early-warning twin of the ADD COLUMN IF NOT EXISTS
    block above — if a future migration adds a column to an existing table and
    nobody updates that block, this turns a silent production outage into a loud
    startup log line.
    """
    from sqlalchemy import inspect as sa_inspect

    def _collect(sync_conn) -> list[str]:
        insp = sa_inspect(sync_conn)
        existing_tables = set(insp.get_table_names())
        drift: list[str] = []
        for table_name, table in Base.metadata.tables.items():
            if table_name not in existing_tables:
                drift.append(f"table '{table_name}' missing entirely")
                continue
            db_cols = {c["name"] for c in insp.get_columns(table_name)}
            for col in table.columns:
                if col.name not in db_cols:
                    drift.append(f"{table_name}.{col.name}")
        return drift

    try:
        async with engine.connect() as conn:
            drift = await conn.run_sync(_collect)
    except Exception as exc:
        logger.warning("Schema verification skipped (%s)", exc)
        return

    if drift:
        logger.error(
            "SCHEMA DRIFT DETECTED — %d ORM column(s)/table(s) missing from the database: %s. "
            "Add them to the init_db() ADD COLUMN IF NOT EXISTS block (db/engine.py) "
            "or run the pending migrations.",
            len(drift),
            ", ".join(sorted(drift)),
        )
    else:
        logger.info("Schema check OK — all ORM columns present in the database")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


def get_session_factory():
    """Return the async session factory (used by the pipeline orchestrator)."""
    return SessionLocal
