"""
briefly_api/agents/memory.py

MemoryAgent: connects incoming items to stories the user has been following.

Looks at active_story_threads (fetched from user_memory at pipeline start) and
checks if any enriched item is an update to a thread. Populates
ctx.memory_connections so the BriefingWriterAgent can say
"Update to Monday's story about X".
"""
from __future__ import annotations

import logging

from briefly_api.agents.context import PipelineContext

log = logging.getLogger(__name__)

# Simple keyword overlap threshold to consider an item related to a thread
_OVERLAP_THRESHOLD = 2


async def run(ctx: PipelineContext) -> PipelineContext:
    """
    Match enriched items to active story threads.
    Populates ctx.memory_connections: {item_id: [connection, ...]}.
    """
    threads = ctx.user.active_story_threads
    if not threads:
        return ctx

    connections: dict[str, list[dict]] = {}

    for item in ctx.enriched_items:
        item_text = f"{item.title} {item.summary}".lower()
        item_connections = []

        for thread in threads:
            thread_key = thread.get("key", "").lower()
            value = thread.get("value", {})
            description = value.get("description", thread_key).lower()

            # Count keyword overlap between item and thread topic
            thread_words = set(w for w in thread_key.split() if len(w) > 3)
            item_words = set(w for w in item_text.split() if len(w) > 3)
            overlap = len(thread_words & item_words)

            if overlap >= _OVERLAP_THRESHOLD:
                item_connections.append({
                    "type": "update_to",
                    "thread_key": thread_key,
                    "description": f"Relates to ongoing story: {description}",
                    "strength": thread.get("strength", 1.0),
                    "occurrence_count": thread.get("occurrence_count", 1),
                })

        if item_connections:
            connections[item.id] = item_connections

    ctx.memory_connections = connections
    log.info(
        "MemoryAgent: found %d memory connections across %d items",
        sum(len(v) for v in connections.values()), len(connections),
    )
    return ctx
