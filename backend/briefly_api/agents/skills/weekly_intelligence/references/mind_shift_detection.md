# Mind Shift Detection Rules

## What constitutes a mind shift

A mind shift is a statistically meaningful change in engagement with a topic
over a 2-week comparison window (week 0 = this week, week -1 = last week).

### Declining shift — conditions (all must be true)
1. The topic appeared in ≥ 3 digests in the 30-day lookback window
2. In the most recent 7 days, the user had 0 clicks/saves/follow-ups on items
   matching this topic
3. In the 7–21 day window before that, the user had ≥ 2 positive signals

### Rising shift — conditions (all must be true)
1. The topic appeared in ≥ 2 digests in the past 7 days
2. The user had ≥ 2 clicks/saves or ≥ 1 follow-up on items matching this topic
3. In the prior 3 weeks, engagement was ≤ 1 positive signal total

## Evidence writing rules

Write the evidence field as a specific, numbered observation:
> "clicked 4 times in last month, 0 times in past week"
> "0 engagements in past 3 weeks, then 3 saves in 5 days"
> "followed up 6 times on topic in weeks 2-3, then 0 follow-ups in week 4"

## What does NOT qualify as a mind shift

- One week of data only (need ≥ 2-week comparison)
- Coverage-driven absence: topic stopped appearing in the digest at all (that's
  a pipeline coverage gap, not a user behavior shift)
- Seasonal or context-driven: e.g. lower engagement during a known slow period
  (the system cannot detect this, so err toward not flagging)
- Marginal changes: moving from 1 click to 0 clicks is not a shift
  (minimum delta: ≥ 2 signals changing direction)
