"""Claude-backed watch alert copy. Falls back to extractive text if the LLM fails."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from briefly_api.llm.adapter import LLMAdapter, Message
from briefly_api.services.watch.pages import PAGE_SOURCE_TYPES
from briefly_api.services.watch.relevance import WatchHit

log = logging.getLogger(__name__)


@dataclass
class AlertCopy:
    what_changed: str
    why_it_matters: str
    action: str
    is_urgent: bool
    summary: str


_PAGE_KIND = {
    "pricing": "pricing page",
    "docs": "docs page",
    "changelog": "changelog",
}


def _fallback(entity_name: str, hit: WatchHit) -> AlertCopy:
    what = (hit.title or "").strip() or f"New update related to {entity_name}"
    why = (
        f"You're watching {entity_name}, and this is a fresh mention from "
        f"{hit.source_name or 'the open web'}."
    )
    action = "Read the source" if hit.url else "None immediate"
    summary = f"What changed: {what}\nWhy it matters: {why}\nAction: {action}"
    return AlertCopy(what, why, action, hit.is_official, summary)


def _page_copy(entity_name: str, hit: WatchHit) -> AlertCopy:
    kind = _PAGE_KIND.get(hit.source_type, "official page")
    first = next((ln.strip() for ln in (hit.summary or "").splitlines() if ln.strip()), "")
    what = first[:240] or f"{entity_name} {kind} changed"
    why = (
        f"You're watching {entity_name}. This came from their official {kind}, "
        "not a news mention of it."
    )
    action = "Open the official page"
    summary = f"What changed: {what}\nWhy it matters: {why}\nAction: {action}"
    return AlertCopy(what, why, action, True, summary)


async def write_alert_copy(
    entity_name: str,
    entity_kind: str,
    hit: WatchHit,
    *,
    user_id: str | None = None,
) -> AlertCopy:
    if hit.source_type in PAGE_SOURCE_TYPES:
        return _page_copy(entity_name, hit)
    snippet = (hit.summary or "")[:2400]
    try:
        llm = LLMAdapter()
        data = await llm.complete_json(
            [Message(role="user", content=(
                f"You track {entity_kind}: {entity_name}.\n\n"
                f"Title: {hit.title}\n"
                f"Source: {hit.source_name}\n"
                f"URL: {hit.url}\n"
                f"Published: {hit.published_at}\n\n"
                f"Excerpt:\n{snippet}\n\n"
                "Return JSON with keys: what_changed, why_it_matters, action, is_urgent.\n"
                "Each of the first three is one sentence. action may be 'None immediate'.\n"
                "is_urgent is true only for a product launch, model release, outage, "
                "funding, acquisition, or official policy change."
            ))],
            system=(
                "You write terse intelligence alerts for founders. No hype. "
                "No invented facts. Stay inside the excerpt."
            ),
            max_tokens=280,
            user_id=user_id,
            agent="watch_summarizer",
        )
        what = str(data.get("what_changed") or hit.title).strip()
        why = str(data.get("why_it_matters") or "").strip()
        action = str(data.get("action") or "None immediate").strip()
        urgent = bool(data.get("is_urgent"))
        if not why:
            return _fallback(entity_name, hit)
        summary = f"What changed: {what}\nWhy it matters: {why}\nAction: {action}"
        return AlertCopy(what, why, action, urgent or hit.is_official, summary)
    except Exception:
        log.debug("Watch summarizer fallback for %s", entity_name, exc_info=True)
        return _fallback(entity_name, hit)
