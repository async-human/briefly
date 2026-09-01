# Briefly — Product Roadmap

**Single source of truth** for what Briefly is, where it is going, and what ships next.

**Companion docs (different jobs — not roadmaps):**

| Doc | Purpose |
|-----|---------|
| [`PRODUCT.md`](PRODUCT.md) | Scope discipline, feature map, stop rule |
| [`VISION.md`](VISION.md) | Identity evolution (read → remember → act) |
| [`FEATURES.md`](FEATURES.md) | Living log of what has shipped |
| [`SURFACE.md`](SURFACE.md) | Dashboard glance-layer UX rules |
| [`design.md`](design.md) | Visual design system |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stack and agent pipeline ADR |

**Last updated:** 2026-09-01

---

## 1. What Briefly is

### One-liner

> **Briefly is decision intelligence for AI founders:** it monitors the sources and entities you care about, remembers how evidence and assumptions evolved, and turns material changes into cited briefs and reviewable next steps — with zero PKM upkeep.

### Spine (every feature must connect here)

> Briefly reads everything you follow, remembers it, and hands you one personal briefing you can talk to.

Three layers, in roadmap order:

1. **Read** — ingest only what the user chose; morning brief + proactive alerts
2. **Remember** — compounding memory: threads, snapshots, decision history, Ask Briefly
3. **Act** — grounded drafts and actions with human approval (earned, not yet broad)

### Beachhead

**AI/software founders and solo builders** (5–50 person companies) who:

- Subscribe to too much and carry backlog guilt
- Abandoned Notion/Obsidian because upkeep became their job
- Pay for time-savers; falling behind has direct business cost

Broader personas (investors, PMs, engineers) use the same engine later — **one persona deep first.**

### Who it is not for

Casual consumers and anyone wanting a general assistant. Briefly wins on **your sources + your history**, not the open web.

---

## 2. Canonical decisions (resolves old doc conflicts)

These replace contradictory guidance spread across retired roadmap files.

| Topic | **Canonical decision** | Retired / wrong direction |
|-------|------------------------|---------------------------|
| Primary identity | Decision intelligence + cited brief | Generic “second brain” / PKM app |
| Core pain | **Maintenance tax** (no tagging, filing, revisiting) | “Too much information” alone |
| Product loop | Observe → detect change → connect history → assess impact → recommend action → approve → learn | Article feed → summarize |
| Phase gates | Commercial + retention proof before next phase | Ship features because code is done |
| Graph UI | **Parked** — surface history as sentences in brief/Ask | Knowledge graph as hero surface |
| Ask Briefly | **Shipped** — corpus-first chat (`/ask`, orb) | “V2 non-goal” (obsolete) |
| Free tier | **Shipped** — free tier exists for activation | “No free beyond trial” (aspirational only) |
| Pilot pricing | Test **$49–99/mo** with concierge pilots | Must match $9 founding on site today |
| Voice / WhatsApp / desktop | Phase 3+ ambient layer | Priority now |
| Feedly-style AI Feeds | **Do not build** query-builder feeds | Copy Feedly’s filter console |
| Detectors | **Three first** (pricing, API/model, product/changelog) | Add fourth before precision holds |
| New top-level surfaces | **Frozen** until Today + Memory cohere | New pages per feature |

---

## 3. North star and moat

### North star metric

> **Weekly paid accounts that take at least one evidence-backed action from Briefly — or confirm a Briefly signal changed or prioritized a decision.**

Supporting: useful-signal rate, citation coverage, D30/D60 retention, active decision threads, time to first decision-worthy signal.

### The moat (four compounding assets)

1. **Context** — company, competitors, stack, strategic questions
2. **Temporal intelligence** — versioned changes, threads, invalidated assumptions
3. **Decision outcomes** — what was accepted, edited, acted on, result
4. **Workflow embed** — shared watches, team memory (later)

**Moat maturity today:** ~Level 1–2 (personalized brief + pieces of temporal memory). Not commercially proven until retention and willingness to pay validate accumulated context.

### Four defensible wedges (pick depth, not breadth)

1. **Compound context** — automatic graph/memory; switching cost grows weekly
2. **Write-back** — track entity, save thread, draft memo (approval-gated)
3. **Curation / packs** — high-signal founder universe, not “connect RSS”
4. **Ambient delivery** — 08:00 brief, proactive alerts (voice/messaging later)

---

## 4. Product loop and objects

### User-facing promise

> Know what changed, why it matters **to you**, what it changes about what you believed, and what you should do next.

### Pipeline (articles are evidence, not the product)

```
Company context → Tracked universe → Signal detection → Event clustering
→ Change detection → Verification → Company impact
→ Decision thread + brief → Recommended action → Feedback → Relevance DNA
```

### Core objects

| Object | Purpose |
|--------|---------|
| `tracked_entities` / watches | Monitoring universe |
| `entity_snapshots` | Versioned observed state |
| `signals` + `signal_evidence` | Material change + provenance |
| `signal_impacts` + `signal_feedback` | Personal impact + quality labels |
| `decision_threads` | Persistent question, belief, evidence |
| `digest` / brief items | Daily decision-oriented delivery |
| Ask threads | Corpus-first Q&A with citations |

### Brief format (six fields)

What changed · Why it matters · Who/what it affects · Past context · Suggested action · Evidence trail

### Dashboard surface rule

Home answers only: **What changed? Why care? Anything to do?** — 3–5 things at glance (Morning Pulse + ≤3 Intelligence Cards). See [`SURFACE.md`](SURFACE.md).

### vs Feedly (borrow machinery, not philosophy)

- **Borrow:** signal typing, dedup, entity extraction, evidence bundles
- **Do not copy:** feed builders, filter consoles, global trend dashboards, article-count metrics, chat-with-selection as core, enterprise collab complexity
- **Briefly goes further:** state transitions + personal/company impact + decision threads + approved actions

---

## 5. Phased roadmap

Timelines are planning ranges. **A phase starts only when the previous gate is met** — not when the last ticket closed.

### Phase 0 — Paid validation *(weeks 0–4)*

**Promise:** Every morning, the few external changes that could affect my company — connected to my context, with what deserves action.

**Work:** Founder positioning, structured operating context onboarding, concierge pilots, charge from day one, instrument decision events.

**Gate:** 10 paying pilots · 5 active 4+ weeks · 3 “would be seriously disappointed” · 30% WAU with ≥1 decision-worthy signal/week.

**If gate fails:** change niche, universe, or brief format — not more features.

---

### Phase 1 — Trustworthy signal engine *(weeks 5–10)* **← current focus**

**Promise:** Briefly notices changes I cannot afford to miss and shows why they matter.

**Deliverables:**

- Tracked universe with live monitoring status (pending / live / hot)
- Change detectors: pricing, API/model, product/changelog (no fourth until precision holds)
- Evidence bundles: previous vs new state, confidence, corroboration
- Six-part decision brief + evaluation harness (`signals/eval`)
- Engineering hardening: worker/web split, scheduler reliability, rate limits, cost ledger

**Gate:** ≥75% precision top-5 signals · <15% false-positive on alerts · ≥95% evidence coverage · ≥40% D30 paid retention.

**Status (see [`FEATURES.md`](FEATURES.md)):** Partial — three detectors, snapshots, threads v0, Ask Briefly, glance dashboard shipped; missions, full impact model, ranking loop not done.

---

### Phase 2 — Temporal decision memory *(months 3–5)*

**Promise:** Briefly remembers what we believed, what changed, and what to reconsider.

**Deliverables:** Decision Threads v1 (confidence from verified evidence), assumption invalidation inline in brief, hybrid retrieval for Ask, outcome feedback labels.

**Gate:** ≥50% D60 retention · 40% WAU get useful historical connection/week · 25% WAU use Decision Threads · 95% citation correctness in decision Ask.

---

### Phase 3 — Closed-loop actions *(months 5–8)*

**Promise:** When something important changes, Briefly prepares the work to respond.

**Actions (approval-gated):** team memo, battlecard update, cost-impact comparison, investigation task, stakeholder email draft, watch/thread updates.

**Architecture:** Propose → evidence → preview → edit → approve → execute → audit → outcome.

**Gate:** 25% paid WAU execute/export an action · 70% drafts accepted with light edits · zero unauthorized external actions.

---

### Phase 4 — Team intelligence *(months 8–12)*

**Promise:** One shared memory of what changed, what we decided, and why.

Shared watches, threads, decision log, Slack delivery, pre-meeting context.

**Gate:** 20 paying teams or $25k MRR · 70% 90-day team retention · team ARPA ≥$250/mo.

---

### Phase 5 — Distribution & packs *(months 12–18)*

Self-serve competitor onboarding, founder intelligence pack, shareable cited cards, referral loops.

**Gate:** $50k MRR · one channel ≥30% new paid · 70% self-serve activation · CAC payback <6 months.

---

### Phase 6 — Category leadership *(months 18–36)*

Improve precision/latency/actions before new personas. Enterprise controls only on demand. Target **~$100k MRR** via higher ARPA (founder Pro + teams), not 2,000 users at $49.

---

## 6. Next 90 days (concrete sequence)

| Sprint | Deliverable | Exit evidence |
|--------|-------------|---------------|
| 1 | Scope freeze + operating context + instrumentation | 5 pilots configured |
| 2 | Signals model + 3 detectors | Reviewable signal records |
| 3 | Evidence-backed six-part brief | Founder-rated top signals |
| 4 | Ranking / eval loop | Top-5 precision → 75% |
| 5 | Decision Threads v1 | ≥1 thread per active pilot |
| 6 | First action card (memo or task) | ≥5 approved exports |

**Do not start:** fourth detector, mission builder, `/companies` page, team workspaces, Feedly-style feeds, graph expansion, camera capture, desktop app.

---

## 7. Engineering track (platform maturity)

Parallel to commercial phases — harden the machine that delivers the brief.

### V1 — Trust the brief *(now → 4 weeks)*

- Pipeline never saves empty digests when sources exist
- Personalization validator on “why this matters to you”
- Voice capture production-grade (Whisper preview, ffmpeg on deploy)
- Integration tests for `run_for_user`
- Target: **< $0.50/user/day** at V1 scale

### V1.5 — Passive ingestion *(weeks 5–12)*

- Decouple overnight ingest from morning write (mostly shipped)
- Ingest-time scrape for public URLs; honest paywall copy
- Batch APIs for embed/dedup/writer → **$0.15–0.30/user/day**
- “What Briefly ingested last night” transparency (partial)

### V2 — Cognitive partner *(months 4–9, after Phase 2 gate)*

- Weekly serendipity / dot-connecting agent
- Deep research missions → markdown artifact
- Audio brief as personal podcast feed (not play-button-only)
- pgvector queries in Postgres (not in-memory KNN at scale)
- Separate worker pools + eval harness

---

## 8. Ask Briefly (chat)

**Status:** Phase A–B shipped.

- **Global Ask** — `/ask` + orb, one thread, corpus-first citations
- **Contextual follow-up** — from read view, saved, graph (partial)
- **Later:** proactive chat, async research missions

Chat closes the loop: **Ingest → Brief → Read → Ask → Learn → better Brief.**

Do not rebuild: `FollowUpThread`, `ContentEmbedding`, enrichment cache, graph deep links — extend them.

---

## 9. Anti-roadmap (do not build)

| Temptation | Why avoid |
|------------|-----------|
| Own voice/telephony infra | Use providers; moat is curation + memory |
| 50+ source integrations in V1 | Depth on 10 high-signal sources |
| Mobile app year 1 | Email + web + extension enough |
| Knowledge graph as primary UI | Demo-ware; sentences in brief win |
| Enterprise before $50k MRR | Solo founder; sales kills focus |
| Multi-language year 1 | English-first until PMF |
| Autonomous send/post/purchase | Human approval always until trust proven |
| New top-level nav pages | Deepen Today + Memory first ([`PRODUCT.md`](PRODUCT.md) stop rule) |

---

## 10. Pricing (current vs experiment)

| | Today (product) | Pilot experiment |
|--|-----------------|------------------|
| Free | 3 sources, limited brief | — |
| Pro | $9/mo founding | Test $49–99/mo with concierge |
| Team | Not shipped | $149–499/mo after Phase 4 gate |

Raise price when decision value and retention prove it — not when feature count grows.

---

## Document history

| Date | Change |
|------|--------|
| 2026-09-01 | **Consolidated** `MOAT_ROADMAP.md`, `PRODUCT_ROADMAP_V2.md`, `PRODUCT_ROADMAP_COMPLEMENT.md`, `FEEDLY_DIRECTION.md`, `CHAT_ROADMAP.md`, engineering `ROADMAP.md`, and retired `gemini_prod_strategy.md` into this file |
| 2026-08-31 | Moat roadmap and Feedly direction added at root |
| 2026-06-01 | Original V1 / V1.5 / V2 engineering roadmap |
