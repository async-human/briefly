# Briefly Product Roadmap

**North star:** An agent-centric second brain that automates personal knowledge curation with minimal ongoing friction — passive ingestion + active brain dumps → a living **Personal Relevance Vector** → a noise-free morning intelligence report mapped to the user's stack, projects, and cognitive context.

**Current baseline (June 2026):** ~75–80% of the V1 daily-brief core is built. ~58–65% of the full autonomous second-brain vision. This doc sequences the gap into three shippable phases.

---

## Phase overview

| Phase | Theme | User promise | Timeline (suggested) |
|-------|--------|--------------|----------------------|
| **V1** | *Trust the brief* | "Every morning I get a sharp, personalized brief from what I follow — and I can dump thoughts that shape tomorrow." | **Now → 4 weeks** |
| **V1.5** | *Passive second brain* | "Briefly builds and refreshes my knowledge base while I sleep — I barely manage sources." | **Weeks 5–12** |
| **V2** | *Active cognitive partner* | "Briefly connects dots I missed, answers questions over everything I've seen, and creates artifacts." | **Months 4–9** |

---

## V1 — Trust the brief *(ship & stabilize)*

**Goal:** Make the morning brief reliable, transparent, and differentiated enough that power users return daily. No new major surfaces — harden what exists.

### Already built (protect & polish)

| Capability | Status | Key code |
|------------|--------|----------|
| 14-agent pipeline (fetch → relevance → dual-pool plan → write → deliver) | ✅ Wired | `backend/briefly_api/agents/pipeline.py` |
| Dual-pool sections: **What's new** + **Highly relevant to you** | ✅ Wired | `agents/planner.py`, `services/digest_sections.py` |
| Personal Relevance Vector (pgvector + EMA from brain dumps & signals) | ✅ Wired | `agents/relevance.py`, `services/brain_dump.py`, `agents/learning.py` |
| Brain Dump text + voice (STT → structure → profile update → brief inject) | ✅ Wired | `api/routes/capture.py`, `BrainDumpOverlay.tsx` |
| Source connectors (RSS, YouTube, Reddit, URL, Gmail, Readwise, email forward) | ✅ Wired | `services/connectors/` |
| Scheduled + on-demand generation (same pipeline) | ✅ Wired | `workers/scheduler.py`, `services/briefing.py` |
| Skipped-items transparency (reading mode) | ✅ Wired | `digest.meta.skipped`, read UI |
| Gmail metadata discovery + nightly footprint RSS auto-add | ✅ Partial | `gmail_discovery.py`, `footprint_scanner.py` |

### V1 must-ship (gaps to close)

#### 1. Reliability & empty states
- [ ] **Pipeline never saves 0-item digests** when planner selected items (writer fallbacks — started; add persist guard).
- [ ] **Harden profile/topic_cluster parsing** across all agents (writer crash from `source_weight` entries — fixed; audit `learning.py`, `interest_discovery.py`).
- [ ] **Integration tests** for `run_for_user`: mock sources → non-empty digest with sections.
- [ ] **Frontend:** clear "Regenerate briefing" when digest is empty but sources exist.

#### 2. Brief quality bar
- [ ] **"Why this matters to you"** always references profile (role, interests, recent brain dumps) — enforce in `briefing_writer.py` prompt + validator.
- [ ] **Never-show & topic filters** respected end-to-end (relevance agent ✅; verify settings UI → DB → pipeline).
- [ ] **RSS catalog audit** — all suggested sources validate; dead feeds removed (`scripts/audit_catalog_feeds.py` in CI).

#### 3. Voice capture production-grade
- [ ] Audio-first periodic Whisper during recording (preview endpoint ✅).
- [ ] Confirm ffmpeg on Railway for WebM → WAV.
- [ ] Fallback path when final STT fails but preview transcript exists.

#### 4. Zero-friction basics (V1 scope only)
- [ ] Auto-regenerate brief on source add/remove (✅ dashboard).
- [ ] **Stale landing roadmap** — update `Roadmap.tsx` (brain dump is shipped).
- [ ] Onboarding: reduce to **profile + 1 source + first brief**; defer advanced integrations.

#### 5. Ops & economics (minimum)
- [ ] Env checklist in deploy docs: `RESEND`, LLM, embeddings, STT, OAuth.
- [ ] Log pipeline stage timings + item counts per run (observability).
- [ ] Target: **&lt; $0.50/user/day** at V1 scale (real-time APIs only; batch deferred to V1.5).

### V1 success metrics
- ≥ **60% D7 retention** for users who complete first brief.
- ≥ **90%** of generate runs produce ≥ 5 items when ≥ 2 fetchable sources exist.
- ≥ **20%** of active users submit ≥ 1 brain dump / week.
- Median time-to-first-brief **&lt; 3 min** after onboarding.

### V1 explicit non-goals
- Paywall breaking, overnight full-text batch, audio briefs, Ask Briefly chat, serendity engine, camera capture.

---

## V1.5 — Passive second brain *(ingest while you sleep)*

**Goal:** Shift from "briefing app that fetches at 7am" to "system that continuously ingests, embeds, and scores — morning run is mostly *select + write*."

### Architecture shift

```
TODAY (V1)                          TARGET (V1.5)
─────────────                         ───────────────
User's digest_time ──► fetch+score   Overnight worker ──► RawContent + embeddings
         │                                      │
         └──► write brief (all in one)  Morning worker ──► plan + write from DB pool
```

### 1. Decouple ingestion from generation

| Work item | Detail |
|-----------|--------|
| **Ingestion worker** | New job: `workers/ingestion_worker.py` — per user, fetch all active sources → upsert `RawContent` → embed → score vs profile. |
| **Job queue** | Wire **Redis** (already in config): Celery, ARQ, or Dramatiq. API + scheduler enqueue; worker(s) on Railway. |
| **Generation worker** | Morning job reads **pre-ingested pool** (last 24–48h) instead of live fetch. `collector` agent becomes "load from DB" with optional incremental fetch. |
| **Idempotency** | Content keyed by `content_hash`; skip re-embed if unchanged. |

### 2. True passive footprint

| Work item | Detail |
|-----------|--------|
| **Expand footprint scanner** | Beyond RSS auto-add: track sender frequency, auto-create `email` sources for top newsletters without UI confirm (opt-out in settings). |
| **Gmail incremental sync** | Store `historyId` / last sync; nightly pull **new** messages only → `RawContent` (not at brief time). |
| **Click-to-discover v2** | Lower threshold; surface "Briefly found a feed for X — added automatically" toast. |
| **Interest-driven auto-sources** | `interest_discovery.py` → auto-add catalog RSS when confidence &gt; threshold (user toggle: "Let Briefly expand my sources"). |

### 3. Full-text strategy (honest, not magic)

Paywall automation is expensive and legally gray. V1.5 picks **lanes**:

| Lane | Approach |
|------|----------|
| **A. RSS / public web** | Existing `url_scraper` + trafilatura at ingest time. |
| **B. Email & newsletters** | Full body already in Gmail connector — ingest overnight. |
| **C. User-owned access** | Readwise, forwarded email, YouTube transcripts. |
| **D. Publisher RSS only** | No paywall bypass; summarize abstract + link. |

- [ ] **Ingest-time scrape** — move URL expansion from pipeline fetch to ingestion worker.
- [ ] **Quality gate** — drop items with &lt; 200 chars clean text unless title+URL suffice.
- [ ] **Explicit UX copy** — "Briefly reads what you have access to; it doesn't break paywalls."

### 4. Batch APIs & cost (from `gemini_prod_strategy.md`)

- [ ] Route **embed batch**, **dedup clustering**, and **brief writer** through provider Batch APIs (11pm–5am user TZ).
- [ ] Morning job consumes batch results → target **$0.15–0.30/user/day**.
- [ ] Feature flag: real-time path for "Generate now" button; batch path for scheduled.

### 5. Visible intelligence (deepen trust)

- [ ] Dashboard tab: **"What Briefly ingested last night"** — counts by source, failures, auto-added sources.
- [ ] **"Profile updated"** feed — "Brain dump added 3 keywords", "Learning shifted embedding after you saved X".
- [ ] Email preheader: skipped-note from writer (`skipped_note` already partially wired).

### 6. Friction removals

- [ ] **Sources optional at onboarding** — Gmail connect alone can seed first brief via footprint.
- [ ] **Silent first brief** — auto-generate after onboarding without button click.
- [ ] **Digest time = delivery only** — ingestion decoupled from delivery time.

### V1.5 success metrics
- ≥ **70%** of brief items come from content ingested **before** morning generate (not live fetch).
- ≥ **30%** of users on **auto-source expansion** (opt-in) with &lt; 5% opt-out rate.
- Ingestion worker p95 **&lt; 10 min** per user per night.
- Unit cost **≤ $0.30/user/day** at 1k DAU.

---

## V2 — Active cognitive partner *(connect, ask, create)*

**Goal:** Briefly stops being "the best morning email" and becomes **the place you think with your accumulated context** — proactive synthesis, conversational retrieval, multimodal capture.

Aligned with `gemini_prod_strategy.md` sections 1–4 (V3/V4 features pulled forward where feasible).

### 1. Serendipity & dot-connecting engine

| Work item | Detail |
|-----------|--------|
| **Weekly graph agent** | New `agents/serendipity.py` — embed all `RawContent` from last 90 days; find cross-domain pairs (old save ↔ new email/brain dump). |
| **Notification / brief section** | "Connections Briefly noticed" — 1–3 synthesized bridges per week. |
| **Memory upgrade** | Replace keyword `memory.py` threads with embedding-cluster story arcs. |

### 2. Ask Briefly (RAG over personal corpus)

| Work item | Detail |
|-----------|--------|
| **Chat API** | `POST /api/v1/ask` — retrieve top-k from `ContentEmbedding` + recent digests + brain dumps. |
| **Citations required** | Every answer links to source URL / dump / email. |
| **"Where did I see that?"** | Semantic recovery across all ingested types. |
| **UI** | Dashboard side panel or `/ask` — chief-of-staff tone. |

### 3. Intent-based deep research agents

| Work item | Detail |
|-----------|--------|
| **Mission queue** | User prompt → planner decomposes → sub-agents (search corpus, fetch new Reddit/RSS, synthesize). |
| **Artifact output** | Markdown report, outline, or flashcards — stored + optional brief inject. |
| **Async UX** | "Briefly is researching…" → notify when done (email or push). |

### 4. Multimodal capture expansion

| Work item | Detail |
|-----------|--------|
| **Lock-screen / widget voice** | PWA or native wrapper for one-tap brain dump (extend existing overlay). |
| **Camera → brain** | Photo upload → OCR (Vision API) → structure → graph node (extends brain dump pipeline). |
| **Auto cross-reference** | New dump tagged against last 48h ingested items (LLM + embedding nearest neighbors). |

### 5. Dynamic audio brief (optional premium)

| Work item | Detail |
|-----------|--------|
| **Two-host podcast script** | Writer agent variant — dialogue filtered through user goals. |
| **TTS** | ElevenLabs / OpenAI TTS; 5-min cap. |
| **Delivery** | Link in email + in-app player. |

### 6. Platform & agent ops (V2 hardening)

| Work item | Detail |
|-----------|--------|
| **Agent config** | Skip/disable agents via env; per-user feature flags. |
| **Separate worker pools** | Ingestion, generation, research, weekly serendipity. |
| **Evaluation harness** | Golden profiles + source fixtures; score relevance@k, section balance, writer quality. |

### V2 success metrics
- ≥ **40%** WAU use Ask Briefly ≥ 1×/week.
- ≥ **25%** open weekly serendipity digest.
- NPS **≥ 50** among 90-day retained users.
- Research missions complete with citation coverage **≥ 95%**.

---

## Cross-phase technical debt (address incrementally)

| Item | V1 | V1.5 | V2 |
|------|----|----|-----|
| `source_weights` in `topic_clusters` hack | Fix schema | ✅ | — |
| Monolithic FastAPI process | Accept | Split workers | Full queue |
| Redis unused | — | ✅ Required | Scale |
| No agent tests | Smoke tests | Ingestion tests | Eval harness |
| Landing page vs product drift | Fix copy | — | — |

---

## Mapping vision pillars → phases

| Vision pillar | V1 | V1.5 | V2 |
|---------------|----|----|-----|
| Multi-agent architecture | Sequential pipeline stable | Queued agent stages | Distributed agents + missions |
| Passive digital footprint | Gmail discover + footprint scan | Overnight Gmail + auto-sources | Full passive index |
| Paywall / full-text | On-demand scrape | Ingest-time scrape (honest lanes) | + user-provided sources only |
| Overnight processing | Footprint only | Ingest + batch LLM | + weekly serendipity graph |
| Brain Dump | Text + voice ✅ | + widget, auto cross-ref | + camera OCR |
| Personal Relevance Vector | EMA + relevance agent ✅ | Nightly re-score all pool | Graph-aware vector |
| Morning tailored brief | Dual-pool + writer ✅ | Pre-ingested pool | + audio + connections |
| Zero friction | Manual sources OK | Auto sources, silent brief | Ask + research, invisible ops |

---

## Suggested next 2 sprints (V1 close-out)

**Sprint A (stability)**
1. Pipeline persist guard (no empty digests).
2. RSS catalog CI audit + fix broken feeds.
3. Profile/cluster defensive parsing audit.
4. Update landing `Roadmap.tsx`.

**Sprint B (trust + delight)**
1. "Profile updated" / "Ingested last night" transparency panel.
2. Writer validator for `why_it_matters` personalization.
3. Onboarding shorten → auto-first-brief.
4. Basic pipeline integration test.

---

## Document history

| Date | Change |
|------|--------|
| 2026-06-01 | Initial V1 → V1.5 → V2 roadmap from codebase audit + product vision |

*Companion docs: `gemini_prod_strategy.md` (feature imagination), `briefly_prd_v2.docx` (requirements).*
