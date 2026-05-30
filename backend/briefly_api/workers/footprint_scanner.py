"""
briefly_api/workers/footprint_scanner.py

Zero-friction source discovery — runs nightly, requires no user action.

For every onboarded user with Gmail connected:
  1. Scan inbox *metadata* (From/Subject headers only — no body download).
  2. Identify newsletter senders by frequency.
  3. For each sender not already in the user's sources:
       - Substack publication sub-domain  →  construct RSS URL directly.
       - Any other non-platform domain    →  probe homepage for RSS <link>.
  4. Auto-create RSS Source records (max 5 new per user per run).

The user performs exactly zero actions after Day-1 Gmail OAuth.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from briefly_api.auth.gmail import get_gmail_connection, refresh_gmail_access_token
from briefly_api.config import Settings, get_settings
from briefly_api.db.engine import SessionLocal
from briefly_api.db.models import OAuthConnection, Source, UserProfile
from briefly_api.services.gmail_discovery import discover_newsletter_senders
from briefly_api.services.url_scraper import UrlFetchError, discover_rss_feed

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

# Pure email-platform domains — the sender address tells us nothing about
# where the *publication's* RSS feed lives, so skip them here.
# (Medium is handled separately via digest-email expansion in GmailConnector.)
_PLATFORM_DOMAINS: frozenset[str] = frozenset({
    "substack.com",        # generic @substack.com — can't identify publication
    "beehiiv.com",
    "mailchimp.com",
    "convertkit.com",
    "buttondown.email",
    "ghost.io",
    "mailerlite.com",
    "sendgrid.net",
    "sendgrid.com",
    "campaignmonitor.com",
    "constantcontact.com",
    "klaviyo.com",
    "aweber.com",
    "getresponse.com",
    "tinyletter.com",
    "revue.co",
    "medium.com",
    "gmail.com",
    "googlegroups.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
})

# Hard cap: avoid flooding a user's source list on first run
_MAX_NEW_SOURCES_PER_RUN = 5

# Concurrency limit when probing domains (avoid hammering many sites at once)
_PROBE_CONCURRENCY = 3


# ── Helpers ───────────────────────────────────────────────────────────────────

def _domain_from_email(email: str) -> str:
    return email.split("@")[-1].lower().strip() if "@" in email else ""


def _is_substack_publication(domain: str) -> bool:
    """True for publication-specific subdomains like 'something.substack.com'."""
    parts = domain.split(".")
    return len(parts) == 3 and parts[-2] == "substack" and parts[-1] == "com"


async def _rss_for_sender(sender_email: str) -> str | None:
    """
    Attempt to resolve an RSS feed URL for a newsletter sender.

    Returns the feed URL, or None if undiscoverable / not applicable.
    """
    domain = _domain_from_email(sender_email)
    if not domain:
        return None

    # Substack publication sub-domain: RSS is deterministic, no HTTP probe needed.
    if _is_substack_publication(domain):
        return f"https://{domain}/feed"

    # Skip pure email-platform domains where we can't derive a publication URL.
    if domain in _PLATFORM_DOMAINS:
        return None

    # Probe the sender's domain homepage for an RSS autodiscovery <link>.
    try:
        return await discover_rss_feed(f"https://{domain}")
    except UrlFetchError:
        return None
    except Exception as exc:
        log.debug("footprint_scanner: probe failed for %s — %s", domain, exc)
        return None


# ── Per-user scan ─────────────────────────────────────────────────────────────

async def scan_for_user(
    user_id: str,
    db: AsyncSession,
    settings: Settings,
) -> dict:
    """
    Run the footprint scan for one user.

    Returns stats: {scanned, new_sources_added, errors}.
    """
    stats: dict[str, int] = {"scanned": 0, "new_sources_added": 0, "errors": 0}

    connection = await get_gmail_connection(db, user_id)
    if not connection:
        return stats

    # Refresh the OAuth token (writes new token back to DB)
    try:
        access_token = await refresh_gmail_access_token(connection, settings)
        await db.commit()
    except Exception as exc:
        log.warning("footprint_scanner: token refresh failed for user %s — %s", user_id, exc)
        stats["errors"] += 1
        return stats

    # Load existing source identifiers so we never create duplicates
    existing_rows = await db.execute(
        select(Source.identifier).where(Source.user_id == user_id)
    )
    existing_identifiers: set[str] = {row[0] for row in existing_rows}

    # Discover newsletter senders (metadata-only — no email body downloaded)
    try:
        senders = await discover_newsletter_senders(access_token, already_added=set())
    except Exception as exc:
        log.warning("footprint_scanner: discovery failed for user %s — %s", user_id, exc)
        stats["errors"] += 1
        return stats

    stats["scanned"] = len(senders)

    # Probe senders concurrently, respecting the concurrency cap
    sem = asyncio.Semaphore(_PROBE_CONCURRENCY)

    async def _probe(sender: dict) -> tuple[dict, str | None]:
        async with sem:
            rss = await _rss_for_sender(sender.get("email", ""))
            return sender, rss

    probe_results = await asyncio.gather(*[_probe(s) for s in senders], return_exceptions=True)

    added = 0
    for result in probe_results:
        if added >= _MAX_NEW_SOURCES_PER_RUN:
            break
        if isinstance(result, Exception):
            stats["errors"] += 1
            continue

        sender, rss_url = result
        if not rss_url or rss_url in existing_identifiers:
            continue

        sender_email: str = sender.get("email", "")
        sender_name: str = sender.get("name", "") or _domain_from_email(sender_email)

        try:
            source = Source(
                user_id=user_id,
                source_type="rss",
                identifier=rss_url,
                name=sender_name,
                meta={
                    "auto_discovered": True,
                    "discovery_method": "gmail_footprint",
                    "discovered_from": sender_email,
                    "sender_frequency": sender.get("count", 1),
                },
            )
            db.add(source)
            await db.flush()          # surfaces IntegrityError before commit
            existing_identifiers.add(rss_url)
            added += 1
            log.info(
                "footprint_scanner: auto-added '%s' → %s for user %s",
                sender_name, rss_url, user_id,
            )
        except IntegrityError:
            await db.rollback()       # unique constraint — already exists
        except Exception as exc:
            log.warning("footprint_scanner: could not add %s — %s", rss_url, exc)
            stats["errors"] += 1

    try:
        await db.commit()
    except Exception:
        await db.rollback()

    stats["new_sources_added"] = added
    return stats


# ── Nightly batch entry point ─────────────────────────────────────────────────

async def run_nightly_scan(settings: Settings | None = None) -> None:
    """
    Scan all onboarded users who have Gmail connected.
    Called once per day from the scheduler.
    """
    _settings = settings or get_settings()
    log.info("footprint_scanner: starting nightly scan")

    async with SessionLocal() as db:
        result = await db.execute(
            select(UserProfile.user_id)
            .join(
                OAuthConnection,
                (OAuthConnection.user_id == UserProfile.user_id)
                & (OAuthConnection.provider == "gmail"),
            )
            .where(UserProfile.onboarding_completed == True)  # noqa: E712
        )
        user_ids: list[str] = [row[0] for row in result]

    log.info("footprint_scanner: %d users to scan", len(user_ids))
    total_added = 0

    for user_id in user_ids:
        try:
            async with SessionLocal() as db:
                stats = await scan_for_user(user_id, db, _settings)
                total_added += stats["new_sources_added"]
                if stats["new_sources_added"] or stats["errors"]:
                    log.info(
                        "footprint_scanner: user %s — scanned=%d added=%d errors=%d",
                        user_id,
                        stats["scanned"],
                        stats["new_sources_added"],
                        stats["errors"],
                    )
        except Exception:
            log.exception("footprint_scanner: unhandled error for user %s", user_id)

    log.info(
        "footprint_scanner: done — %d new sources added across %d users",
        total_added, len(user_ids),
    )
