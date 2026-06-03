# Profile Anchor Rules

When writing a relevance sentence, pick the **strongest anchor** from the user's
profile in this priority order:

## Priority 1 — Role + Goal combination
If the item directly affects how the user does their job or achieves their stated
goal, lead with that.

> "As a [role] trying to [goal], this [specific claim from the item] directly affects [specific consequence]."

Example: "As a product manager building a consumer AI app, this EU AI Act compliance deadline affects your Q3 roadmap."

## Priority 2 — Named declared interest
If the item matches a topic the user explicitly declared as an interest, name it.

> "This connects to your declared interest in [interest] — [specific claim from item]."

Do not say "one of your interests" — name it specifically.

## Priority 3 — Inferred cluster
If a strong topic cluster exists (strength > 0.6) that matches, reference it as
a demonstrated pattern rather than a stated preference.

> "You've been consistently following [cluster topic] — this [specific claim]."

## Priority 4 — Source familiarity
If the item is from a source the user regularly engages with, note that only if
there is no stronger anchor.

> "From [source], which you consistently open — this covers [specific claim]."

## When to return "Not directly relevant"
Return exactly `Not directly relevant to declared interests.` when:
- The item's topic doesn't overlap with any declared interest, cluster, or goal
- The overlap is superficial (e.g. both are "tech" at category level)
- You would have to stretch the connection to justify relevance

Never fabricate relevance. A "not relevant" result is used to deprioritise the
item in the pool — it is useful signal, not a failure.
