from __future__ import annotations

import json
import logging
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from briefly_api.config import Settings
from briefly_api.db.models import Digest, DigestItem, DigestStatus, Source, SourceType, User
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.rss import FetchedArticle, fetch_rss_articles

log = logging.getLogger(__name__)


def _llm_available(settings: Settings) -> bool:
    if settings.llm_provider == "anthropic":
        return bool(settings.anthropic_api_key)
    if settings.llm_provider == "openai":
        return bool(settings.openai_api_key)
    if settings.llm_provider == "groq":
        return bool(settings.groq_api_key)
    return False


async def _collect_articles(sources: list[Source], max_items: int) -> list[FetchedArticle]:
    articles: list[FetchedArticle] = []
    rss_sources = [s for s in sources if s.source_type == SourceType.rss]

    if not rss_sources:
        return articles

    per_source = max(2, max_items // len(rss_sources))
    for source in rss_sources:
        try:
            fetched = await fetch_rss_articles(source.identifier, limit=per_source)
            for item in fetched:
                if source.name:
                    item.source_name = source.name
            articles.extend(fetched)
        except Exception:
            log.exception("Failed to fetch RSS: %s", source.identifier)

    return articles[:max_items]


def _fallback_items(articles: list[FetchedArticle]) -> list[dict]:
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
            "section": "Your feeds",
        }
        for a in articles
    ]


async def _personalize_items(
    articles: list[FetchedArticle],
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
        }
        for a in articles
    ]
    user_name = user.name or "the user"
    user_email = user.email

    prompt = f"""Write a personal morning briefing for {user_name} ({user_email}).

For each article below, return JSON array with objects:
- headline (sharp, specific)
- summary (max 2 sentences, factual)
- why_it_matters (1-2 sentences, why THIS person should care — reference their interests if plausible)
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
) -> Digest:
    result = await db.execute(
        select(Source).where(Source.user_id == user.id).order_by(Source.created_at.desc())
    )
    sources = list(result.scalars().all())

    rss_sources = [s for s in sources if s.source_type == SourceType.rss]
    if not rss_sources:
        raise ValueError("Add at least one RSS feed source to generate a briefing.")

    articles = await _collect_articles(sources, max_items)
    if not articles:
        raise ValueError("Could not fetch any articles from your RSS feeds. Check the URLs.")

    items_data = await _personalize_items(articles, user, settings)
    today = date.today().isoformat()

    existing = await db.execute(
        select(Digest).where(Digest.user_id == user.id, Digest.digest_date == today)
    )
    old_digest = existing.scalar_one_or_none()
    if old_digest:
        await db.delete(old_digest)
        await db.flush()

    digest = Digest(
        user_id=user.id,
        digest_date=today,
        status=DigestStatus.ready,
        subject_line=f"Your briefing — {today}",
        preview_text=items_data[0]["headline"] if items_data else "Your briefing is ready",
        total_items_ingested=len(articles),
        total_items_scored=len(articles),
        total_items_shown=len(items_data),
    )
    db.add(digest)
    await db.flush()

    for i, item in enumerate(items_data):
        db.add(
            DigestItem(
                digest_id=digest.id,
                position=i + 1,
                section=item.get("section"),
                headline=item["headline"],
                summary=item.get("summary", ""),
                why_it_matters=item["why_it_matters"],
                source_name=item.get("source_name"),
                source_url=item.get("source_url"),
            )
        )

    await db.commit()

    result = await db.execute(
        select(Digest)
        .options(selectinload(Digest.items))
        .where(Digest.id == digest.id)
    )
    return result.scalar_one()
