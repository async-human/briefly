# Briefly — Product Spine & Scope Discipline

*Single source of truth for what Briefly **is**, what's **in** it, and what we're
deliberately **not** building. Read this before proposing or building any feature.*

---

## The spine (one sentence)

> **Briefly reads everything you follow, remembers it, and hands you one personal
> briefing you can talk to.**

Every feature must be an expression of that sentence. If you can't draw a straight
line from a feature back to the spine, it doesn't belong — **cut it or merge it.**

The three things that make it *Briefly* — and that a general assistant (ChatGPT,
Gemini, Siri) structurally can't copy:

1. **Your sources, not the open web.** It reads only what you chose to follow.
2. **Compounding memory.** Today's story connects to what you read weeks ago.
3. **A brief you can question.** Not a feed — an assistant that knows *your* reading.

---

## Feature map

Three pillars + utilities. Everything we ship lives in exactly one pillar and
serves the spine. Nothing should feel like a separate product.

### 1 · The Brief — the core
| Surface / capability | Status | Serves the spine by… |
|---|---|---|
| Nightly pipeline (collect → score → dedup → write → deliver) | Core | *is* the briefing |
| Dashboard + read view (`/dashboard`, `/dashboard/read`) | Core | where you read the brief |
| History (`/history`) | Supporting | your past briefings |
| Email delivery | Core | the brief comes to you |
| Proactive surfacing / learning loop | Supporting | makes the brief smarter over time |

### 2 · The Assistant — one brain, voice + text
| Surface / capability | Status | Serves the spine by… |
|---|---|---|
| Voice orb (dashboard FAB) — **canonical** | Core | "talk to your briefing" |
| Ask Briefly (`/ask`) — the orb's full conversation view | Core | same brain, expanded; shares the thread |
| Tool routing (today_brief, saved, proactive, ask) | Core | answers grounded in *your* corpus |

> One assistant, two views of one continuous conversation. The orb hands off to
> `/ask` on the same thread. There is **no** other assistant surface.

### 3 · Your Knowledge — the corpus that powers the brief
| Surface / capability | Status | Serves the spine by… |
|---|---|---|
| Capture / saved (`/saved`, extension, share target) | Supporting | feeds your corpus |
| Brain dump (voice/text) | Supporting | your own thoughts shape tomorrow's brief |
| Knowledge graph (`/graph`) | Supporting | shows how your reading connects |
| Intelligence (`/intelligence`) | Supporting | patterns across your corpus |

### Utilities
`settings` · `upgrade`/billing · `onboarding` · `privacy`. Plumbing — exempt from the spine test.

---

## Consolidation decisions (locked — do not re-litigate)

- **One assistant.** The dashboard voice orb is canonical. `/ask` is its full
  conversation view (shared `thread_id`). `/listen` retired → redirects to
  `/dashboard`. The native Tauri desktop app is **parked**, not maintained.
- **One identity.** The assistant — and the app — is **brand violet** (oklch ≈ 275).
  No second palette.
- **The brief connects out.** Every brief item links to "Ask about this" and "Graph."

---

## The stop rule (the freeze)

Before building anything, ask one question:

> **Does this *deepen the spine*, or *widen the surface*?**

- **Deepen (allowed):** make the brief sharper, the memory richer, the assistant
  better at *your* knowledge, an existing feature more reliable or better connected.
- **Widen (frozen):** a new page, a new integration, a new app, a new "mode."

**No new top-level surface ships until both are true:** (a) the existing surfaces
cohere (see below), and (b) real users are asking for it. Until then we *deepen and
connect* — we do not add.

**Always allowed without asking:** bug fixes, reliability, security, and work that
makes existing features cohere.

---

## Definition of "coherent" (the bar we're holding to)

- [x] One assistant identity (voice + text), one palette.
- [x] The brief links out to ask + graph; the assistant maintains one thread.
- [ ] `/ask` visually echoes the orb (same "Briefly assistant," not a different shell).
- [ ] `graph` + `intelligence` + `history` read as one "your knowledge" area, not three islands.
- [ ] Every surface is reachable *from the brief* and leads *back* to it.

When those boxes are checked, Briefly is one product — and the freeze holds until
users tell us what's genuinely missing.
