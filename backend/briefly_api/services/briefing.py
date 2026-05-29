from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.config import Settings
from briefly_api.db.models import Digest, DigestItem, DigestStatus, Source, User
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.articles import NormalizedContent
from briefly_api.services.collector import collect_from_sources
from briefly_api.services.connectors.types import FETCHABLE_SOURCE_TYPES

log = logging.getLogger(__name__)


def _llm_available(settings: Settings) -> bool:
    if settings.llm_provider == "anthropic":
        return bool(settings.anthropic_api_key)
    if settings.llm_provider == "openai":
        return bool(settings.openai_api_key)
    if settings.llm_provider == "groq":
        return bool(settings.groq_api_key)
    return False


def _fallback_items(articles: list[NormalizedContent]) -> list[dict]:
    return [
        {
            "headline": a.title,
            "summary": a.summary[:300],
            "why_it_matters": (
                f"This appeared in {a.source_name}, one of your subscribed sources. "
                "Worth a read to stay current on what you follow."
            ),
            "source_name": a.source_name,
            "source_url": a.url,
            "section": a.section,
        }
        for a in articles
    ]


async def _personalize_items(
    articles: list[NormalizedContent],
    user: User,
    settings: Settings,
) -> list[dict]:
    if not _llm_available(settings):
        return _fallback_items(articles)

    payload = [
        {
            "title": a.title,
            "summary": a.summary[:300],
            "source": a.source_name,
            "url": a.url,
            "type": a.source_type,
        }
        for a in articles
    ]
    user_name = user.name or "the user"
    user_email = user.email

    prompt = f"""Write a personal morning briefing for {user_name} ({user_email}).

For each article below, return JSON array with objects:
- headline (sharp, specific)
- summary (max 2 sentences, factual)
- why_it_matters (1-2 sentences, why THIS person should care)
- source_name
- source_url
- section (short topic label)

Articles:
{json.dumps(payload, indent=2)}

Return ONLY a JSON array, no markdown."""

    adapter = get_llm_adapter(settings)
    response = await adapter.complete(
        [Message(role="user", content=prompt)],
        system="You are Briefly, a personal briefing agent. Return valid JSON only.",
        temperature=0.4,
        max_tokens=3000,
    )

    try:
        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
        parsed = json.loads(content)
        if isinstance(parsed, list) and len(parsed) == len(articles):
            return parsed
    except (json.JSONDecodeError, IndexError):
        log.warning("LLM returned invalid JSON, using fallback copy")

    return _fallback_items(articles)


async def generate_briefing_now(
    user: User,
    db: AsyncSession,
    settings: Settings,
    *,
    max_items: int = 8,
) -> tuple[Digest, list[str]]:
    result = await db.execute(
        select(Source).where(Source.user_id == user.id).order_by(Source.created_at.desc())
    )
    sources = list(result.scalars().all())

    fetchable = [s for s in sources if s.source_type in FETCHABLE_SOURCE_TYPES]
    if not fetchable:
        raise ValueError(
            "Add at least one source (RSS, YouTube, Reddit, or website URL) to generate a briefing."
        )

    articles, warnings = await collect_from_sources(
        sources, settings, db, user_id=user.id, max_items=max_items
    )
    if not articles:
        detail = "Could not fetch content from your sources."
        if warnings:
            detail = warnings[0] if len(warnings) == 1 else " ".join(warnings)
        else:
            detail += " Check URLs and try again."
        raise ValueError(detail)

    items_data = await _personalize_items(articles, user, settings)
    today = date.today().isoformat()

    existing = await db.execute(
        select(Digest).where(Digest.user_id == user.id, Digest.digest_date == today)
    )
    old_digest = existing.scalar_one_or_none()
    if old_digest:
        await db.delete(old_digest)
        await db.flush()

    preview = items_data[0]["headline"] if items_data else "Your briefing is ready"
    if warnings:
        preview = f"{preview} ({len(warnings)} source note(s))"

    digest = Digest(
        user_id=user.id,
        digest_date=today,
        status=DigestStatus.ready,
        subject_line=f"Your briefing — {today}",
        preview_text=preview,
        total_items_ingested=len(articles),
        total_items_scored=len(articles),
        total_items_shown=len(items_data),
    )
    db.add(digest)
    await db.flush()

    for i, item in enumerate(items_data):
        article = articles[i] if i < len(articles) else None
        db.add(
            DigestItem(
                digest_id=digest.id,
                position=i + 1,
                section=item.get("section") or (article.section if article else None),
                headline=item["headline"],
                summary=item.get("summary", ""),
                why_it_matters=item["why_it_matters"],
                source_name=(article.source_name if article else None) or item.get("source_name"),
                source_url=(article.url if article else None) or item.get("source_url"),
            )
        )

    await db.commit()

    result = await db.execute(
        select(Digest)
        .options(selectinload(Digest.items))
        .where(Digest.id == digest.id)
    )
    digest = result.scalar_one()

    await _send_email(digest, user, items_data, settings)

    return digest, warnings


async def _send_email(
    digest: Digest,
    user: User,
    items_data: list[dict],
    settings: Settings,
) -> None:
    if not settings.resend_api_key:
        return

    from briefly_api.services.email_renderer import render_digest_html
    import resend

    web_url = f"{settings.frontend_url.rstrip('/')}/dashboard"
    html = render_digest_html(
        user_name=user.name,
        digest_date=digest.digest_date,
        items=items_data,
        subject_line=digest.subject_line or f"Your briefing — {digest.digest_date}",
        web_url=web_url,
    )

    resend.api_key = settings.resend_api_key
    try:
        params: resend.Emails.SendParams = {
            "from": f"{settings.digest_from_name} <{settings.digest_from_email}>",
            "to": [user.email],
            "subject": digest.subject_line or f"Your Briefly — {digest.digest_date}",
            "html": html,
        }
        response = await asyncio.to_thread(resend.Emails.send, params)
        message_id = (
            response.get("id") if isinstance(response, dict)
            else getattr(response, "id", None)
        )
        log.info("Email sent to %s (message_id=%s)", user.email, message_id)
    except Exception:
        log.exception("Failed to send digest email to %s", user.email)


async def run_briefing_for_scheduled_user(user_id: str) -> dict:
    """
    Entrypoint for the nightly scheduler: opens its own DB session,
    checks for an existing digest today, generates + emails if missing.
    """
    from briefly_api.db.engine import get_session_factory

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    async with get_session_factory()() as session:
        existing = await session.execute(
            select(Digest).where(
                Digest.user_id == user_id,
                Digest.digest_date == today,
            )
        )
        if existing.scalar_one_or_none():
            log.info("Scheduler: digest already exists for user %s on %s — skipping", user_id, today)
            return {"success": True, "skipped": True}

        result = await session.execute(
            select(User)
            .options(selectinload(User.profile))
            .where(User.id == user_id, User.is_active == True)
        )
        user = result.scalar_one_or_none()
        if not user:
            return {"success": False, "error": "User not found"}

        from briefly_api.config import get_settings
        try:
            digest, warnings = await generate_briefing_now(user, session, get_settings())
            return {
                "success": True,
                "digest_id": digest.id,
                "total_shown": digest.total_items_shown,
                "warnings": warnings,
            }
        except ValueError as exc:
            log.warning("Scheduler: briefing failed for user %s: %s", user_id, exc)
            return {"success": False, "error": str(exc)}
        except Exception:
            log.exception("Scheduler: unhandled error for user %s", user_id)
            return {"success": False, "error": "Unhandled error"}
