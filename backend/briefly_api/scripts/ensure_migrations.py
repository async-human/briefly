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

_HEAD = "014"
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


async def _revision_005_schema_ready() -> bool:
    return await _table_exists("background_jobs")


async def _head_schema_ready() -> bool:
    return (
        await _column_exists("digest_items", "who_it_affects")
        and await _column_exists("digest_items", "suggested_action")
    )


async def _apply_014_columns() -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text("ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS who_it_affects TEXT")
        )
        await conn.execute(
            text("ALTER TABLE digest_items ADD COLUMN IF NOT EXISTS suggested_action TEXT")
        )
    log.info("Applied digest_items.who_it_affects / suggested_action")


def _run_alembic(*args: str) -> int:
    cmd = [sys.executable, "-m", "alembic", *args]
    log.info("Running: %s", " ".join(cmd))
    return subprocess.call(cmd)


async def ensure_migrations() -> None:
    revision = await _current_revision()

    if revision is None and await _table_exists("users"):
        log.info(
            "Legacy database detected (users table exists, no Alembic revision) — stamping %s",
            _STAMP_IF_LEGACY,
        )
        if _run_alembic("stamp", _STAMP_IF_LEGACY) != 0:
            raise SystemExit(1)
        revision = _STAMP_IF_LEGACY

    # create_all() may have created 005 objects while Alembic was still at 003/004.
    # Stamp 005 only — never jump to HEAD, which skips later ALTER TABLE migrations.
    if revision in (_STAMP_IF_LEGACY, "004") and await _revision_005_schema_ready():
        log.info("005 schema already present — stamping 005, then upgrading")
        if _run_alembic("stamp", "005") != 0:
            raise SystemExit(1)
        revision = "005"

    if revision == _HEAD:
        if await _head_schema_ready():
            log.info("Alembic already at head (%s)", _HEAD)
            return
        log.warning(
            "Alembic is stamped %s but six-point columns are missing — applying them",
            _HEAD,
        )
        await _apply_014_columns()
        return

    if revision:
        log.info("Alembic at revision %s — upgrading to head", revision)
    else:
        log.info("Fresh database — running all migrations")

    rc = _run_alembic("upgrade", "head")
    if rc == 0:
        return

    # DuplicateTableError on 013: table already exists from create_all(). Stamp
    # 013 if needed and retry so 014 can run.
    current = await _current_revision()
    if current in ("012", "013") and await _table_exists("telegram_accounts"):
        if current == "012":
            log.warning("013 objects already exist — stamping 013 and retrying upgrade")
            if _run_alembic("stamp", "013") != 0:
                raise SystemExit(1)
        rc = _run_alembic("upgrade", "head")
        if rc == 0:
            return
        current = await _current_revision()

    if not await _head_schema_ready():
        log.warning("Upgrade failed — applying six-point columns directly")
        await _apply_014_columns()
        if await _head_schema_ready():
            if current in ("013", _HEAD):
                if _run_alembic("stamp", _HEAD) != 0:
                    raise SystemExit(1)
            else:
                log.info(
                    "Six-point columns applied; Alembic remains at %s until 013 can run",
                    current,
                )
            return
        log.error(
            "Alembic upgrade failed (exit %s) and head schema is still incomplete. "
            "init_db() will try ADD COLUMN IF NOT EXISTS on boot.",
            rc,
        )
        return

    if _run_alembic("stamp", _HEAD) != 0:
        raise SystemExit(1)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(ensure_migrations())


if __name__ == "__main__":
    main()
