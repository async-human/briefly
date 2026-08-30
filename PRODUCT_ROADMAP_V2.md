# 🗺️ Briefly: The Complete Product Roadmap
**Positioning:** AI Market Intelligence Agent for AI Founders & Solo Builders
**North Star Metric:** % of weekly active users who say *"I would miss this if it stopped"*
**Target:** $10k MRR within 9 months as a solo founder

---

## 📋 Roadmap Philosophy

This roadmap is built on three principles:
1. **Gate every phase with real signal** — no phase starts until the previous one proves demand.
2. **Ship the moat, not the feature** — every release must deepen either *curation*, *memory*, *action*, or *ambient UX*.
3. **Kill features ruthlessly** — if a feature doesn't drive retention or willingness to pay, it dies.

---

## 🚪 Phase 0: Concierge Validation (Weeks 1–4)
**Goal:** Prove the brief format is valuable before writing complex code.

| Area | Details |
|---|---|
| **Product** | Manually curate the "AI Founder Intelligence Pack." Deliver via email at 8 AM. Use Claude 3.5 Sonnet + your 6-point format. |
| **Distribution** | DM 50 AI founders on Twitter/LinkedIn. Personal onboarding. |
| **Tech Stack** | Gmail + Claude API + simple Python script. No frontend. |
| **Success Metrics** | 10 active weekly readers · 5 paying at $19/mo · 3+ say "I'd miss this" |
| **🚦 Gate to Phase 1** | 5 paying users OR 3 "I'd miss this" responses. If not hit → pivot niche or format. |

---

## 🏗️ Phase 1: The "Real" V1 (Months 2–3)
**Goal:** Automate the pipeline while keeping curation high-quality. Ship the core write-back actions.

### Product Deliverables
1. **Automated Ingestion Pipeline**
   - RSS, newsletters (via Kill The Newsletter / Inoreader API), Product Hunt, Hacker News "Show HN", selected Substacks, Twitter lists.
   - Daily deduplication + relevance filtering.
2. **The 6-Point Brief Engine**
   - What changed · Why it matters · Who it affects · Related past context · Suggested action · Source citation.
3. **Core Write-Back Actions**
   - "Track this company" (adds to persistent watchlist)
   - "Save to market memory" (tags for future retrieval)
   - "Create idea note" (pushes to Notion/Markdown)
4. **Simple Web Dashboard**
   - View past briefs · Manage sources · See tracked companies.

### Tech Stack
- **Frontend:** Next.js + Tailwind + shadcn/ui
- **Backend:** Supabase (Postgres + Auth + Storage)
- **Ingestion:** Inngest or Trigger.dev for reliable background jobs
- **AI:** Claude 3.5 Sonnet for summarization + structured JSON output
- **Delivery:** Resend (email) + Telegram bot (optional)
- **Payments:** Stripe Checkout

### Distribution
- Launch on Twitter/X with a "behind the scenes" build-in-public thread.
- Post on Indie Hackers, Hacker News (Show HN), and relevant Subreddits.
- Offer "Founding 50" lifetime pricing at $19/mo locked forever.

### Success Metrics
- 50 paying users · 40% weekly retention · 1 "viral" moment (someone shares the brief unprompted)
- **🚦 Gate to Phase 2:** 50 paying users AND retention >40%. If churn is high → fix the brief format before adding features.

---

## 🧠 Phase 2: The Memory & Compound Context Layer (Months 4–5)
**Goal:** Activate the long-term moat. This is where Briefly becomes *irreplaceable*.

### Product Deliverables
1. **Knowledge Graph v1**
   - Every brief item is linked to entities (companies, people, concepts).
   - "Related to something you tracked before" becomes real, not a placeholder.
2. **User Memory Profile**
   - Tracks which topics the user clicks, tracks, saves, and asks about.
   - Auto-adjusts the weight of future sources based on engagement.
3. **Ask Briefly (Search)**
   - "What have I read about [X] in the last 30 days?" — answered with citations.
4. **Weekly Synthesis Report**
   - Every Sunday: "Here's what changed in your tracked space this week, and 3 questions you should be asking."

### Tech Stack Additions
- **Vector DB:** Supabase pgvector or Pinecone for semantic search over past briefs.
- **Graph:** Lightweight entity extraction via Claude → stored as Postgres relations.
- **Analytics:** PostHog (self-hosted) to track which items get clicked/saved.

### Distribution
- Launch "Ask Briefly" as a standalone feature announcement.
- Start a referral program: "Give a friend 1 month free."
- Begin charging new users $49/mo (Founding 50 stays at $19).

### Success Metrics
- 150 paying users · 60% weekly retention · 20% of users using "Ask Briefly" weekly
- **🚦 Gate to Phase 3:** 150 paying users AND 60% retention. If retention stalls → memory layer isn't delivering value; double down before adding voice.

---

## 🎙️ Phase 3: The Ambient & Voice Layer (Months 6–7)
**Goal:** Unlock the premium tier. Meet users in their existing habits.

### Product Deliverables
1. **Interactive Voice Briefing**
   - Call a number or use the web app. Agent reads the brief, user can say "tell me more" or "skip."
   - Powered by Vapi.ai + your RAG backend.
2. **WhatsApp / Telegram Proactive Brief**
   - One-tap "tell me more" on any item → expands in chat.
3. **Commute Mode**
   - Auto-detects morning (via user's timezone) and triggers a 3-minute voice brief.

### Tech Stack Additions
- **Voice:** Vapi.ai (telephony + STT/TTS + LLM routing)
- **Messaging:** WhatsApp Business API (via Twilio or 360dialog) + Telegram Bot API
- **Scheduling:** Cron jobs in Inngest for timezone-aware delivery

### Distribution
- Launch voice as a **$49/mo "Pro" tier** (existing users upgrade).
- Partner with 2–3 AI podcasts/newsletters for cross-promotion.
- Publish a case study: "How I replaced 5 newsletters with one 3-minute voice call."

### Success Metrics
- 300 paying users · 25% adoption of voice/ambient features · ARPU increases to ~$35
- **🚦 Gate to Phase 4:** 300 paying users AND voice users show 20% higher retention than non-voice users.

---

## 👥 Phase 4: Team Intelligence & Expansion (Months 8–10)
**Goal:** Multiply ARPU without multiplying support burden.

### Product Deliverables
1. **Team Shared Brain**
   - Multiple founders/operators share a collective brief.
   - "What did my co-founder track this week?" view.
   - Shared tracked companies and idea backlog.
2. **Custom Competitive Packs**
   - Users can build their own source packs (beyond the default AI Founder pack).
   - Sell pre-built packs for adjacent niches (VC associates, PMs, growth marketers).
3. **Slack / Teams Integration**
   - Daily brief drops into a dedicated channel.
   - Team members can react with 🔥 to flag items for discussion.

### Pricing Evolution
| Plan | Price |
|---|---|
| Solo Founder | $49/mo |
| Team (up to 5) | $149/mo |
| Custom Competitive Brief | $299+/mo |

### Distribution
- Outbound to startup teams (found via Crunchbase/LinkedIn).
- Launch "Team Intelligence" on Product Hunt.
- Start a waitlist for adjacent niches (VC, PMs) to validate expansion.

### Success Metrics
- 500 paying users · 20% on Team plans · $25k MRR
- **🚦 Gate to Phase 5:** $25k MRR AND clear signal from 1+ adjacent niche.

---

## 🏰 Phase 5: Platform & Moat Deepening (Months 11–12+)
**Goal:** Become the default intelligence layer for a category of users.

### Product Deliverables
1. **Briefly API**
   - Let other tools pull from a user's Briefly knowledge graph.
2. **Marketplace of Packs**
   - Power users can create and sell source packs to others.
3. **Vertical Expansions**
   - "Briefly for VC Associates" · "Briefly for PMs" · "Briefly for AI Agencies"
4. **Enterprise Tier**
   - SOC 2, SSO, custom integrations, dedicated support.

### Team (When to Hire)
- **First hire:** Part-time customer support / ops (at ~$30k MRR).
- **Second hire:** Full-stack engineer (at ~$50k MRR).
- **Do NOT hire sales or marketing until $100k MRR.**

---

## 🚫 The Anti-Roadmap: What NOT to Build

| Temptation | Why to Avoid |
|---|---|
| Building your own voice infrastructure | Use Vapi. Your moat is curation, not telephony. |
| Adding 50+ source integrations in V1 | Start with 10 high-signal sources. Depth > breadth. |
| Mobile app in Year 1 | Email + Telegram + web are enough. Apps are a retention trap. |
| Free tier beyond trial | Free users churn, complain, and distract you from paying users. |
| Enterprise features before $50k MRR | You are a solo founder. Enterprise sales will kill you. |
| Multi-language support in Year 1 | English-first. Global expansion comes after product-market fit. |

---

## ⚠️ Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **OpenAI ships a "daily brief" feature** | Your moat is curation + write-back + memory. They won't build niche packs or Notion integrations. |
| **LLM API costs eat margins** | Use Claude Haiku for filtering, Sonnet only for final brief. Cache aggressively. |
| **Source APIs break or change** | Build fallback scrapers. Never depend on a single ingestion method. |
| **User churn after novelty wears off** | The memory layer (Phase 2) is your retention play. Ship it fast. |
| **Burnout as a solo founder** | Enforce a "no new features" week every month. Protect your energy. |

---

## 🎯 Your Immediate Next 7 Days

Forget months 6–12. The only phase that matters right now is **Phase 0**.

**Day 1–2:** Draft tomorrow's brief for yourself using the 6-point format. Iterate the prompt until it feels like a $49/mo product.
**Day 3–4:** Identify 10 AI founders in your network. Send them the brief. Ask for honest feedback.
**Day 5–7:** Based on feedback, refine the format. Send it to 10 more people. Track who opens, replies, and asks for more.

**If 3+ people say "keep sending this" by Day 7 → you have permission to build Phase 1.**
**If not → tweak the format or niche before writing a single line of app code.**

---

Want me to draft the **exact Claude prompt** you'll use to generate the 6-point brief, or the **outreach DM script** for your first 10 users? Pick one and let's ship it today.