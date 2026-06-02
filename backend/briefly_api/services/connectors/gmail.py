from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.gmail import get_gmail_connection, refresh_gmail_access_token
from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.connectors.base import BaseConnector, ConnectorValidation
from briefly_api.services.connectors.types import GMAIL
from briefly_api.services.gmail import fetch_newsletters

log = logging.getLogger(__name__)


class GmailConnector(BaseConnector):
    source_type = GMAIL
    label = "Gmail newsletters"
    detect_hint = "We'll read newsletter emails from your inbox automatically."

    def normalize_identifier(self, identifier: str) -> str:
        return identifier.strip().lower()

    def can_handle(self, identifier: str) -> bool:
        return False  # Gmail is connected via OAuth, not pasted input

    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
        db: AsyncSession | None = None,
    ) -> list[NormalizedContent]:
        if not db or not meta or not meta.get("user_id"):
            raise ValueError("Gmail source requires an authenticated user connection.")

        connection = await get_gmail_connection(db, meta["user_id"])
        if not connection:
            raise ValueError("Gmail is not connected. Connect Gmail in onboarding or settings.")

        access_token = await refresh_gmail_access_token(connection, settings)
        await db.commit()
        return await fetch_newsletters(access_token, limit=limit)

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        return ConnectorValidation(valid=True)
