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
    logger.info("Database initialized")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
