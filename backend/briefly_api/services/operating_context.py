"""Structured company operating context — Sprint 1 moat asset.

Stored on UserProfile.operating_context. Used by onboarding, settings,
profile embeddings, and the briefing writer so relevance is company-specific
instead of generic topic matching.
"""
from __future__ import annotations

from typing import Any

CONTEXT_KEYS = (
    "company_name",
    "product",
    "target_customers",
    "competitors",
    "tech_stack",
    "strategic_goals",
    "risks",
    "strategic_questions",
)

_MAX_TAGS = 12
_MAX_QUESTIONS = 5
_MAX_TEXT = 500
_STOP = {
    "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "is",
    "we", "our", "should", "do", "does", "are", "be", "this", "that",
    "with", "from", "about", "what", "how", "why", "when",
}


def _clip(value: Any, limit: int = _MAX_TEXT) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit].strip()


def _tag_list(value: Any, *, limit: int = _MAX_TAGS) -> list[str]:
    if isinstance(value, str):
        raw = [part.strip() for part in value.replace(";", ",").split(",")]
    elif isinstance(value, list):
        raw = [str(part).strip() for part in value]
    else:
        raw = []
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        cleaned = " ".join(item.split())
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(cleaned[:80])
        if len(out) >= limit:
            break
    return out


def empty_context() -> dict[str, Any]:
    return {
        "company_name": "",
        "product": "",
        "target_customers": "",
        "competitors": [],
        "tech_stack": [],
        "strategic_goals": "",
        "risks": "",
        "strategic_questions": [],
    }


def normalize_operating_context(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    questions = _tag_list(data.get("strategic_questions"), limit=_MAX_QUESTIONS)
    # Questions are sentences, not tags — keep punctuation, just trim.
    if isinstance(data.get("strategic_questions"), list):
        questions = []
        seen: set[str] = set()
        for item in data.get("strategic_questions") or []:
            q = _clip(item, 180)
            key = q.lower()
            if len(q) < 8 or key in seen:
                continue
            seen.add(key)
            questions.append(q)
            if len(questions) >= _MAX_QUESTIONS:
                break
    return {
        "company_name": _clip(data.get("company_name"), 120),
        "product": _clip(data.get("product"), 240),
        "target_customers": _clip(data.get("target_customers"), 240),
        "competitors": _tag_list(data.get("competitors")),
        "tech_stack": _tag_list(data.get("tech_stack")),
        "strategic_goals": _clip(data.get("strategic_goals")),
        "risks": _clip(data.get("risks")),
        "strategic_questions": questions,
    }


def merge_operating_context(existing: Any, patch: Any) -> dict[str, Any]:
    current = normalize_operating_context(existing)
    if not isinstance(patch, dict):
        return current
    merged = dict(current)
    for key in CONTEXT_KEYS:
        if key not in patch or patch[key] is None:
            continue
        merged[key] = patch[key]
    return normalize_operating_context(merged)


def who_affected_from_context(ctx: dict[str, Any] | None) -> str:
    """One-line 'who this moves' for signal impact and watching items."""
    data = normalize_operating_context(ctx or {})
    company = data["company_name"]
    customers = data["target_customers"]
    if company and customers:
        return f"{company} and {customers[:80]}"
    if company:
        return company
    if customers:
        return customers[:80]
    return ""


def has_operating_context(ctx: dict[str, Any] | None) -> bool:
    data = normalize_operating_context(ctx or {})
    return bool(
        data["company_name"]
        or data["product"]
        or data["competitors"]
        or data["tech_stack"]
        or data["strategic_questions"]
        or data["target_customers"]
        or data["strategic_goals"]
    )


def format_operating_context(ctx: dict[str, Any] | None) -> str:
    """Plain-text block for LLM prompts and profile embeddings."""
    data = normalize_operating_context(ctx or {})
    if not has_operating_context(data):
        return ""
    lines: list[str] = ["Operating context (use this before generic interests):"]
    if data["company_name"]:
        lines.append(f"Company: {data['company_name']}")
    if data["product"]:
        lines.append(f"Product: {data['product']}")
    if data["target_customers"]:
        lines.append(f"Target customers: {data['target_customers']}")
    if data["competitors"]:
        lines.append("Competitors / substitutes: " + ", ".join(data["competitors"]))
    if data["tech_stack"]:
        lines.append("Technology / model stack: " + ", ".join(data["tech_stack"]))
    if data["strategic_goals"]:
        lines.append(f"Strategic goals: {data['strategic_goals']}")
    if data["risks"]:
        lines.append(f"Risks: {data['risks']}")
    if data["strategic_questions"]:
        numbered = "; ".join(
            f"{i}. {q}" for i, q in enumerate(data["strategic_questions"], start=1)
        )
        lines.append(f"Active strategic questions: {numbered}")
    return "\n".join(lines)


def distinctive_tokens(text: str) -> list[str]:
    """Content words (≥4 chars, not stopwords) used to match questions to evidence."""
    tokens: list[str] = []
    seen: set[str] = set()
    for raw in (text or "").split():
        token = raw.strip("?,.!").lower()
        if len(token) < 4 or token in _STOP or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
    return tokens


def questions_hit_by_text(ctx: dict[str, Any] | None, text: str) -> list[str]:
    """Return strategic questions whose distinctive words appear in text."""
    data = normalize_operating_context(ctx or {})
    blob = (text or "").lower()
    if not blob:
        return []
    hits: list[str] = []
    for question in data["strategic_questions"]:
        tokens = distinctive_tokens(question)
        if tokens and any(token in blob for token in tokens):
            hits.append(question)
    return hits


async def seed_tracked_entities_from_context(
    session,
    user_id: str,
    ctx: dict[str, Any] | None,
) -> int:
    """Create watched entities from competitors and stack names. Idempotent."""
    from sqlalchemy import select

    from briefly_api.db.models import WatchedEntity
    from briefly_api.services.watch.catalog import generate_aliases, match_terms_for
    from briefly_api.services.watch.sources import seed_sources

    data = normalize_operating_context(ctx or {})
    specs: list[tuple[str, str, str]] = []
    for name in data["competitors"]:
        specs.append((name, "company", "competitor"))
    for name in data["tech_stack"]:
        specs.append((name, "product", "stack"))

    existing = (
        await session.execute(select(WatchedEntity).where(WatchedEntity.user_id == user_id))
    ).scalars().all()
    have = {e.name.lower() for e in existing}
    created = 0
    for name, kind, relationship in specs:
        if name.lower() in have:
            continue
        aliases = generate_aliases(name, match_terms_for(name, kind, [], []))
        ent = WatchedEntity(
            user_id=user_id,
            name=name,
            kind=kind,
            keywords=[],
            aliases=aliases,
            is_active=True,
            relationship_to_user=relationship,
            watch_reason=(
                "Competitor from operating context"
                if relationship == "competitor"
                else "Technology stack from operating context"
            ),
            monitoring_rules={
                "detectors": ["pricing_positioning", "model_api", "product_release"],
            },
        )
        session.add(ent)
        await session.flush()
        try:
            await seed_sources(session, ent)
        except Exception:
            pass
        have.add(name.lower())
        created += 1
    return created
