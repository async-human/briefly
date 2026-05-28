"""
briefly_api/agents/cleaner.py

ContentCleanerAgent: normalizes raw text, regenerates content hashes,
and pre-generates embeddings so downstream agents (dedup, relevance)
don't each have to call the embedding API separately.
"""
from __future__ import annotations

import hashlib
import logging
import re

from briefly_api.agents.context import PipelineContext, RawItem
from briefly_api.embeddings.adapter import get_embedding_adapter

log = logging.getLogger(__name__)

# Minimum usable text length after cleaning
_MIN_TEXT_LEN = 30


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Clean all raw items and generate embeddings.
    Populates ctx.cleaned_items.
    """
    embedder = get_embedding_adapter()
    cleaned: list[RawItem] = []

    texts_to_embed: list[str] = []
    items_needing_embed: list[RawItem] = []

    for item in ctx.raw_items:
        # Normalize text
        item.clean_text = _normalize(item.clean_text)

        # Drop items with no usable content
        if len(item.clean_text) < _MIN_TEXT_LEN and not item.title:
            log.debug("Cleaner: dropping item with no content: %s", item.url)
            continue

        # Recompute hash on normalized text
        text_for_hash = item.clean_text or item.title or ""
        item.content_hash = hashlib.sha256(
            text_for_hash.encode("utf-8", errors="replace")
        ).hexdigest()

        cleaned.append(item)

        # Prepare batch embedding text
        embed_text = f"{item.title} | {item.summary or item.clean_text[:500]}"
        texts_to_embed.append(embed_text)
        items_needing_embed.append(item)

    # Batch embed all items in one API call
    if texts_to_embed:
        try:
            embeddings = await embedder.embed_batch(texts_to_embed)
            for item, emb in zip(items_needing_embed, embeddings):
                item.embedding = emb
        except Exception as e:
            log.warning("Cleaner: batch embedding failed (%s) — embeddings will be generated on demand", e)

    ctx.cleaned_items = cleaned
    log.info(
        "ContentCleanerAgent: %d raw → %d cleaned (dropped %d)",
        len(ctx.raw_items), len(cleaned), len(ctx.raw_items) - len(cleaned),
    )
    return ctx


def _normalize(text: str) -> str:
    """Strip HTML tags and normalize whitespace."""
    if not text:
        return ""
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", text)
    # Decode common HTML entities
    text = (
        text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
    )
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text
