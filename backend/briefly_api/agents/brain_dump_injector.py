"""
briefly_api/agents/brain_dump_injector.py

Prepends flagged brain dumps to the written digest as a dedicated section.
Runs after BriefingWriterAgent — user's own thoughts don't need re-writing.
"""
from __future__ import annotations

import logging

from briefly_api.agents.context import DigestItemDraft, PipelineContext
from briefly_api.services import brain_dump as brain_dump_service

log = logging.getLogger(__name__)


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Load pending brain dumps and prepend them to ctx.digest_items.
    Stores dump IDs on ctx for marking injected after persist.
    """
    if not ctx.db_session:
        log.warning("BrainDumpInjectorAgent: no DB session on context")
        return ctx

    pending = await brain_dump_service.get_pending_for_morning_brief(
        ctx.db_session, ctx.user.user_id,
    )
    if not pending:
        return ctx

    brain_drafts: list[DigestItemDraft] = []
    for dump in pending:
        brain_drafts.append(
            DigestItemDraft(
                content_id=None,
                position=0,
                section=brain_dump_service.BRAIN_DUMP_SECTION,
                headline=dump.title,
                summary=dump.clean_summary,
                why_it_matters=brain_dump_service.why_it_matters_for_dump(dump),
                source_name=brain_dump_service.BRAIN_DUMP_SOURCE_LABEL,
                source_url=None,
                relevance_score=1.0,
                novelty_score=1.0,
            )
        )

    existing = list(ctx.digest_items)
    ctx.digest_items = brain_drafts + existing
    for pos, draft in enumerate(ctx.digest_items, start=1):
        draft.position = pos

    ctx.total_shown = len(ctx.digest_items)
    ctx.__dict__["injected_brain_dump_ids"] = [d.id for d in pending]

    log.info(
        "BrainDumpInjectorAgent: prepended %d brain dump(s) for user %s",
        len(brain_drafts), ctx.user.user_id,
    )
    return ctx
