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
- section: one of the sections below (assign based on topic)
- headline: sharp, specific, active voice
- summary: 2 sentences max, factual
- why_it_matters_to_you: 1-2 sentences, MUST reference this user's specific context
- source_name: publication name
- source_url: direct URL to the content

Sections to use (pick the 2-3 most relevant for this user's interests):
{sections}

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
    s = get_settings()
    llm = get_llm_adapter()

    selected_ids = set(ctx.selected_item_ids)
    items_to_write = [i for i in ctx.enriched_items if i.id in selected_ids]

    if not items_to_write:
        log.warning("BriefingWriterAgent: no items selected to write")
        ctx.log_error("BriefingWriterAgent", "No items to write")
        return ctx

    # Build prompt context
    profile_summary = _build_profile_summary(ctx.user.profile, ctx.user.topic_clusters)
    recent_context = _build_recent_context(ctx.user.recent_digest_items)
    items_json = _build_items_json(items_to_write, ctx)
    memory_json = json.dumps(ctx.memory_connections, indent=2)
    sections = _suggest_sections(ctx.user.profile, ctx.user.topic_clusters)

    prompt = _WRITER_PROMPT_TEMPLATE.format(
        profile_summary=profile_summary,
        recent_context=recent_context,
        items_json=items_json,
        memory_connections=memory_json,
        sections=", ".join(sections),
    )

    try:
        result = await llm.complete_json(
            messages=[Message(role="user", content=prompt)],
            system=_WRITER_SYSTEM,
        )
    except Exception as e:
        log.exception("BriefingWriterAgent: LLM call failed")
        ctx.log_error("BriefingWriterAgent", str(e))
        return ctx

    # Parse response
    ctx.subject_line = result.get("subject_line", f"Your Briefly for {ctx.run_date}")
    ctx.preview_text = result.get("preview_text", "")
    skipped_note = result.get("skipped_note", "")

    # Build DigestItemDraft objects
    item_map = {i.id: i for i in items_to_write}
    drafts: list[DigestItemDraft] = []

    for pos, written in enumerate(result.get("items", []), start=1):
        content_id = written.get("content_id", "")
        source_item = item_map.get(content_id)

        draft = DigestItemDraft(
            content_id=content_id,
            position=pos,
            section=written.get("section", "Today"),
            headline=written.get("headline", ""),
            summary=written.get("summary", ""),
            why_it_matters=written.get("why_it_matters_to_you", ""),
            source_name=written.get("source_name", source_item.source_name if source_item else ""),
            source_url=written.get("source_url", source_item.url if source_item else None),
            all_sources=source_item.duplicate_sources if source_item else [],
            duplicate_count=len(source_item.duplicate_sources) + 1 if source_item else 1,
            memory_connections=ctx.memory_connections.get(content_id, []),
            relevance_score=source_item.relevance_score if source_item else 0.0,
            novelty_score=source_item.novelty_score if source_item else 0.5,
        )
        drafts.append(draft)

    ctx.digest_items = drafts
    ctx.total_shown = len(drafts)

    # Store skipped note in pipeline context for use in email template
    ctx.pipeline_errors  # reuse as metadata carrier — store skipped note
    if skipped_note:
        ctx.__dict__["skipped_note"] = skipped_note

    log.info(
        "BriefingWriterAgent: wrote %d items, subject='%s'",
        len(drafts), ctx.subject_line[:60],
    )
    return ctx


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
        clusters = ", ".join(
            f"{c['cluster']} (strength {c.get('strength', 0):.0%})"
            for c in sorted(topic_clusters, key=lambda x: x.get("strength", 0), reverse=True)[:5]
        )
        parts.append(f"Inferred topics: {clusters}")
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
