# Thread Matching Rules

A new item matches an active story thread when **at least two** of the following
conditions are true:

## Condition 1 — Named entity overlap
The item title or summary contains the same named entity as the thread key.
Named entities: companies, people, products, legislation names, events.

> Thread "gpt-5" + item about "GPT-5 training compute" → match
> Thread "eu-ai-act" + item about "EU AI Act Article 6 amendment" → match

## Condition 2 — Thematic verb match
The item describes the same *action* or *outcome* as the thread's latest headline.
Match verbs: raises, cuts, bans, launches, acquires, sues, settles, delays.

> Thread latest: "OpenAI raises $6B Series C"
> New item: "OpenAI closes financing round at $6.6B" → match (same event, more detail)

## Condition 3 — Causal continuation
The item is a direct consequence of or response to a prior item in the thread.

> Thread: "EU passes AI Act"
> New item: "EU AI Act enforcement body appoints director" → continuation

## Condition 4 — Participant overlap
Three or more of the same organisations/people appear in both the new item and
the thread's last 2 headlines.

## Non-matches to avoid

**Do NOT match on category alone:**
> Thread "ai-regulation" + item about "Chinese social media law" → NOT a match
> (regulation is the category, not the specific thread)

**Do NOT match on source alone:**
> Thread "openai-funding" + new OpenAI item about a different topic → NOT a match

**Do NOT match when the thread is marked "health: fading":**
> If the thread value.health == "fading", only match if conditions 1 AND 2 both pass
