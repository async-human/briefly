"""
briefly_api/agents/briefing_writer.py

The BriefingWriterAgent generates the actual digest users read.
This is where "this understands me" becomes visible.

Every item gets three things:
  1. A sharp headline
  2. A factual 2-sentence summary
  3. A personalized "why this matters to YOU" — the key differentiator

The agent also writes:
  - The subject line (must be compelling enough to open)
  - The preview text (shown in email clients before opening)
  - Section headers that feel personal not generic
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from briefly_api.agents.context import DigestItemDraft, PipelineContext, RawItem
from briefly_api.config import get_settings
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.digest_sections import (
    SECTION_HIGHLY_RELEVANT,
    SECTION_WHATS_NEW,
)
from briefly_api.services.profile_utils import cluster_label
from briefly_api.services.article_urls import resolve_article_url

log = logging.getLogger(__name__)

# System prompt for the briefing writer
# This is the voice of Briefly — must feel like a sharp personal analyst
_WRITER_SYSTEM = """You are Briefly, a personal AI analyst writing a morning briefing for a specific person.

Your voice: sharp, direct, intelligent. Not a newsletter, not a chatbot. A trusted colleague who read everything you follow and is telling you what matters.

Rules:
- Never use phrases like "In this article...", "According to...", "This piece discusses..."
- Every "why_it_matters_to_you" must reference something specific about THIS user — their role, goals, interests, or past reading
- Headlines are active and specific, not vague ("OpenAI's new reasoning model beats GPT-4o on coding benchmarks" not "AI news today")
- Summaries are factual, 2 sentences maximum
- The "why_it_matters_to_you" is 1-2 sentences and must feel personal — if it could apply to anyone, rewrite it
- If a story is an update to something the user has been following, say so explicitly
- Citations are mandatory — every item must have a source URL

Return ONLY valid JSON. No markdown, no preamble."""

_WRITER_PROMPT_TEMPLATE = """User profile:
{profile_summary}

Recent digest history (what they've already seen):
{recent_context}

Items to write briefing for (scored by relevance):
{items_json}

Memory connections (stories the user has been tracking):
{memory_connections}

Write a personalized morning briefing. For each item, generate:
- section: MUST equal the item's pre-assigned digest_section exactly ({section_whats_new} or {section_highly_relevant})
- headline: sharp, specific, active voice
- summary: 2 sentences max, factual
- why_it_matters_to_you: 1-2 sentences, MUST reference this user's specific context
- source_name: publication name
- source_url: direct URL to the content

Do NOT rename or reassign sections — the planner has already grouped items.

Also generate:
- subject_line: email subject that makes THIS user want to open it (reference a specific story they care about)
- preview_text: 1 sentence shown in email preview (different from subject)
- skipped_note: 1 sentence explaining what you filtered out today (e.g. "Skipped 12 stories — mostly crypto price updates and general market news you've told me to deprioritize")

Return JSON:
{{
  "subject_line": "...",
  "preview_text": "...",
  "skipped_note": "...",
  "items": [
    {{
      "content_id": "...",
      "section": "...",
      "headline": "...",
      "summary": "...",
      "why_it_matters_to_you": "...",
      "source_name": "...",
      "source_url": "..."
    }}
  ]
}}"""


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Write the personalized briefing for all planned items.
    Populates ctx.digest_items, ctx.subject_line, ctx.preview_text.
    """
    _ = get_settings()
    llm = get_llm_adapter()

    selected_ids = set(ctx.selected_item_ids)
    item_map = {i.id: i for i in ctx.enriched_items if i.id in selected_ids}
    items_to_write = [item_map[iid] for iid in ctx.selected_item_ids if iid in item_map]

    if not items_to_write:
        log.warning("BriefingWriterAgent: no items selected to write")
        ctx.log_error("BriefingWriterAgent", "No items to write")
        return ctx

    try:
        profile_summary = _build_profile_summary(ctx.user.profile, ctx.user.topic_clusters)
        recent_context = _build_recent_context(ctx.user.recent_digest_items)
        items_json = _build_items_json(items_to_write, ctx)
        memory_json = json.dumps(ctx.memory_connections, indent=2)

        prompt = _WRITER_PROMPT_TEMPLATE.format(
            profile_summary=profile_summary,
            recent_context=recent_context,
            items_json=items_json,
            memory_connections=memory_json,
            section_whats_new=SECTION_WHATS_NEW,
            section_highly_relevant=SECTION_HIGHLY_RELEVANT,
        )

        result: dict | None = None
        try:
            result = await llm.complete_json(
                messages=[Message(role="user", content=prompt)],
                system=_WRITER_SYSTEM,
            )
        except Exception as e:
            log.exception("BriefingWriterAgent: LLM call failed")
            ctx.log_error("BriefingWriterAgent", str(e))

        if result and result.get("items"):
            ctx.subject_line = result.get("subject_line", f"Your Briefly for {ctx.run_date}")
            ctx.preview_text = result.get("preview_text", "")
            skipped_note = result.get("skipped_note", "")
            if skipped_note:
                ctx.__dict__["skipped_note"] = skipped_note

            written_by_id = {w.get("content_id"): w for w in result.get("items", [])}
            drafts = _drafts_from_llm(items_to_write, written_by_id, ctx)
            drafts = _ensure_personalized_why(drafts, items_to_write, ctx.user.profile)
        else:
            ctx.subject_line = f"Your briefing — {ctx.run_date}"
            ctx.preview_text = items_to_write[0].title[:120] if items_to_write else ""
            drafts = _fallback_drafts(items_to_write, ctx)
            drafts = _ensure_personalized_why(drafts, items_to_write, ctx.user.profile)
    except Exception as e:
        log.exception("BriefingWriterAgent: failed — using fallback drafts")
        ctx.log_error("BriefingWriterAgent", str(e))
        ctx.subject_line = f"Your briefing — {ctx.run_date}"
        ctx.preview_text = items_to_write[0].title[:120] if items_to_write else ""
        drafts = _fallback_drafts(items_to_write, ctx)
        drafts = _ensure_personalized_why(drafts, items_to_write, ctx.user.profile)

    ctx.digest_items = drafts
    ctx.total_shown = len(drafts)

    log.info(
        "BriefingWriterAgent: wrote %d items, subject='%s'",
        len(drafts), ctx.subject_line[:60],
    )
    return ctx


def _assigned_section(item: RawItem) -> str:
    return item.meta.get("digest_section") or SECTION_WHATS_NEW


def _draft_url(item: RawItem, written_url: str | None = None) -> str | None:
    for candidate in (written_url, item.url):
        resolved = resolve_article_url(candidate, item.meta)
        if resolved:
            return resolved
    return None


def _fallback_drafts(items: list[RawItem], ctx: PipelineContext) -> list[DigestItemDraft]:
    drafts: list[DigestItemDraft] = []
    for pos, item in enumerate(items, start=1):
        summary = item.summary or item.clean_text[:300]
        drafts.append(
            DigestItemDraft(
                content_id=item.id,
                position=pos,
                section=_assigned_section(item),
                headline=item.title,
                summary=summary,
                why_it_matters=_personalized_why_fallback(item, ctx.user.profile),
                source_name=item.source_name,
                source_url=_draft_url(item),
                all_sources=item.duplicate_sources,
                duplicate_count=len(item.duplicate_sources) + 1,
                memory_connections=ctx.memory_connections.get(item.id, []),
                relevance_score=item.relevance_score,
                novelty_score=item.novelty_score,
            )
        )
    return drafts


def build_fallback_drafts(ctx: PipelineContext) -> list[DigestItemDraft]:
    """Public fallback used by the pipeline when the writer returns no items."""
    selected_ids = set(ctx.selected_item_ids)
    items = [i for i in ctx.enriched_items if i.id in selected_ids]
    if not items:
        item_map = {i.id: i for i in ctx.enriched_items}
        items = [item_map[iid] for iid in ctx.selected_item_ids if iid in item_map]
    return _fallback_drafts(items, ctx)


def _profile_anchor_terms(profile: dict) -> set[str]:
    terms: set[str] = set()
    role = (profile.get("role") or "").strip().lower()
    goal = (profile.get("goal") or "").strip().lower()
    if role:
        terms.add(role)
        terms.update(w for w in role.split() if len(w) > 3)
    if goal:
        terms.update(w for w in goal.split() if len(w) > 4)
    for interest in profile.get("interests") or []:
        topic = (interest.get("topic") or "").strip().lower()
        if topic:
            terms.add(topic)
    for cluster in profile.get("topic_clusters") or []:
        label = cluster_label(cluster)
        if label:
            terms.add(label.lower())
    return terms


def _why_is_personalized(text: str, profile: dict) -> bool:
    if not text or len(text.strip()) < 24:
        return False
    lower = text.lower()
    generic = (
        "worth a read",
        "one of your sources",
        "in your briefing today",
        "worth scanning before your day gets busy",
        "ties directly to startup",
    )
    if any(g in lower for g in generic):
        return False
    anchors = _profile_anchor_terms(profile)
    if anchors and any(a in lower for a in anchors):
        return True
    # Accept if it references role/goal explicitly
    role = (profile.get("role") or "").strip().lower()
    goal = (profile.get("goal") or "").strip().lower()
    if role and role in lower:
        return True
    if goal and any(w in lower for w in goal.split() if len(w) > 4):
        return True
    return len(text.split()) >= 12


def _personalized_why_fallback(item: RawItem, profile: dict) -> str:
    role = profile.get("role") or "your role"
    interests = [
        (i.get("topic") or "").strip()
        for i in (profile.get("interests") or [])
        if i.get("topic")
    ]
    blob = f"{item.title} {item.summary or item.clean_text[:600]}".lower()
    matched = [t for t in interests if t.lower() in blob]
    if not matched:
        for t in interests:
            for word in t.lower().split():
                if len(word) > 4 and word in blob:
                    matched.append(t)
                    break

    if matched:
        topics = ", ".join(matched[:2])
        return (
            f"As a {role}, this {item.source_name} piece lines up with your interests "
            f"in {topics}."
        )
    if interests:
        return (
            f"From {item.source_name} — one of your subscribed sources. "
            f"It didn't strongly match {interests[0]}, but it's the latest from that feed."
        )
    return (
        f"Latest from {item.source_name}, which you added to your briefing sources."
    )


def _ensure_personalized_why(
    drafts: list[DigestItemDraft],
    items: list[RawItem],
    profile: dict,
) -> list[DigestItemDraft]:
    item_by_id = {i.id: i for i in items}
    for draft in drafts:
        if _why_is_personalized(draft.why_it_matters, profile):
            continue
        source_item = item_by_id.get(draft.content_id) or next(
            (i for i in items if i.title == draft.headline), None,
        )
        if source_item:
            draft.why_it_matters = _personalized_why_fallback(source_item, profile)
    return drafts


def _drafts_from_llm(
    items_to_write: list[RawItem],
    written_by_id: dict,
    ctx: PipelineContext,
) -> list[DigestItemDraft]:
    item_map = {i.id: i for i in items_to_write}
    drafts: list[DigestItemDraft] = []

    for pos, item in enumerate(items_to_write, start=1):
        written = written_by_id.get(item.id, {})
        source_item = item_map.get(item.id)
        assigned = _assigned_section(item)

        draft = DigestItemDraft(
            content_id=item.id,
            position=pos,
            section=written.get("section") or assigned,
            headline=written.get("headline") or item.title,
            summary=written.get("summary") or (item.summary or item.clean_text[:300]),
            why_it_matters=written.get(
                "why_it_matters_to_you",
                f"From {item.source_name}, in your briefing today.",
            ),
            source_name=written.get("source_name", source_item.source_name if source_item else item.source_name),
            source_url=_draft_url(source_item or item, written.get("source_url")),
            all_sources=source_item.duplicate_sources if source_item else [],
            duplicate_count=len(source_item.duplicate_sources) + 1 if source_item else 1,
            memory_connections=ctx.memory_connections.get(item.id, []),
            relevance_score=source_item.relevance_score if source_item else 0.0,
            novelty_score=source_item.novelty_score if source_item else 0.5,
        )
        if draft.section not in (SECTION_WHATS_NEW, SECTION_HIGHLY_RELEVANT):
            draft.section = assigned
        drafts.append(draft)

    return drafts


# ── Legacy block removed — drafts built above ─────────────────────────────────


# ── Context builders ──────────────────────────────────────────────────────────

def _build_profile_summary(profile: dict, topic_clusters: list[dict]) -> str:
    parts = []
    if profile.get("role"):
        parts.append(f"Role: {profile['role']}")
    if profile.get("goal"):
        parts.append(f"Goal: {profile['goal']}")
    interests = profile.get("interests", [])
    if interests:
        topics = ", ".join(i.get("topic", "") for i in interests[:8] if i.get("topic"))
        parts.append(f"Interests: {topics}")
    if topic_clusters:
        cluster_parts: list[str] = []
        for c in sorted(topic_clusters, key=lambda x: x.get("strength", 0), reverse=True):
            label = cluster_label(c)
            if not label:
                continue
            strength = c.get("strength", c.get("weight"))
            if isinstance(strength, (int, float)) and strength > 0:
                cluster_parts.append(f"{label} (strength {strength:.0%})")
            else:
                cluster_parts.append(label)
            if len(cluster_parts) >= 5:
                break
        if cluster_parts:
            parts.append(f"Inferred topics: {', '.join(cluster_parts)}")
    if profile.get("never_show"):
        never = ", ".join(profile["never_show"][:5])
        parts.append(f"Never show: {never}")
    if profile.get("changed_mind_about"):
        parts.append(f"Recently changed mind about: {profile['changed_mind_about'][:150]}")
    return "\n".join(parts)


def _build_recent_context(recent_items: list[dict]) -> str:
    if not recent_items:
        return "No previous digest history yet — this is their first digest."
    summaries = []
    for item in recent_items[:10]:
        date = item.get("digest_date", "")
        headline = item.get("headline", "")
        if headline:
            summaries.append(f"- [{date}] {headline}")
    return "\n".join(summaries) if summaries else "No recent items."


def _build_items_json(items: list[RawItem], ctx: PipelineContext) -> str:
    slim = []
    for item in items:
        slim.append({
            "id": item.id,
            "digest_section": _assigned_section(item),
            "title": item.title,
            "source": item.source_name,
            "source_type": item.source_type,
            "url": item.url,
            "summary": item.summary or item.clean_text[:400],
            "relevance_score": round(item.relevance_score, 2),
            "novelty_score": round(item.novelty_score, 2),
            "duplicate_sources": item.duplicate_sources,
            "published_at": item.published_at.isoformat() if item.published_at else None,
        })
    return json.dumps(slim, indent=2)


def _suggest_sections(profile: dict, topic_clusters: list[dict]) -> list[str]:
    """
    Suggest section names personalised to the user's interests.
    A founder sees "Startup & Funding" not "Business News".
    """
    role = (profile.get("role") or "").lower()
    interests = profile.get("interests", [])
    interest_topics = [i.get("topic", "").lower() for i in interests]

    sections = []

    # Role-based sections
    if "founder" in role or "startup" in role:
        sections.extend(["Startup & Funding", "Product & Growth"])
    elif "investor" in role or "vc" in role:
        sections.extend(["Deals & Funding", "Market Moves"])
    elif "engineer" in role or "developer" in role:
        sections.extend(["Engineering & Tools", "Open Source"])
    elif "product" in role:
        sections.extend(["Product & Design", "User Research"])
    else:
        sections.extend(["Today's Highlights"])

    # Interest-based sections
    if any("ai" in t or "machine learning" in t or "llm" in t for t in interest_topics):
        sections.append("AI & Models")
    if any("india" in t for t in interest_topics):
        sections.append("India Tech")
    if any("crypto" in t or "web3" in t for t in interest_topics):
        sections.append("Web3 & Crypto")
    if any("climate" in t or "sustainability" in t for t in interest_topics):
        sections.append("Climate & Energy")

    # Always include a catch-all
    sections.append("Worth Reading")

    # Deduplicate and limit
    seen = set()
    result = []
    for s in sections:
        if s not in seen:
            seen.add(s)
            result.append(s)

    return result[:5]  # max 5 sections
