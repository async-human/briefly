"""Translate brief copy when brief_language is not English."""
from __future__ import annotations

import logging
from typing import Any

from briefly_api.agents.context import DigestItemDraft
from briefly_api.llm.adapter import Message, get_llm_adapter

log = logging.getLogger(__name__)


def _has_devanagari(text: str) -> bool:
    return any("\u0900" <= ch <= "\u097F" for ch in (text or ""))


def _needs_hindi(text: str) -> bool:
    return bool((text or "").strip()) and not _has_devanagari(text)


async def localize_digest_to_hindi(
    *,
    subject_line: str,
    preview_text: str,
    drafts: list[DigestItemDraft],
) -> tuple[str, str, list[DigestItemDraft]]:
    """
    Ensure summary + why_it_matters (and brief framing lines) are Hindi.
    Headlines are intentionally left in English.
    """
    if not drafts:
        return subject_line, preview_text, drafts

    needs_work = (
        _needs_hindi(subject_line)
        or _needs_hindi(preview_text)
        or any(_needs_hindi(d.summary) or _needs_hindi(d.why_it_matters) for d in drafts)
    )
    if not needs_work:
        return subject_line, preview_text, drafts

    payload: dict[str, Any] = {
        "subject_line": subject_line,
        "preview_text": preview_text,
        "items": [
            {
                "content_id": d.content_id,
                "summary": d.summary,
                "why_it_matters_to_you": d.why_it_matters,
                "who_it_affects": d.who_it_affects or "",
                "suggested_action": d.suggested_action or "",
                "memory_reference": d.memory_reference or "",
                "confidence_signal": d.confidence_signal or "",
            }
            for d in drafts
        ],
    }

    system = (
        "You translate Briefly digest copy into natural Hindi (Devanagari).\n"
        "Rules:\n"
        "- Translate subject_line, preview_text, summary, why_it_matters_to_you, "
        "who_it_affects, suggested_action, memory_reference, and confidence_signal.\n"
        "- Do NOT translate content_id values.\n"
        "- Keep company names, product names, and URLs in their common form.\n"
        "- Return ONLY valid JSON with the same structure as the input.\n"
    )
    prompt = (
        "Translate the following briefing JSON fields to Hindi (Devanagari):\n"
        f"{payload}"
    )

    try:
        llm = get_llm_adapter()
        result = await llm.complete_json(
            messages=[Message(role="user", content=prompt)],
            system=system,
            max_tokens=2800,
            agent="brief_localization",
        )
    except Exception as exc:
        log.warning("brief_localization: LLM failed (%s) — keeping English copy", exc)
        return subject_line, preview_text, drafts

    if not isinstance(result, dict):
        return subject_line, preview_text, drafts

    subject_line = str(result.get("subject_line") or subject_line)
    preview_text = str(result.get("preview_text") or preview_text)
    by_id = {
        str(row.get("content_id")): row
        for row in (result.get("items") or [])
        if row.get("content_id")
    }
    for draft in drafts:
        row = by_id.get(str(draft.content_id))
        if not row:
            continue
        if row.get("summary"):
            draft.summary = str(row["summary"])
        if row.get("why_it_matters_to_you"):
            draft.why_it_matters = str(row["why_it_matters_to_you"])
        if row.get("who_it_affects"):
            draft.who_it_affects = str(row["who_it_affects"])
        if row.get("suggested_action"):
            draft.suggested_action = str(row["suggested_action"])
        if row.get("memory_reference"):
            draft.memory_reference = str(row["memory_reference"])
        if row.get("confidence_signal"):
            draft.confidence_signal = str(row["confidence_signal"])

    log.info("brief_localization: localized %d items to Hindi", len(by_id))
    return subject_line, preview_text, drafts
