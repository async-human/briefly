"""
briefly_api/agents/skills/narrative_skill.py

NarrativeSkill — execution wrapper.

The reasoning lives in:
  narrative/SKILL.md                               (system prompt + master rules)
  narrative/references/voice_and_style.md          (headline rules, banned phrases)
  narrative/references/personalisation_patterns.md (how to use the fingerprint)
  narrative/references/memory_callout_rules.md     (when/how to write memory_reference)
  narrative/references/section_assignment.md       (section label rules)
  narrative/references/output_schema.md            (full JSON schema + examples)

This file handles: prompt construction, LLM call, response parsing.
To change what "why_it_matters_to_you" means — edit personalisation_patterns.md.
To change voice — edit voice_and_style.md.
To change the output format — edit output_schema.md.
"""
from __future__ import annotations

import json
import logging

from briefly_api.agents.context import PipelineContext, RawItem
from briefly_api.agents.skills.skill_loader import get_skill
from briefly_api.llm.adapter import Message, get_llm_adapter
from briefly_api.services.digest_sections import SECTION_HIGHLY_RELEVANT, SECTION_WHATS_NEW

log = logging.getLogger(__name__)

_SKILL = get_skill("narrative")

# Build the full system prompt once at import time.
# All reference files are included because the writer needs all of them
# on every call.  The Anthropic system-prompt cache means this cost is
# amortised across all calls in the same process.
_SYSTEM = (
    _SKILL.body
    + "\n\n---\n\n"
    + _SKILL.reference("voice_and_style.md")
    + "\n\n---\n\n"
    + _SKILL.reference("personalisation_patterns.md")
    + "\n\n---\n\n"
    + _SKILL.reference("memory_callout_rules.md")
    + "\n\n---\n\n"
    + _SKILL.reference("section_assignment.md")
    + "\n\n---\n\n"
    + _SKILL.reference("output_schema.md")
    + "\n\n---\n\n"
    + _SKILL.reference("style_presets.md")
)


class NarrativeSkill:
    """
    The enhanced briefing writer that uses pre-computed enrichment +
    behavioral fingerprint.  Called by BriefingWriterAgent.run().
    """

    def build_style_block(self, *, brief_style: str, brief_language: str) -> str:
        style = (brief_style or "analyst").strip().lower()
        language = (brief_language or "en").strip().lower()
        return (
            f"## Style preset\n"
            f"- brief_style: {style}\n"
            f"- brief_language: {language}\n"
            f"Apply style_presets.md for summary and why_it_matters_to_you only.\n\n"
        )

    def build_cached_prefix(
        self,
        profile_summary: str,
        behavioral_fingerprint_text: str,
        recent_context: str,
        story_threads_text: str,
        memory_json: str,
    ) -> str:
        """
        Build the stable section of the writer prompt that Anthropic caches.
        Changes only when the user's profile or fingerprint changes —
        not per item — so repeated calls and retries hit the cache.
        """
        return (
            f"## User profile (onboarding answers)\n{profile_summary}\n\n"
            f"## Behavioral fingerprint (what the data shows)\n"
            f"{behavioral_fingerprint_text}\n\n"
            f"## Recent digest history (already seen — do not repeat)\n"
            f"{recent_context}\n\n"
            f"## Active story threads\n{story_threads_text}\n\n"
            f"## Memory connections (pre-computed)\n{memory_json}\n\n"
        )

    def build_items_section(
        self,
        items: list[RawItem],
        enrichment_cache: dict[str, dict],
        ctx: PipelineContext,
    ) -> str:
        """
        Build the variable items section.  Includes pre-computed enrichment
        for each item so the model assembles rather than derives.
        """
        slim = []
        for item in items:
            cached  = enrichment_cache.get(item.id, {})
            body    = item.summary or (item.clean_text[:200] if item.clean_text else "")
            section = item.meta.get("digest_section") or SECTION_WHATS_NEW

            entry: dict = {
                "id":             item.id,
                "digest_section": section,
                "title":          item.title,
                "source":         item.source_name,
                "source_type":    item.source_type,
                "url":            item.url,
                "summary":        body,
                "relevance_score": round(item.relevance_score, 2),
                "novelty_score":   round(item.novelty_score, 2),
                "published_at":    item.published_at.isoformat() if item.published_at else None,
            }

            # Inject pre-computed enrichment — the model is instructed to use
            # these verbatim or improve them, never ignore them.
            if cached.get("why_relevant"):
                entry["pre_computed_why_relevant"] = cached["why_relevant"]
            if cached.get("connection_sentence"):
                entry["pre_computed_connection"] = cached["connection_sentence"]
            if cached.get("thread_update"):
                entry["pre_computed_thread_update"] = cached["thread_update"]
            if cached.get("thread_key"):
                entry["pre_computed_thread_key"] = cached["thread_key"]
            if cached.get("contradiction_flag"):
                entry["contradiction_flag"] = True
                entry["contradiction_explanation"] = cached.get("contradiction_explanation")
            if cached.get("user_angle"):
                entry["pre_computed_user_angle"] = cached["user_angle"]

            slim.append(entry)

        instructions = (
            f"Write a personalized morning briefing. For each item:\n"
            f"- section: MUST equal the item's pre-assigned digest_section exactly "
            f"({SECTION_WHATS_NEW} or {SECTION_HIGHLY_RELEVANT})\n"
            f"- headline: sharp, specific, active voice (see voice_and_style.md)\n"
            f"- summary: 2 sentences max, factual\n"
            f"- why_it_matters_to_you: 1-2 sentences, use pre_computed fields if provided\n"
            f"- source_name, source_url: required\n"
            f"- memory_reference: use pre_computed_connection or pre_computed_thread_update if set\n"
            f"- confidence_signal: 1 short phrase or empty\n"
            f"- evolution_note: only if behavioral fingerprint shows genuine divergence\n\n"
            f"Also generate: subject_line, preview_text, skipped_note.\n\n"
            f"Return JSON per output_schema.md."
        )

        return f"Items to write briefing for:\n{json.dumps(slim, indent=2)}\n\n{instructions}"

    async def run(
        self,
        cached_prefix: str,
        items_section: str,
        model: str | None = None,
    ) -> dict | None:
        """
        Run the full narrative LLM call.  Returns parsed JSON dict or None.
        Hard timeout: 45 seconds — if the LLM doesn't respond, fall back to
        plain drafts rather than blocking the whole pipeline.
        """
        import asyncio
        llm    = get_llm_adapter()
        prompt = cached_prefix + items_section
        try:
            return await asyncio.wait_for(
                llm.complete_json(
                    messages=[Message(role="user", content=prompt)],
                    system=_SYSTEM,
                    model=model or _SKILL.model or None,
                    max_tokens=_SKILL.max_tokens or 2200,
                    cached_prefix=cached_prefix,
                    agent="narrative",
                ),
                timeout=45.0,
            )
        except asyncio.TimeoutError:
            log.warning("NarrativeSkill: LLM call timed out (>45s) — using fallback drafts")
            return None
        except Exception:
            log.exception("NarrativeSkill: LLM call failed")
            return None
