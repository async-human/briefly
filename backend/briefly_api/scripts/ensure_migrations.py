"""
Bootstrap Alembic on databases that were created via create_all() (no alembic_version).

On Railway/Supabase the schema often already exists; running upgrade from 001
fails with DuplicateTableError. This script stamps the last pre-existing revision
then applies only newer migrations (e.g. 004).
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
import sys

from sqlalchemy import text

from briefly_api.db.engine import engine

log = logging.getLogger(__name__)

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


async def _current_revision() -> str | None:
    if not await _table_exists("alembic_version"):
        return None
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
        return result.scalar()


def _run_alembic(*args: str) -> None:
    cmd = [sys.executable, "-m", "alembic", *args]
    log.info("Running: %s", " ".join(cmd))
    rc = subprocess.call(cmd)
    if rc != 0:
        raise SystemExit(rc)


async def ensure_migrations() -> None:
    revision = await _current_revision()
    if revision is None and await _table_exists("users"):
        log.info(
            "Legacy database detected (users table exists, no Alembic revision) — stamping %s",
            _STAMP_IF_LEGACY,
        )
        _run_alembic("stamp", _STAMP_IF_LEGACY)
    elif revision:
        log.info("Alembic at revision %s — upgrading to head", revision)
    else:
        log.info("Fresh database — running all migrations")

    _run_alembic("upgrade", "head")


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(ensure_migrations())


if __name__ == "__main__":
    main()
