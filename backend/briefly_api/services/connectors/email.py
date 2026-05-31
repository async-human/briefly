from __future__ import annotations

import logging
import re

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.config import Settings
from briefly_api.db.models import ContentStatus, RawContent
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import EMAIL

log = logging.getLogger(__name__)


class EmailConnector(BaseConnector):
    source_type = EMAIL
    label = "Email newsletter"
    detect_hint = "Forward mail to your ingestion address — we'll include it in briefings."

    def normalize_identifier(self, identifier: str) -> str:
        return identifier.strip().lower()

    def can_handle(self, identifier: str) -> bool:
        value = identifier.strip()
        return "@" in value and not value.lower().startswith(("http://", "https://"))

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
        db: object | None = None,
    ) -> list[NormalizedContent]:
        if not isinstance(db, AsyncSession):
            return []

        source_id: str | None = (meta or {}).get("source_id")
        if not source_id:
            log.warning("EmailConnector: no source_id in meta for %s", identifier)
            return []

        result = await db.execute(
            select(RawContent)
            .where(
                RawContent.source_id == source_id,
                RawContent.status == ContentStatus.pending,
            )
            .order_by(RawContent.ingested_at.desc())
            .limit(limit)
        )
        rows = result.scalars().all()
        if not rows:
            return []

        # Mark consumed so the same issues don't re-enter the next digest
        await db.execute(
            update(RawContent)
            .where(RawContent.id.in_([r.id for r in rows]))
            .values(status=ContentStatus.processed)
        )
        log.info("EmailConnector: consumed %d newsletter item(s) from %s", len(rows), identifier)

        return [
            NormalizedContent(
                title=row.title or "(no subject)",
                url=row.url,
                source_name=source_name or identifier,
                source_type=EMAIL,
                section="Newsletters",
                author=identifier,
                published_at=row.ingested_at,
                clean_text=row.raw_text or "",
                summary=row.summary or "",
                meta={"sender": identifier, **(row.meta or {})},
            )
            for row in rows
        ]

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        normalized = self.normalize_identifier(identifier)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            return ConnectorValidation(valid=False, message="Enter a valid email address.")
        return ConnectorValidation(valid=True, suggested_name=normalized)
