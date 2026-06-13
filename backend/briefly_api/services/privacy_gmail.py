"""
Gmail privacy helpers — access logging, token revocation, and content cleanup.

Briefly's Gmail posture:
- Discovery: metadata-only (see gmail_discovery.py)
- Ingestion: full bodies only for user-approved newsletter senders (email sources)
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from briefly_api.auth.gmail import get_gmail_connection
from briefly_api.config import Settings
from briefly_api.db.models import BillingEvent, OAuthConnection, RawContent, Source, User, UserProfile
from briefly_api.security.oauth_tokens import oauth_refresh_token
from briefly_api.services import dodo_payments

log = logging.getLogger(__name__)

GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
_MAX_ACCESS_LOG = 40


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def revoke_google_token(refresh_token: str | None) -> None:
    """Best-effort revoke of a Google OAuth refresh token."""
    if not refresh_token:
        return
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                GOOGLE_REVOKE_URL,
                params={"token": refresh_token},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if resp.status_code not in {200, 400}:
            log.warning("Google token revoke returned %s", resp.status_code)
    except Exception:
        log.debug("Google token revoke failed", exc_info=True)


async def append_gmail_access_log(
    db: AsyncSession,
    user_id: str,
    action: str,
    detail: str,
    *,
    meta: dict[str, Any] | None = None,
) -> None:
    """Append a user-visible Gmail API access event to the OAuth connection meta."""
    connection = await get_gmail_connection(db, user_id)
    if not connection:
        return

    entry = {
        "at": _now_iso(),
        "action": action,
        "detail": detail,
        **(meta or {}),
    }
    stored = list((connection.meta or {}).get("access_log") or [])
    stored.insert(0, entry)
    connection.meta = {**(connection.meta or {}), "access_log": stored[:_MAX_ACCESS_LOG]}
    flag_modified(connection, "meta")


def list_gmail_access_log(connection: OAuthConnection | None) -> list[dict]:
    if not connection:
        return []
    return list((connection.meta or {}).get("access_log") or [])


def _is_gmail_derived_email_source(source: Source) -> bool:
    if source.source_type != "email":
        return False
    meta = source.meta or {}
    return bool(meta.get("from_gmail"))


async def delete_gmail_derived_data(db: AsyncSession, user_id: str) -> dict[str, int]:
    """
    Remove Gmail OAuth umbrella sources, user-approved Gmail sender sources,
    and any stored newsletter bodies fetched via Gmail (not forwarded mail).
    """
    deleted_sources = 0
    source_ids: list[str] = []

    gmail_sources = await db.execute(
        select(Source).where(Source.user_id == user_id, Source.source_type == "gmail")
    )
    for source in gmail_sources.scalars().all():
        source_ids.append(source.id)
        await db.delete(source)
        deleted_sources += 1

    email_sources = await db.execute(
        select(Source).where(Source.user_id == user_id, Source.source_type == "email")
    )
    for source in email_sources.scalars().all():
        if not _is_gmail_derived_email_source(source):
            continue
        source_ids.append(source.id)
        await db.delete(source)
        deleted_sources += 1

    deleted_content = 0
    if source_ids:
        deleted_content = int(
            await db.scalar(
                select(func.count())
                .select_from(RawContent)
                .where(RawContent.source_id.in_(source_ids))
            )
            or 0
        )

    profile = await db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
    if profile:
        pending = list(profile.pending_source_discoveries or [])
        filtered = [p for p in pending if not (p.get("meta") or {}).get("from_gmail")]
        if len(filtered) != len(pending):
            profile.pending_source_discoveries = filtered
            flag_modified(profile, "pending_source_discoveries")

        discovery_meta = dict(profile.discovery_meta or {})
        if discovery_meta.pop("gmail_scan", None) is not None:
            profile.discovery_meta = discovery_meta
            flag_modified(profile, "discovery_meta")

    return {"sources": deleted_sources, "content_items": deleted_content}


async def disconnect_gmail_privacy(
    db: AsyncSession,
    user_id: str,
    settings: Settings,
    *,
    delete_content: bool = True,
) -> dict[str, int]:
    """Revoke Google token, remove connection, and optionally wipe Gmail-derived content."""
    connection = await get_gmail_connection(db, user_id)
    refresh = oauth_refresh_token(connection) if connection else None

    stats = {"sources": 0, "content_items": 0}
    if delete_content:
        stats = await delete_gmail_derived_data(db, user_id)

    if connection:
        log_entry = {
            "at": _now_iso(),
            "action": "disconnect",
            "detail": "Gmail disconnected"
            + (" — stored newsletter content removed" if delete_content else ""),
            "delete_content": delete_content,
        }
        stored = list((connection.meta or {}).get("access_log") or [])
        stored.insert(0, log_entry)
        connection.meta = {**(connection.meta or {}), "access_log": stored[:_MAX_ACCESS_LOG]}
        flag_modified(connection, "meta")
        await db.delete(connection)

    await db.flush()
    if refresh:
        asyncio.create_task(revoke_google_token(refresh))
    return stats


async def deactivate_user_account(db: AsyncSession, user: User) -> None:
    """Lock the account immediately so the user cannot sign in again."""
    user.is_active = False
    await db.flush()


async def finalize_user_account_deletion(
    db: AsyncSession,
    user_id: str,
    settings: Settings,
    *,
    subscription_id: str | None = None,
    user_email: str | None = None,
) -> None:
    """Hard-delete user data and revoke external access. Runs in a background job."""
    user = await db.get(User, user_id)
    if not user:
        return

    sub_id = (subscription_id or user.ls_subscription_id or "").strip()
    email = user_email or user.email

    if sub_id and settings.dodo_payments_api_key.strip():
        try:
            await dodo_payments.cancel_subscription_for_account_deletion(settings, sub_id)
            db.add(
                BillingEvent(
                    user_id=user.id,
                    event_type="cancel",
                    reason="account_deleted",
                    comment="Subscription cancelled because account was deleted",
                    meta={"subscription_id": sub_id},
                )
            )
            await db.flush()
            log.info("Cancelled Dodo subscription %s for deleted user %s", sub_id, email)
        except Exception:
            log.exception(
                "Failed to cancel Dodo subscription %s for user %s",
                sub_id,
                email,
            )
            raise
    elif sub_id:
        log.warning(
            "User %s has subscription %s but Dodo is not configured — skipping billing cancel",
            email,
            sub_id,
        )

    connections = await db.execute(
        select(OAuthConnection).where(OAuthConnection.user_id == user_id)
    )
    for conn in connections.scalars().all():
        if conn.provider in {"gmail", "google_calendar", "youtube"}:
            refresh = oauth_refresh_token(conn)
            if refresh:
                asyncio.create_task(revoke_google_token(refresh))
        await db.delete(conn)

    await db.delete(user)
    await db.flush()


async def delete_user_account(
    db: AsyncSession,
    user: User,
    settings: Settings,
) -> None:
    """Synchronous hard-delete — used in tests and background cleanup."""
    await finalize_user_account_deletion(
        db,
        user.id,
        settings,
        subscription_id=user.ls_subscription_id,
        user_email=user.email,
    )
