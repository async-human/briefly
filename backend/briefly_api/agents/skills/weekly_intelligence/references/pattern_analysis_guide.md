# Pattern Analysis Guide

## Depth trend scoring

Calculate depth_trend by comparing `avg_follow_up_depth` this week vs last week:
- **deepening**: this week's avg ≥ last week's + 0.5
- **shallowing**: this week's avg ≤ last week's - 0.5
- **stable**: difference < 0.5 in either direction

If no follow-up data exists (new user), report "stable".

## Current focus — how to write it

The current_focus should read like an analyst's brief about this person:
> "You're primarily focused on LLM infrastructure and reliability this week —
>  8 of your 12 deep engagements were on model performance and cost. Secondary
>  focus: the OpenAI/Anthropic competitive dynamic (4 follow-ups, 2 saves)."

Not like this:
> "This week you read about AI topics and engaged with content in your interest areas."

## Weekly synthesis — how to write it

Synthesis is forward-looking and actionable. It should help the user decide
what to watch, what to stop watching, or what they might be missing.

**Good synthesis:**
> "Your AI reliability focus deepened this week — 3 follow-up sessions averaging
>  4 turns each. That depth suggests you're building a mental model, not just
>  scanning. Consider adding the ACM Queue or USENIX feeds for more technical depth."
> "You clicked 0 AI regulation stories this week despite declaring it as a core
>  interest. If your thinking has shifted, updating your preferences will help
>  Briefly stop surfacing them."

**Bad synthesis (too generic):**
> "You had an engaged reading week. Continue following your core interests."
> "There are many interesting topics in your feed this week."

## Emerging thread criteria

An emerging_thread has:
- `topic`: the name as it appears in the item titles/headlines
- `appearances`: count of distinct digest dates where this topic appeared
- `trajectory`: one of "accelerating" | "steady" | "one-time-cluster"
  - accelerating: appeared 1× in week -1, 2+ in week 0
  - steady: appeared consistently across both weeks
  - one-time-cluster: all appearances within 48 hours (could be breaking news)
