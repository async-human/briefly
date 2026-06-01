from __future__ import annotations

import logging
import re

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.gmail import get_gmail_connection, refresh_gmail_access_token
from briefly_api.config import Settings
from briefly_api.db.models import ContentStatus, RawContent
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import EMAIL
from briefly_api.services.gmail import fetch_newsletters_from_sender
from briefly_api.services.medium_extractor import detect_medium_digest
from briefly_api.services.medium_ingestion import expand_medium_digest_items

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
        user_id: str | None = (meta or {}).get("user_id")
        normalized = self.normalize_identifier(identifier)

        # 1) Forwarded mail ingested into the content pool
        if source_id:
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
            if rows:
                await db.execute(
                    update(RawContent)
                    .where(RawContent.id.in_([r.id for r in rows]))
                    .values(status=ContentStatus.processed)
                )
                log.info("EmailConnector: consumed %d forwarded item(s) from %s", len(rows), identifier)
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

        # 2) Gmail discovery sources — pull live from the user's inbox by sender
        if user_id:
            connection = await get_gmail_connection(db, user_id)
            if connection:
                try:
                    access_token = await refresh_gmail_access_token(connection, settings)
                    await db.commit()
                    items = await fetch_newsletters_from_sender(
                        access_token, normalized, limit=limit,
                    )
                    if items:
                        label = source_name or identifier
                        for item in items:
                            item.source_name = label
                            item.source_type = EMAIL
                            raw_html = item.meta.get("raw_html", "")
                            if detect_medium_digest(raw_html, item.author or normalized):
                                item.meta["is_medium_digest"] = True
                                if raw_html:
                                    item.meta["raw_html"] = raw_html
                        items = await expand_medium_digest_items(
                            items,
                            source_name=label,
                            per_digest_limit=6,
                        )
                        log.info(
                            "EmailConnector: fetched %d item(s) from %s after Medium expansion",
                            len(items), normalized,
                        )
                        return items
                except Exception as exc:
                    log.warning("EmailConnector: Gmail fetch failed for %s: %s", normalized, exc)

        return []

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        normalized = self.normalize_identifier(identifier)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            return ConnectorValidation(valid=False, message="Enter a valid email address.")
        return ConnectorValidation(valid=True, suggested_name=normalized)
