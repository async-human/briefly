# Briefly vs Feedly — product direction

**Date:** 31 August 2026  
**Companion docs:** [`MOAT_ROADMAP.md`](MOAT_ROADMAP.md) (phased gates), [`FEATURES.md`](FEATURES.md) (what has shipped)

Borrow Feedly’s **intelligence machinery**. Do not borrow Feedly’s **product philosophy**.

Feedly is becoming excellent at:

> collect → classify → filter → analyze → distribute

Briefly goes one step further:

> collect → detect change → understand personal/company impact → connect history → update a decision → recommend action → learn from outcome

That second half is the opportunity.

---

## Positioning

| Product | Promise |
|---|---|
| Feedly | Know what's happening. |
| Perplexity | Find out what's happening. |
| ChatGPT | Understand whatever you ask about. |
| Notion | Store what your team knows. |
| **Briefly** | **Know what changed, why it matters to you, what it changes about what you previously believed, and what you should do next.** |

Do not describe Briefly as “an AI that reads everything you follow and creates a personalized brief.” Feedly can increasingly do a large portion of that.

---

## What to take from Feedly

Organize **signals and state transitions**, not articles.

```
ENTITY          Anthropic
SIGNAL TYPE     Product launch
PREVIOUS STATE  No product serving X
NEW STATE       Product X launched
OBSERVED        2026-08-31
CONFIDENCE      0.94
EVIDENCE        3 independent sources
RELATED HISTORY Expansion into enterprise workflows 47 days ago
IMPACT ON YOU   Overlaps Feature Y
DECISION THREAD Should we move further toward founder intelligence?
RECOMMENDED     Review whether this changes differentiation
```

Feedly identifies events. Briefly should understand **state transitions**.

**Intelligence Missions, not AI Feeds.** Feedly’s AI Feeds are powerful and still make the human configure the system (companies, concepts, sources, exclusions, queries). That is the maintenance tax Briefly exists to remove. Briefly asks what the founder is trying to achieve, then constructs missions (competitive moves, technology risk, market questions) from operating context.

**Relevance DNA, not only “less like this.”** Learn *why* a signal was not useful (already knew, not important, wrong company, doesn’t affect me, duplicate, too speculative, wrong topic) **and** learn from behavior: open < ask < track < Decision Thread < action. Ignoring repeatedly is negative.

**Event clustering + delta, not article dedup.** “OpenAI launched GPT-6” covered by 26 publications is one event. Tomorrow’s brief reports only what changed overnight (pricing, API availability, benchmarks).

**Living entity memory, not a company insights page.** What Anthropic *means to this user*: relationship, briefs appeared in, Decision Threads, last-30-day state deltas. Surface inside the brief and Ask — no `/companies` page while the surface freeze holds.

**Personal weak-signal radar, not global trends.** Popularity ≠ relevance. Score velocity × source diversity × novelty × entity/company/question relevance × credibility.

**Temporal Ask Briefly, not chat-with-articles.** “How has Anthropic’s strategy changed in six months?” and “Which assumptions behind our roadmap are getting weaker?” require current evidence + snapshots + previous briefs + user conclusions + threads + outcomes.

**Decision Threads, not boards.** Organize around questions and beliefs, not saved content.

**Action compiler, not report generation.** Signal → impact → decision → recommended response → approval → action → outcome.

**Evidence transparency.** Every recommendation distinguishes fact, inference, personal impact, and recommendation, each traceable.

**Dynamic tracked universe.** Lists evolve (“Tavily keeps appearing in your agent ecosystem — track it?”).

**Conditional watches.** “Tell me if OpenAI cuts API prices more than 20%” — semantic conditions, not keyword alerts.

---

## What not to copy

| Don’t copy | Why |
|---|---|
| Infinite RSS/feed-centric UI | Turns Briefly back into information consumption |
| Complex AI Feed builder | Violates zero-maintenance |
| Hundreds of configurable filters | High cognitive cost |
| Generic global trends dashboard | Interesting ≠ actionable |
| Disconnected extra pages | Surface freeze; deepen the brief |
| Chat-with-selected-articles as core AI | Commodity |
| Article-count metrics | Optimizes consumption, not decisions |
| Enterprise collaboration too early | Before founder retention |
| Newsletter-builder complexity | Different product |
| Thousands of generic taxonomies | Start with founder-relevant signal classes |

Feedly Market Intelligence list price (~$1,600–$2,400/month, annual) leaves a gap for founder/operator decision intelligence at the $49–$99 band in the moat roadmap. Do not compete with Feedly enterprise sales first.

---

## Five capabilities to build (in order)

1. Signal ontology and change detection  
2. Intelligence missions / tracked universe  
3. Event clustering + delta  
4. Company impact + evidence bundle  
5. Decision Threads  

Those five move Briefly from a personalized news product to a personal decision-intelligence system. Implementation status lives in [`FEATURES.md`](FEATURES.md).

---

## Moat

Not sources, summaries, or the knowledge graph. Those can be copied.

```
World → external signals → company context → relevance DNA
     → entity history → Decision Threads → decisions → actions → outcomes
     → system learns → better next decision
```

Feedly has spent years on the left-hand side (understanding the world). Briefly does not need to win that entire game. Own the relationship between the changing world and **one company’s ongoing decisions**.
