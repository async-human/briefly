# Dashboard surface rule

**Rule:** Briefly may process 10,000 signals, understand 100 developments and maintain 50 decision threads — but the home screen should make the user think about only **3–5 things**.

The dashboard answers only:

1. What changed?
2. Why should I care?
3. Is there anything I should do?

Everything else is progressive disclosure. If the user still has to scan twenty cards to find the three that matter, Briefly has not solved overload — it has summarized it.

Full destination: [`FEEDLY_DIRECTION.md`](FEEDLY_DIRECTION.md). Implementation log: [`FEATURES.md`](FEATURES.md).

---

## Three layers

| Layer | Attention | What it is |
|---|---|---|
| **1 · Glance** | ~10 seconds | Morning Pulse + 2–3 Intelligence Cards. Not articles. Not long summaries. |
| **2 · Understand** | One tap, in place | Why it matters, connected decision, confidence, a small meaning-visual. |
| **3 · Investigate** | Only if they want depth | Ask Briefly, sources, history, competing evidence, the rest of the brief. |

## One object, not a widget farm

Do not add Trend / Competitor / Decision / Signal / Entity / Alert / News widgets.

Use one **Intelligence Card**. Its grammar changes:

- **Change** — a state transition (price, launch, API).
- **Pattern** — emerging coverage with real source counts, never a fake trend %.
- **Decision** — something previously believed may need a second look (contradiction, conflicting evidence).

Same footprint. Different visual grammar.

## Morning Pulse

Signature of the home screen. Not “we scanned N articles.”

> Good morning. Your world moved a little today.  
> 3 important changes · 1 decision affected · 0 urgent.

A quiet constellation of tracked entities: most nodes faint, today’s changes softly lit, one connection drawn if we know it.

## Motion

Motion means **something changed**: a node lighting, a sparkline drawing, confidence shifting, a link appearing.

Do not use endlessly moving gradients, pulsing cards, auto carousels, or spinning counters.

Respect `prefers-reduced-motion`.

## Visuals must beat text

A price drop, a momentum sparkline, a belief-confidence shift, or a May → June → Today story line — only when the numbers are real. If we do not have previous state, source count, or confidence, omit the visual. Never invent a metric.

## What stays off the home screen

Calendar, connections, source discovery, the full briefing list, insights, listening, and email drafts remain available. They are not the first thing the eye hits. The briefing is Layer 3: “the rest of today,” after the pulse.
