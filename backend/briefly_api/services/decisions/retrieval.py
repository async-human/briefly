"""Hybrid retrieval over decision beliefs, evidence, and confirmed outcomes."""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select

_STOP = frozenset({
    "about", "after", "again", "could", "does", "from", "have", "into", "should",
    "that", "their", "there", "these", "this", "what", "when", "where", "which",
    "with", "would", "your", "briefly", "decision", "decisions",
})
_DECISION_INTENT = re.compile(
    r"\b(decid|decision|belief|believe|assumption|reconsider|changed my mind|what did we|why did we|acted on)\b",
    re.I,
)


def terms(text: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9][a-z0-9_-]{2,}", (text or "").lower())
        if token not in _STOP
    }


def thread_relevance(query: str, *, title: str, question: str, belief: str, status: str) -> float:
    wanted = terms(query)
    if not wanted:
        return 0.0
    haystack = terms(f"{title} {question} {belief}")
    overlap = len(wanted & haystack) / max(1, len(wanted))
    phrase = 0.35 if any(token in f"{title} {question}".lower() for token in wanted) else 0.0
    active = 0.1 if status in {"open", "reconsider"} else 0.0
    return round(min(1.0, overlap + phrase + active), 4)


def is_decision_query(query: str) -> bool:
    return bool(_DECISION_INTENT.search(query or ""))


def format_decision_timeline(thread: Any, events: list[dict[str, Any]]) -> str:
    lines = [
        f"Decision question: {thread.question}",
        f"Current belief: {(thread.current_belief or 'not recorded')}",
        f"Status: {thread.status}; confidence: {thread.confidence if thread.confidence is not None else 'not enough directional evidence'}",
    ]
    for event in events[-6:]:
        at = event.get("at")
        date = at.date().isoformat() if hasattr(at, "date") else str(at or "unknown date")
        kind = event.get("type")
        if kind == "signal":
            lines.append(
                f"{date} — evidence ({event.get('stance') or 'related'}): "
                f"{event.get('headline') or event.get('note') or 'signal linked'}"
            )
            if event.get("rationale"):
                lines.append(f"Assessment: {event['rationale']}")
        elif kind == "outcome":
            text = event.get("action") or event.get("note") or ""
            lines.append(f"{date} — founder outcome: {event.get('outcome')}{': ' + text if text else ''}")
        elif event.get("belief"):
            lines.append(f"{date} — belief update: {event['belief']}")
    return "\n".join(lines)[:5000]


async def retrieve_decision_chunks(session, user_id: str, query: str, *, limit: int = 3):
    """Return ContextChunk objects without making decision memory a separate Ask mode."""
    from briefly_api.db.models import DecisionThread
    from briefly_api.services.ask_briefly import ContextChunk
    from briefly_api.services.decisions.timeline import get_thread_timeline

    threads = (
        await session.execute(
            select(DecisionThread)
            .where(DecisionThread.user_id == user_id)
            .order_by(DecisionThread.updated_at.desc())
            .limit(20)
        )
    ).scalars().all()
    scored = [
        (
            thread_relevance(
                query,
                title=t.title or "",
                question=t.question or "",
                belief=t.current_belief or "",
                status=t.status or "",
            ),
            t,
        )
        for t in threads
    ]
    threshold = 0.1 if is_decision_query(query) else 0.25
    selected = [t for score, t in sorted(scored, key=lambda row: row[0], reverse=True) if score >= threshold][:limit]
    chunks: list[ContextChunk] = []
    for thread in selected:
        events = await get_thread_timeline(session, user_id, thread.id, days=365)
        evidence = [e for event in events for e in (event.get("evidence") or []) if e.get("url")]
        source = evidence[-1] if evidence else {}
        chunks.append(
            ContextChunk(
                ref="",
                content_id=f"decision-thread:{thread.id}",
                title=f"Decision history — {thread.title}",
                url=source.get("url"),
                source_name=source.get("source_name") or "Your decision record",
                snippet=format_decision_timeline(thread, events),
                kind="decision_timeline",
            )
        )
    return chunks
