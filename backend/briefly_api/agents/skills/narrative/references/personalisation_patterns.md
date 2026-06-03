# Personalisation Patterns

## Using the behavioral fingerprint

The fingerprint tells you who the user ACTUALLY is, not who they said they were
at onboarding. Use it to make why_it_matters_to_you feel like it was written
by someone who has been paying attention.

### High-engagement topic present

If `high_engagement_topics` contains the item's topic with follow_up_count ≥ 2:
> "You've gone deep on [topic] — [specific claim from item] is a direct update
>  to the questions you've been asking."

### Low-engagement topic (declared but ignored)

If `low_engagement_topics` contains the item's topic:
- Still write a why_it_matters_to_you but make it lower priority
- Do NOT pretend they care about it deeply
- If this is the only reason for relevance, mark confidence_signal as low

### Coverage gap

If `coverage_gaps` contains the item's topic:
> "You've been following [topic] but there's been nothing on it in the past
>  five days — this breaks that gap."

### Mind shift detected

If `mind_shifts` shows a topic moving from rising → declining and this item
is about that topic, note it in evolution_note:
> "You were clicking every [topic] story three months ago. Your engagement has
>  dropped to near-zero recently — I'm still including this because it's a
>  direct development in a thread you started, but flagging the shift."

## Constructing why_it_matters_to_you

Pick the STRONGEST angle from this hierarchy:

1. **Active story thread** — "4th update to the GPT-5 story you've been tracking."
2. **Behavioral pattern** — "You've followed up on 8 AI reliability stories this month."
3. **Role + specific consequence** — "As a founder at pre-Series-A, this [claim] changes [specific implication]."
4. **Goal alignment** — "You said your focus is [goal] — this [claim] is the most direct news on that in three weeks."
5. **Named declared interest** — "Directly relevant to your declared interest in [topic]: [specific claim]."
6. **Source familiarity** — "From [source], which you consistently engage with. This is [specific claim]."

Never use level 6 alone. Always try to combine with at least level 3, 4, or 5.

## Evolution notes

Write evolution_note ONLY when ALL of these are true:
1. The behavioral fingerprint shows a genuine divergence (declared vs. actual)
2. The divergence has been consistent for > 2 weeks (not just one week of data)
3. The divergence is actionable — the user could update their declared preferences

**Good evolution_note examples:**
> "You declared 'never show crypto' but you've saved three Ethereum infrastructure stories this month. I've started including them — update your preferences if this was intentional."
> "You told me you follow AI policy but your click rate on regulation stories is 8% — I'm deprioritising these unless you tell me otherwise."

**Never write evolution_note when:**
- The divergence is based on < 5 data points
- The user's declared interest is recent (< 30 days old)
- The divergence could be explained by irrelevant content (e.g. crypto prices ≠ crypto infrastructure)
