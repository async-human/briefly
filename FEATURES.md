# Briefly — implemented features

Living log of what is **in the product**, mapped to the destination in [`FEEDLY_DIRECTION.md`](FEEDLY_DIRECTION.md) and the gates in [`MOAT_ROADMAP.md`](MOAT_ROADMAP.md).

Update this file whenever a capability ships, is reshaped, or is deliberately parked. A rising feature count is not progress unless it moves a signal, a decision, or a retained user.

**Last updated:** 2026-08-31 (direction doc expanded to the full Feedly analysis)

---

## Destination (do not drift)

> Know what changed, why it matters to you, what it changes about what you previously believed, and what you should do next.

Pipeline we are building toward:

```
Company context → Tracked universe → Signal detection → Event clustering
→ Change detection → Verification → Company impact
→ Decision thread + brief → Recommended action → Feedback → Relevance DNA
```

Articles are **evidence**, not the product object.

**Do not copy from Feedly:** feed builders, filter consoles, global trend dashboards, article-count metrics, chat-with-selected-articles as the core AI, extra top-level pages, enterprise collaboration, newsletter-builder complexity.

---

## How to log a feature

Add a row under **Shipped**, or a dated line under **Changelog**, with:

1. Capability name
2. Status: `shipped` · `partial` · `parked`
3. Where it lives (route, table, or service)
4. What it is **not** yet (honest limit)

Do not log refactors, copy tweaks, or infra unless they change a user-visible decision loop.

---

## Five capabilities to build next

From the Feedly analysis. Status is against the *finished* version, not a first slice.

| # | Capability | Finished version | Status | In repo today |
|---|---|---|---|---|
| 1 | **Signal ontology & change detection** | Typed state transition: entity, previous state, new state, confidence, evidence | `partial` | Three keyword detectors (`pricing_positioning`, `model_api`, `product_release`) write `signals` + `signal_evidence`. `previous_state` is the last signal’s `new_state` when present — not a versioned entity snapshot. |
| 2 | **Intelligence missions / tracked universe** | Briefly builds monitoring strategy from operating context. Universe evolves. | `partial` | Onboarding captures company / competitors / stack / questions and seeds `watched_entities`. User still adds watches by name. No auto-generated missions, no “track Tavily?” evolution. |
| 3 | **Event clustering + delta** | One event, many sources; brief reports only what changed since last seen | `partial` | Cross-source article dedup exists. No event object, no overnight delta on a previously reported launch. |
| 4 | **Company impact + evidence bundle** | Fact / inference / personal impact / recommendation, all cited | `partial` | Digest items expose source, claim, passage, corroboration, contradiction, detector, confidence. Read view and watching panel can rate Useful / Noise / Duplicate / Wrong. Layers are not yet labeled fact vs inference vs impact. |
| 5 | **Decision Threads** | Persistent question, belief, evidence for/against, confidence, open questions | `not started` | Ask Briefly, memory connections, and knowledge graph exist. No `decision_threads` object. |

---

## Feedly → Briefly matrix

| Feedly | Briefly version | Priority | Status |
|---|---|---|---|
| AI Feeds | Intelligence Missions (from company context, not a query builder) | Very high | Not started (watched entities are a precursor) |
| Strategic Moves | Signal ontology / state changes | Very high | Partial (3 detectors, keyword-classed) |
| Less Like This | Relevance DNA (reason + behavior + action) | Very high | Partial (dismiss / act / decision-changed events; no “why not useful” reasons) |
| Deduplication | Event clustering + delta | Very high | Partial (article dedup only) |
| Company Cards | Living entity memory inside brief / Ask | High | Not started (watching alerts + graph, no personal entity card) |
| Emerging Trends | Personal weak-signal radar | High | Not started |
| Ask AI | Temporal Ask Briefly | Very high | Partial (Ask exists; not over beliefs, threads, or outcomes) |
| Boards | Decision Threads | Very high | Not started |
| AI Actions | Action compiler (preview → approve → execute → outcome) | Later | Partial precursor (email drafts with approval) |
| Automated newsletter | Adaptive brief by audience | Team phase | Parked |
| Company lists | Dynamic tracked universe | High | Partial (static watches + onboarding seed) |
| Alerts | Conditional semantic watches | High | Partial (watch monitor + proactive push; not “if price drops >20%”) |
| Citations | Evidence bundles | Very high | Partial (Sprint 3 bundles on the brief) |
| Analytics | Decision analytics | High | Partial (`GET /api/v1/signals/eval` precision; no decision/action dashboard) |

---

## Shipped

Grouped by the decision loop, not by UI page.

### Observe

| Feature | Where | Limit |
|---|---|---|
| Source ingestion (RSS, YouTube, Reddit, URL, Gmail, Readwise, email forward) | `backend/briefly_api/services/connectors/`, overnight workers | Not an open-web crawler |
| Nightly collect → score → plan → write → deliver | `agents/pipeline.py` | Still article-centric stages |
| Watched entities + scored alerts | `watched_entities`, `entity_alerts`, dashboard watching panel | Keyword/semantic watch, not missions |
| Operating context (company, product, customers, competitors, stack, goals, risks, questions) | `user_profiles.operating_context`, onboarding + settings | Used in prompts/fallbacks; not yet a full impact model |
| Onboarding seeds watches from competitors and stack | `operating_context.seed_tracked_entities_from_context` | No mission objects |

### Detect change

| Feature | Where | Limit |
|---|---|---|
| First three founder detectors | `services/signals/detectors.py` | Rule/keyword classify; do not add a fourth until precision holds |
| `signals`, `signal_evidence`, `signal_impacts`, `signal_feedback` | migration `016` | `entity_snapshots` not built |
| Watch hits persist as market signals | `services/watch/monitor.py`, `services/signals/persist.py` | `previous_state` often empty on first sighting |
| Watching alerts pinned into **What’s new** when the URL is not already in the brief | `services/signals/attach.py` | Not a dedicated watching section |

### Connect history / assess impact

| Feature | Where | Limit |
|---|---|---|
| Six-point brief: what changed, why it matters, who it affects, suggested action, memory, confidence | digest items + read view + email | Writer copy; not always signal-backed |
| Evidence bundle on digest items (sources, claim, passage, corroboration, contradiction, previous/new) | `digest_response.py`, read view | Fact vs inference vs impact not separated in UI |
| Memory connections / “you’ve been tracking this” | writer + read callouts | Not Decision Threads |
| Citations and contradiction flags | citation verifier, enrichment cache | |
| Knowledge graph | `/graph` | Parked as a priority surface; do not expand |

### Recommend / learn

| Feature | Where | Limit |
|---|---|---|
| Decision events: opened, clicked, saved, asked, tracked, dismissed, acted, decision-changed | `/api/v1/feedback`, read view | Behavioral; not outcome-labeled |
| Signal quality labels: useful, noise, duplicate, wrong | `/api/v1/signals/{id}/feedback`, read view + watching panel | Writes `signal_feedback`; no ranking loop yet |
| Precision snapshot | `GET /api/v1/signals/eval` | Internal eval, not a user dashboard |
| Ask Briefly with grounded citations | `/ask`, orb | Not temporal over decisions |
| Email drafts with human approval | `email_drafts` | Not the action compiler |
| Proactive / interrupting alerts (capped) | `agents/proactive/` | Not conditional semantic watches |

### Habit / commercial (supporting)

| Feature | Where | Limit |
|---|---|---|
| Dashboard, read mode, history, settings | existing app routes | Surface freeze: no new top-level pages |
| Founder-positioned landing | `FounderIntelligenceLanding.tsx` | |
| Founding-member billing | upgrade page | Roadmap test price is $49–$99; product still $9 founding |

---

## Parked until a gate

Do not start these because the last file compiled.

- Decision Threads v0
- Action cards (team memo / investigation task) beyond email drafts
- Fourth detector (funding, hires, GitHub breaking changes, website diffs)
- Intelligence mission builder or Feedly-style AND/OR/NOT feeds
- `/companies` or entity-card page (cards belong in the brief and Ask)
- Personal trend radar page
- Adaptive CEO/CTO/Product briefs
- Team workspaces, Slack delivery, newsletter builder
- Desktop / extra voice / extra personas as roadmap priority

---

## Changelog

| Date | Commit | What shipped |
|---|---|---|
| 2026-08-31 | `500998f` | `MOAT_ROADMAP.md` at repo root |
| 2026-08-31 | `a716d5b` | Evidence bundles on the brief; watching alerts pinned into What’s new; signal ratings; `signals/eval` |
| 2026-08-31 | `f472450` | Restore `isActionable` (Vercel typecheck) |
| 2026-08-31 | `06419c5` | Operating context, founder onboarding, decision events, `signals` / evidence / impact / feedback tables, first three detectors |

Add new rows at the top as work lands on `main`.
