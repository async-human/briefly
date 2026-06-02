"""Tests for live_content_pool upsert behavior."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from briefly_api.agents.context import RawItem
from briefly_api.db.models import ContentStatus, RawContent
from briefly_api.services.live_content_pool import persist_live_raw_items


def _make_item(
    *,
    item_id: str | None = None,
    source_id: str = "source-1",
    content_hash: str = "abc123",
    title: str = "Test",
) -> RawItem:
    return RawItem(
        id=item_id or str(uuid.uuid4()),
        source_id=source_id,
        source_type="email",
        source_name="Medium",
        title=title,
        url="https://example.com",
        author="author",
        published_at=datetime.now(timezone.utc),
        clean_text=title,
        content_hash=content_hash,
        summary=title,
        meta={"from_pool": False},
    )


def test_persist_reuses_existing_row_by_content_hash():
    async def run() -> None:
        existing_id = str(uuid.uuid4())
        existing_row = RawContent(
            id=existing_id,
            source_id="source-1",
            user_id="user-1",
            status=ContentStatus.pending,
            title="Old",
            content_hash="abc123",
            clean_text="Old",
        )

        session = AsyncMock()
        session.get = AsyncMock(return_value=None)

        scalar_result = MagicMock()
        scalar_result.scalar_one_or_none.return_value = existing_row
        session.execute = AsyncMock(return_value=scalar_result)
        session.flush = AsyncMock()
        session.rollback = AsyncMock()

        item = _make_item(content_hash="abc123")
        new_id = item.id

        await persist_live_raw_items(session, "user-1", [item])

        assert item.id == existing_id
        assert item.id != new_id
        assert existing_row.title == "Test"
        session.add.assert_not_called()
        session.flush.assert_awaited_once()

    asyncio.run(run())


def test_persist_skips_pool_items():
    async def run() -> None:
        session = AsyncMock()
        pool_item = _make_item()
        pool_item.meta["from_pool"] = True

        await persist_live_raw_items(session, "user-1", [pool_item])

        session.get.assert_not_awaited()
        session.add.assert_not_called()
        session.flush.assert_not_awaited()

    asyncio.run(run())
