"""
briefly_api/agents/browser_capture_injector.py

Injects browser-captured articles into the digest with pre-computed enrichment.
"""
from __future__ import annotations

import logging

from briefly_api.agents.context import DigestItemDraft, PipelineContext
from briefly_api.services import browser_capture as capture_service

log = logging.getLogger(__name__)


async def run(ctx: PipelineContext) -> PipelineContext:
    if not ctx.db_session:
        log.warning("BrowserCaptureInjectorAgent: no DB session on context")
        return ctx

    pending = await capture_service.get_pending_for_morning_brief(
        ctx.db_session, ctx.user.user_id,
    )
    if not pending:
        return ctx

    capture_drafts: list[DigestItemDraft] = []
    capture_ids: list[str] = []

    for row, enrichment in pending:
        capture_drafts.append(
            DigestItemDraft(
                content_id=row.id,
                position=0,
                section=capture_service.BROWSER_CAPTURE_SECTION,
                headline=row.title or "Saved article",
                summary=(row.summary or row.clean_text or "")[:400],
                why_it_matters=capture_service.why_it_matters_for_capture(row, enrichment),
                source_name=capture_service.BROWSER_CAPTURE_SOURCE_LABEL,
                source_url=row.url,
                relevance_score=1.0,
                novelty_score=1.0,
            )
        )
        capture_ids.append(row.id)

    existing = list(ctx.digest_items)
    ctx.digest_items = capture_drafts + existing
    for pos, draft in enumerate(ctx.digest_items, start=1):
        draft.position = pos

    ctx.total_shown = len(ctx.digest_items)
    ctx.__dict__["injected_browser_capture_ids"] = capture_ids

    log.info(
        "BrowserCaptureInjectorAgent: prepended %d capture(s) for user %s",
        len(capture_drafts), ctx.user.user_id,
    )
    return ctx
