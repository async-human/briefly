"""
Bootstrap Alembic on databases that were created via create_all() (no alembic_version).

On Railway/Supabase the schema often already exists; running upgrade from 001
fails with DuplicateTableError. init_db() may apply 004 columns before Alembic runs.
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
import sys

from sqlalchemy import text

from briefly_api.db.engine import engine

log = logging.getLogger(__name__)

_HEAD = "006"
# Last revision whose objects are already created by Base.metadata.create_all()
_STAMP_IF_LEGACY = "003"


async def _table_exists(name: str) -> bool:
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                """
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = :name
                LIMIT 1
                """
            ),
            {"name": name},
        )
        return result.scalar() is not None


async def _column_exists(table: str, column: str) -> bool:
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = :table
                  AND column_name = :column
                LIMIT 1
                """
            ),
            {"table": table, "column": column},
        )
        return result.scalar() is not None


async def _current_revision() -> str | None:
    if not await _table_exists("alembic_version"):
        return None
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
        return result.scalar()


async def _revision_004_schema_ready() -> bool:
    return await _column_exists("digest_items", "contradiction_flag")


async def _revision_005_schema_ready() -> bool:
    return await _table_exists("background_jobs")


def _run_alembic(*args: str) -> int:
    cmd = [sys.executable, "-m", "alembic", *args]
    log.info("Running: %s", " ".join(cmd))
    return subprocess.call(cmd)


async def ensure_migrations() -> None:
    revision = await _current_revision()

    if revision == _HEAD:
        log.info("Alembic already at head (%s)", _HEAD)
        return

    if revision is None and await _table_exists("users"):
        log.info(
            "Legacy database detected (users table exists, no Alembic revision) — stamping %s",
            _STAMP_IF_LEGACY,
        )
        if _run_alembic("stamp", _STAMP_IF_LEGACY) != 0:
            raise SystemExit(1)
        revision = _STAMP_IF_LEGACY

    if revision == _STAMP_IF_LEGACY and await _revision_005_schema_ready():
        log.info("005 schema already present — stamping head without upgrade")
        if _run_alembic("stamp", _HEAD) != 0:
            raise SystemExit(1)
        return

    if revision == "004" and await _revision_005_schema_ready():
        log.info("005 schema already present — stamping head without upgrade")
        if _run_alembic("stamp", _HEAD) != 0:
            raise SystemExit(1)
        return

    if revision:
        log.info("Alembic at revision %s — upgrading to head", revision)
    else:
        log.info("Fresh database — running all migrations")

    rc = _run_alembic("upgrade", "head")
    if rc != 0:
        if await _revision_005_schema_ready():
            log.warning("upgrade failed but 005 schema is present — stamping head")
            if _run_alembic("stamp", _HEAD) != 0:
                raise SystemExit(1)
            return
        raise SystemExit(rc)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(ensure_migrations())


if __name__ == "__main__":
    main()
