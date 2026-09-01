"""Decision Threads — persistent questions, beliefs, and confidence movement.

Sprint 5 moat object. Confidence is Laplace-smoothed from supporting vs
contradicting evidence. It is never invented.
"""
from __future__ import annotations

import logging
import re
import uuid
from typing import TYPE_CHECKING, Any

from briefly_api.services.operating_context import normalize_operating_context, question_matches_text

if TYPE_CHECKING:
    from briefly_api.db.models import DecisionThread

log = logging.getLogger(__name__)
_MAX_THREADS = 5
_STATUSES = {"open", "reconsider", "resolved", "paused"}

_LEAD = re.compile(
    r"^(should|can|could|do|does|is|are|will|how|what|when|why)\s+(we|i|our|the)?\s*",
    re.I,
)
_TIME_WORDS = {"this", "that", "the", "our", "a", "an", "quarter", "year", "month", "now", "currently"}


def title_from_question(question: str) -> str:
    raw = " ".join((question or "").strip().rstrip("?").split())
    stripped = _LEAD.sub("", raw).strip() or raw
    words = [w for w in stripped.split() if w.lower() not in _TIME_WORDS]
    label = " ".join(words[:4]) or stripped or "Decision"
    return label[:48].rstrip(" ,.")


def thread_matches_text(question: str, blob: str) -> bool:
    return question_matches_text(question, blob)


def thread_matches_signal(thread: Any, blob: str) -> bool:
    """Match a signal to threads by question, title, or stated belief."""
    if thread_matches_text(thread.question, blob):
        return True
    title = (thread.title or "").strip()
    if len(title) >= 4 and title.lower() in blob.lower():
        return True
    belief = (thread.current_belief or "").strip()
    if len(belief) >= 12:
        snippet = belief.lower()[: min(48, len(belief))]
        if snippet in blob.lower():
            return True
    return False


def stance_for_signal(
    *,
    current_belief: str = "",
    explicit_stance: str | None = None,
) -> str:
    """Return a directional stance only when another component verified it.

    A market state changing is not, by itself, evidence against a founder's
    belief. Until a grounded comparison exists, the honest stance is related.
    """
    if not (current_belief or "").strip():
        return "related"
    cleaned = (explicit_stance or "").strip().lower()
    return cleaned if cleaned in {"supporting", "contradicting"} else "related"


def confidence_from_counts(supporting: int, contradicting: int) -> float | None:
    """Laplace-smoothed P(belief still holds). None until directional evidence exists."""
    if supporting < 0 or contradicting < 0:
        return None
    if supporting + contradicting == 0:
        return None
    return round((supporting + 1) / (supporting + contradicting + 2), 2)


def snapshot_dict(thread: Any, *, stance: str | None = None) -> dict[str, Any]:
    return {
        "thread_id": thread.id,
        "title": thread.title,
        "question": thread.question,
        "belief": (thread.current_belief or "").strip() or None,
        "confidence": thread.confidence,
        "previous_confidence": thread.previous_confidence,
        "status": thread.status,
        "source": thread.source,
        "stance": stance,
    }


def digest_fields(snap: dict[str, Any] | None) -> dict[str, Any]:
    """Optional digest/alert fields. Empty dict when the signal is not on a thread."""
    if not snap:
        return {}
    return {
        "decision_thread_id": snap.get("thread_id"),
        "decision_title": snap.get("title"),
        "decision_belief": snap.get("belief"),
        "decision_confidence": snap.get("confidence"),
        "decision_previous_confidence": snap.get("previous_confidence"),
        "decision_status": snap.get("status"),
        "decision_stance": snap.get("stance"),
    }


async def seed_decision_threads_from_context(
    session,
    user_id: str,
    ctx: dict[str, Any] | None,
) -> int:
    """Create an open thread per strategic question. Idempotent on question text."""
    from sqlalchemy import select

    from briefly_api.db.models import DecisionThread

    data = normalize_operating_context(ctx or {})
    questions = data.get("strategic_questions") or []
    if not questions:
        return 0
    existing = (
        await session.execute(
            select(DecisionThread).where(DecisionThread.user_id == user_id)
        )
    ).scalars().all()
    have = {t.question.strip().lower() for t in existing}
    created = 0
    if len(existing) >= _MAX_THREADS:
        return 0
    for question in questions:
        if len(existing) + created >= _MAX_THREADS:
            break
        key = question.strip().lower()
        if key in have:
            continue
        thread = DecisionThread(
            id=str(uuid.uuid4()),
            user_id=user_id,
            title=title_from_question(question),
            question=question.strip()[:500],
            current_belief="",
            confidence=None,
            previous_confidence=None,
            status="open",
            source="onboarding",
        )
        session.add(thread)
        have.add(key)
        created += 1
    return created


async def link_signal_to_threads(
    session,
    *,
    user_id: str,
    signal_id: str,
    blob: str,
    previous_state: str = "",
    new_state: str = "",
    is_contradictory: bool = False,
    explicit_stance: str | None = None,
) -> list[str]:
    """Attach a signal to matching open threads and refresh confidence."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy import select

    from briefly_api.db.models import DecisionThread, ThreadSignal

    threads = (
        await session.execute(
            select(DecisionThread).where(
                DecisionThread.user_id == user_id,
                DecisionThread.status.in_(("open", "reconsider")),
            )
        )
    ).scalars().all()
    if not threads:
        return []
    linked: list[str] = []
    for thread in threads:
        if not thread_matches_signal(thread, blob):
            continue
        stance = stance_for_signal(
            current_belief=thread.current_belief or "",
            explicit_stance=("contradicting" if is_contradictory else explicit_stance),
        )
        stmt = (
            pg_insert(ThreadSignal)
            .values(
                id=str(uuid.uuid4()),
                thread_id=thread.id,
                signal_id=signal_id,
                stance=stance,
            )
            .on_conflict_do_nothing(index_elements=["thread_id", "signal_id"])
            .returning(ThreadSignal.id)
        )
        inserted = (await session.execute(stmt)).scalar_one_or_none()
        if not inserted:
            continue
        linked.append(thread.id)

        final_stance = stance
        assessment_note = f"{stance} evidence linked"
        try:
            from briefly_api.services.decisions.belief_assessor import (
                assess_and_store,
                directional_stance,
            )

            result = await assess_and_store(session, thread=thread, signal_id=signal_id)
            if result:
                verified = directional_stance(result)
                if verified and verified != stance:
                    from sqlalchemy import update as sql_update

                    await session.execute(
                        sql_update(ThreadSignal)
                        .where(
                            ThreadSignal.thread_id == thread.id,
                            ThreadSignal.signal_id == signal_id,
                        )
                        .values(stance=verified)
                    )
                    final_stance = verified
                    assessment_note = (result.rationale or assessment_note)[:400]
        except Exception:
            log.exception(
                "Belief assessment failed for thread=%s signal=%s",
                thread.id,
                signal_id,
            )

        if final_stance in {"supporting", "contradicting"}:
            await _refresh_thread_confidence(
                session,
                thread,
                signal_id=signal_id,
                note=assessment_note,
            )
    return linked


async def _refresh_thread_confidence(
    session,
    thread: DecisionThread,
    *,
    signal_id: str | None,
    note: str,
) -> None:
    from sqlalchemy import func, select

    from briefly_api.db.models import ThreadSignal, ThreadUpdate

    rows = (
        await session.execute(
            select(ThreadSignal.stance, func.count())
            .where(ThreadSignal.thread_id == thread.id)
            .group_by(ThreadSignal.stance)
        )
    ).all()
    counts = {stance: int(n) for stance, n in rows}
    supporting = counts.get("supporting", 0)
    contradicting = counts.get("contradicting", 0)
    new_conf = confidence_from_counts(supporting, contradicting)
    old_conf = thread.confidence
    if new_conf == old_conf:
        return
    thread.previous_confidence = old_conf
    thread.confidence = new_conf
    if contradicting > supporting:
        thread.status = "reconsider"
    elif thread.status == "reconsider" and supporting >= contradicting:
        thread.status = "open"
    session.add(
        ThreadUpdate(
            id=str(uuid.uuid4()),
            thread_id=thread.id,
            belief=thread.current_belief or "",
            confidence=new_conf,
            previous_confidence=old_conf,
            note=note[:400],
            signal_id=signal_id,
        )
    )


async def snapshots_for_signals(
    session,
    user_id: str,
    signal_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """Map signal_id → the strongest matching thread snapshot for that user."""
    from sqlalchemy import select

    from briefly_api.db.models import DecisionThread, ThreadSignal

    if not signal_ids:
        return {}
    rows = (
        await session.execute(
            select(ThreadSignal, DecisionThread)
            .join(DecisionThread, DecisionThread.id == ThreadSignal.thread_id)
            .where(
                ThreadSignal.signal_id.in_(signal_ids),
                DecisionThread.user_id == user_id,
            )
            .order_by(DecisionThread.updated_at.desc())
        )
    ).all()
    ranked: dict[str, tuple[int, dict[str, Any]]] = {}
    for link, thread in rows:
        score = 2 if link.stance == "contradicting" else 1 if thread.status == "reconsider" else 0
        prev = ranked.get(link.signal_id)
        if prev is None or score > prev[0]:
            ranked[link.signal_id] = (score, snapshot_dict(thread, stance=link.stance))
    return {signal_id: snap for signal_id, (_score, snap) in ranked.items()}


async def list_threads(session, user_id: str) -> list[Any]:
    from sqlalchemy import select

    from briefly_api.db.models import DecisionThread

    return (
        await session.execute(
            select(DecisionThread)
            .where(DecisionThread.user_id == user_id)
            .order_by(DecisionThread.updated_at.desc())
        )
    ).scalars().all()


async def get_thread(session, user_id: str, thread_id: str) -> Any:
    from sqlalchemy import select

    from briefly_api.db.models import DecisionThread

    return (
        await session.execute(
            select(DecisionThread).where(
                DecisionThread.id == thread_id,
                DecisionThread.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def create_thread(
    session,
    user_id: str,
    question: str,
    *,
    belief: str = "",
    source: str = "user",
) -> Any:
    from sqlalchemy.exc import IntegrityError

    from briefly_api.db.models import DecisionThread

    q = " ".join((question or "").split())[:500]
    if len(q) < 8:
        raise ValueError("Question is too short.")
    existing = await list_threads(session, user_id)
    key = q.lower()
    for thread in existing:
        if thread.question.strip().lower() == key:
            return thread
    open_count = sum(1 for t in existing if t.status in ("open", "reconsider"))
    if open_count >= _MAX_THREADS:
        raise ValueError("You already have five open decision threads.")
    thread = DecisionThread(
        id=str(uuid.uuid4()),
        user_id=user_id,
        title=title_from_question(q),
        question=q,
        current_belief=(belief or "").strip()[:800],
        confidence=None,
        previous_confidence=None,
        status="open",
        source=source if source in ("onboarding", "user", "inferred") else "user",
    )
    try:
        async with session.begin_nested():
            session.add(thread)
            await session.flush()
    except IntegrityError:
        existing = await list_threads(session, user_id)
        for row in existing:
            if row.question.strip().lower() == key:
                return row
        raise
    return thread


async def update_thread(
    session,
    user_id: str,
    thread_id: str,
    *,
    belief: str | None = None,
    status: str | None = None,
) -> Any:
    from briefly_api.db.models import ThreadUpdate

    thread = await get_thread(session, user_id, thread_id)
    if not thread:
        return None
    if belief is not None:
        thread.current_belief = belief.strip()[:800]
        session.add(
            ThreadUpdate(
                id=str(uuid.uuid4()),
                thread_id=thread.id,
                belief=thread.current_belief,
                confidence=thread.confidence,
                previous_confidence=thread.previous_confidence,
                note="belief edited",
                signal_id=None,
            )
        )
    if status is not None:
        cleaned = status.strip().lower()
        if cleaned not in _STATUSES:
            raise ValueError("Status must be open, reconsider, resolved, or paused.")
        thread.status = cleaned
    return thread


def format_threads_for_prompt(threads: list[Any]) -> str:
    if not threads:
        return ""
    lines = ["Active Decision Threads (beliefs to protect or revisit):"]
    for thread in threads[:8]:
        belief = (thread.current_belief or "").strip() or "No stated belief yet"
        conf = (
            f"{round(thread.confidence * 100)}%"
            if isinstance(thread.confidence, (int, float))
            else "unscored"
        )
        extra = ""
        if (
            isinstance(thread.previous_confidence, (int, float))
            and isinstance(thread.confidence, (int, float))
            and thread.previous_confidence != thread.confidence
        ):
            extra = f" (was {round(thread.previous_confidence * 100)}%)"
        lines.append(
            f"- {thread.title}: {thread.question} Belief: {belief}. "
            f"Confidence {conf}{extra}. Status: {thread.status}."
        )
    return "\n".join(lines)
