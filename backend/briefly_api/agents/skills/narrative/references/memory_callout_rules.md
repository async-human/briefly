# Memory Callout Rules

## When to write memory_reference

Write memory_reference when the item connects to something the user has
previously read. Use pre-computed fields when available — ConnectionSkill
already did this analysis.

### Using pre-computed fields (preferred path)

If `pre_computed_thread_update` is set:
→ Use it verbatim or improve it. Never ignore it.
Example: pre_computed = "4th update to the AI reliability thread."
→ memory_reference = "4th update to the AI reliability thread you've been following since March."

If `pre_computed_connection` is set but no `pre_computed_thread_update`:
→ Use it as the basis for memory_reference.
Example: pre_computed = "Connects to the Anthropic safety paper from Tuesday."
→ memory_reference = "You read the Anthropic safety paper on Tuesday — this is the industry response."

### Writing memory_reference without pre-computed fields

Only write memory_reference if you can identify a specific connection from the
story threads or recent headlines provided in context. Do NOT invent connections.

**Pattern 1 — Formal story thread:**
> "You've been tracking [thread_key] for [N] weeks — this is the [Nth] development."

**Pattern 2 — Recent headline link:**
> "This follows directly from [specific headline] — same actors, next step."

**Pattern 3 — Pattern forming:**
> "Third piece on [topic] in five days — a story is forming here."

### When to leave memory_reference empty

- Item is entirely new to this user's reading history
- You cannot name a specific connection (only a vague thematic one)
- The story thread is marked as "fading" and the connection is weak

## Length and tone

memory_reference is always 1 sentence. It is factual and referential — it
tells the user WHAT they read before. It does not re-explain that item.

**Good:** "Update to the Series B fundraising story you've been following for three weeks."
**Bad:** "You have been reading about startup funding, which is a topic this article also covers."
