"""
briefly_api/agents/content_discovery_injector.py

Injects pre-discovered relevant articles (from outside user subscriptions)
into the digest as "Worth discovering" items.
Runs after BriefingWriterAgent — these are curated picks, not re-written.
"""
from __future__ import annotations

import logging

from briefly_api.agents.context import DigestItemDraft, PipelineContext
from briefly_api.services.digest_sections import SECTION_WORTH_DISCOVERING

log = logging.getLogger(__name__)

_DIGEST_INJECT_LIMIT = 2
_MIN_SCORE = 0.62


async def run(ctx: PipelineContext) -> PipelineContext:
    profile = ctx.user.profile or {}
    cached = profile.get("discovered_articles") or []

    if ctx.db_session:
        stale = True
        refreshed_at = profile.get("discovered_articles_at")
        if refreshed_at and cached:
            from datetime import datetime, timedelta, timezone
            try:
                at = datetime.fromisoformat(refreshed_at.replace("Z", "+00:00"))
                if at.tzinfo is None:
                    at = at.replace(tzinfo=timezone.utc)
                stale = datetime.now(timezone.utc) - at > timedelta(hours=6)
            except Exception:
                stale = True
        if not cached or stale:
            try:
                from briefly_api.services.intelligent_content_discovery import discover_relevant_content
                cached = await discover_relevant_content(
                    ctx.db_session, ctx.user.user_id, force_refresh=stale,
                )
                profile["discovered_articles"] = cached
            except Exception as exc:
                log.warning("ContentDiscoveryInjector: on-demand discovery failed: %s", exc)
    discoveries = [
        a for a in cached
        if float(a.get("relevance_score") or 0) >= _MIN_SCORE
    ][: _DIGEST_INJECT_LIMIT]

    if not discoveries:
        return ctx

    existing_urls = {
        (d.source_url or "").strip().lower()
        for d in ctx.digest_items
        if d.source_url
    }
    existing_titles = {d.headline.strip().lower() for d in ctx.digest_items}

    inject_drafts: list[DigestItemDraft] = []
    for article in discoveries:
        url = (article.get("url") or "").strip()
        title = (article.get("title") or "").strip()
        if not title or not url:
            continue
        if url.lower() in existing_urls:
            continue
        if title.lower() in existing_titles:
            continue

        score = float(article.get("relevance_score") or 0.7)
        inject_drafts.append(
            DigestItemDraft(
                content_id=None,
                position=0,
                section=SECTION_WORTH_DISCOVERING,
                headline=title,
                summary=(article.get("summary") or "")[:500],
                why_it_matters=article.get("why_relevant") or (
                    f"Surfaced because it matches your interests — {int(score * 100)}% relevance."
                ),
                source_name=article.get("source_name") or "Discovered",
                source_url=url,
                relevance_score=score,
                novelty_score=1.0,
                confidence_signal=f"{int(score * 100)}% match · outside your feeds",
            )
        )
        existing_urls.add(url.lower())
        existing_titles.add(title.lower())

    if not inject_drafts:
        return ctx

    ctx.digest_items = list(ctx.digest_items) + inject_drafts
    for pos, draft in enumerate(ctx.digest_items, start=1):
        draft.position = pos
    ctx.total_shown = len(ctx.digest_items)

    log.info(
        "ContentDiscoveryInjector: added %d discover item(s) for user %s",
        len(inject_drafts), ctx.user.user_id,
    )
    return ctx
