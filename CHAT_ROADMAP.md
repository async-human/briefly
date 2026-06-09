# Briefly — Chat Implementation Roadmap

**Product name:** Ask Briefly  
**North star:** Chat is how users *think with* their accumulated context — not a generic LLM. Every answer is grounded in what Briefly ingested, briefed, saved, or the user brain-dumped, with citations and graph links.

**Status:** Phase A + B in progress (see checkboxes below).

---

## Why chat belongs in Briefly

| Today | With Ask Briefly |
|--------|------------------|
| Morning brief is **push** | Chat is **pull** — questions at the moment of curiosity |
| Graph shows structure | Chat explains *why* things connect |
| Brain dump captures thoughts | Chat helps refine and act on them |
| Saves are a list | Chat answers “what did I read about X?” |

Chat closes the loop: **Ingest → Brief → Read → Ask → Learn → better Brief tomorrow.**

---

## Existing foundation (do not rebuild)

| Asset | Location | Chat use |
|-------|----------|----------|
| `FollowUpThread` + `messages` JSONB | `db/models.py` | Thread persistence |
| `ContentEmbedding` + pgvector | `content_embeddings` | Semantic retrieval |
| `ContentEnrichmentCache` | per user × content | Connection sentences, threads |
| `UserProfile` + `UserMemory` | clusters, never_show | Personalization + guardrails |
| `get_llm_adapter()` | `llm/adapter.py` | Completions |
| `get_embedding_adapter()` | `embeddings/adapter.py` | Query embedding |
| Knowledge graph + deep links | `/graph?node=` | “View in graph” from citations |
| Behavioral `followed_up` signal | `dashboard.py` feedback | Learning loop |

---

## Chat modes (phased)

### Mode 1 — Contextual follow-up *(Phase B)*
**Entry:** Read page, Saved, Graph inspector — “Ask about this”  
**Scope:** Anchor item + enrichment + top similar items  
**Thread:** `FollowUpThread.digest_item_id` / `content_id` set  

### Mode 2 — Global Ask *(Phase A)*
**Entry:** Sidebar **Ask**, `/ask`  
**Scope:** Full personal corpus (embeddings KNN + recent brief items)  
**Thread:** General Q&A, “where did I see that?”  

### Mode 3 — Proactive *(Phase C — later)*
Weekly connections, thread recaps, brain-dump follow-ups — Briefly starts the conversation.

### Mode 4 — Research missions *(Phase D — later)*
Multi-step async jobs → markdown artifact → optional brief inject.

---

## Phase A — Global Ask (MVP)

**Goal:** User can open `/ask`, ask a question, get a cited answer from their library.

### Backend

- [x] `POST /api/v1/ask` — message, optional `thread_id`
- [x] `GET /api/v1/ask/threads` — list recent threads
- [x] `GET /api/v1/ask/threads/{id}` — full thread
- [x] `services/ask_briefly.py` — retrieve → prompt → persist
- [x] Retrieval: embed query → cosine KNN over user `ContentEmbedding` (recent pool)
- [x] Context pack: profile blurb + top-k chunks labeled `[S1]…[Sn]`
- [x] LLM system prompt: chief-of-staff tone, citations required, no hallucination beyond sources
- [x] Response: `{ thread_id, message, citations[] }`
- [x] Unit tests for retrieval helpers (cosine rank, chunk formatting)

### Frontend

- [x] `/ask` page + `AskBrieflyView` (messages, input, citation cards)
- [x] Sidebar nav item **Ask**
- [x] `lib/askLinks.ts` — deep links
- [x] API types + `api.ask()`, `api.listAskThreads()`, `api.getAskThread()`
- [x] `loading.tsx` skeleton
- [x] Empty state + suggested prompts

### Success criteria (Phase A)

- Answer includes ≥1 citation when corpus has relevant content
- Thread persists across refresh
- p95 latency &lt; 8s on typical corpus (&lt; 300 embedded items)
- Zero answers that invent URLs not in context pack (spot-check)

### Non-goals (Phase A)

- Streaming SSE
- Proactive messages
- Multi-step research
- Voice input

---

## Phase B — Contextual follow-up

**Goal:** Ask from anywhere the user already has attention.

### Backend

- [x] `POST /api/v1/ask` accepts `content_id`, `digest_item_id`
- [x] Anchor item always in context pack (headline, summary, why_it_matters, enrichment)
- [x] On scoped ask: `DigestItem.had_follow_up` + `follow_up_depth` + `followed_up` signal

### Frontend

- [x] Read page — “Ask about this” (meta + why block)
- [x] Saved captures — “Ask” link
- [x] Graph inspector — “Ask about this” for item/thought nodes
- [x] `/ask?content=` and `/ask?item=` pre-fill scope + optional first-turn context banner

### Success criteria (Phase B)

- ≥10% of read sessions could open Ask (instrument later)
- Scoped threads show anchor title in thread list
- Citation [S1] is always the anchor when scoped

---

## Phase C — Polish & retention *(planned)*

| Item | Detail |
|------|--------|
| Streaming | `POST /ask/stream` SSE tokens |
| Thread titles | LLM-generated title from first message |
| Mobile | Bottom sheet Ask from FAB |
| Graph integration | “Discuss this thread” on thread nodes |
| Rate limits | Per-user daily ask cap + cost logging |
| Feedback | Thumbs on answers → learning signal |

---

## Phase D — Proactive & research *(planned)*

| Item | Detail |
|------|--------|
| Serendipity → chat | “Briefly noticed a connection…” opens pre-filled thread |
| Research queue | `POST /ask/research` async job |
| Artifacts | Store markdown reports linked to thread |
| Notifications | Email/push when research completes |

---

## API contract (stable)

### `POST /api/v1/ask`

```json
{
  "message": "What have I read about agentic AI lately?",
  "thread_id": "optional-uuid",
  "content_id": "optional-raw-content-uuid",
  "digest_item_id": "optional-digest-item-uuid"
}
```

**Response:**

```json
{
  "thread_id": "uuid",
  "assistant": {
    "role": "assistant",
    "content": "…",
    "citations": [
      {
        "ref": "S1",
        "content_id": "uuid",
        "title": "…",
        "url": "https://…",
        "source_name": "Stratechery",
        "snippet": "…",
        "kind": "article"
      }
    ],
    "created_at": "2026-06-09T12:00:00Z"
  }
}
```

### `GET /api/v1/ask/threads`

Returns `{ threads: [{ id, title, preview, content_id, digest_item_id, updated_at, message_count }] }`

### `GET /api/v1/ask/threads/{id}`

Returns `{ thread: { id, messages, content_id, digest_item_id, … } }`

---

## Retrieval design

```
User message
  → embed query
  → if scoped: load anchor (DigestItem / RawContent / EnrichmentCache)
  → fetch user's recent ContentEmbedding rows (limit 250, by ingested_at)
  → cosine similarity → top 7 (excluding anchor duplicate)
  → build context pack [S1..Sn]
  → LLM complete with history (last 8 turns)
  → parse [Sn] refs in answer → citations array
  → persist FollowUpThread.messages
```

**Guardrails:**
- `never_show` topics: filter retrieved chunks whose title/summary matches muted terms
- If no chunks above threshold: honest “I don't see that in your library yet”
- Max context ~6k tokens input

---

## UX map

```
Sidebar: Today | Saved | Graph | Ask | History | Settings

/ask
├── Thread list (left, desktop)
├── Conversation (center)
└── Sources cited (inline cards under each assistant turn)

Entry points:
  /dashboard/read/[id]  → Ask about this
  /saved                → Ask per capture
  /graph                → Inspector → Ask about this
  /ask?content=&item=   → Deep link
```

---

## File map (implementation)

| Area | Files |
|------|--------|
| Roadmap | `CHAT_ROADMAP.md` |
| Service | `backend/briefly_api/services/ask_briefly.py` |
| Routes | `backend/briefly_api/api/routes/ask.py` |
| Tests | `backend/tests/test_ask_briefly.py` |
| Page | `frontend/app/(app)/ask/page.tsx` |
| UI | `frontend/components/ask/AskBrieflyView.tsx` |
| Links | `frontend/lib/askLinks.ts` |
| API | `frontend/lib/api.ts` |
| Styles | `frontend/styles/app-dashboard.css` (`.ask-*`) |

---

## Metrics (post-launch)

| Metric | Target |
|--------|--------|
| WAU using Ask | ≥25% (Phase C) |
| Scoped asks / read sessions | ≥10% |
| Answers with ≥1 citation | ≥80% when corpus relevant |
| User-reported “made up” answer | &lt;2% |

---

## Dependencies & cost

- 1 embedding call per ask turn
- 1 LLM call per turn (Sonnet/GPT-4o class recommended)
- Estimated **$0.02–0.08 / turn** at typical context size
- Feature flag: `BRIEFLY_ASK_ENABLED=true` (optional, future)

---

*Last updated: June 2026 — Phases A & B implementation started.*
