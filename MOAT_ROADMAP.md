# Briefly Moat Roadmap

**Planning horizon:** August 2026–2029  
**Primary beachhead:** Founders and product leaders at 5–50-person AI/software companies  
**Commercial destination:** A credible path to US$100,000 MRR  
**Product destination:** The trusted decision-intelligence layer that detects important changes, remembers their history, explains their consequences, and helps teams act.

---

## 1. Strategic destination

Briefly should not become a general-purpose assistant or another AI news reader.

Its durable position should be:

> **Briefly continuously monitors the external world a company cares about, maintains a living memory of what changed and why it matters, and turns high-confidence signals into reviewable business actions.**

The product loop is:

**Observe → detect change → connect history → assess impact → recommend action → execute with approval → learn from outcome**

The daily brief remains the initial habit and delivery surface. It is not the final product. The destination is a continuously improving decision system.

### The problem Briefly owns

Founders and operators must follow competitors, technologies, customers, regulations, funding, and market developments across fragmented sources. Current tools make them search, read, organize, remember, and translate information into action themselves.

Briefly should remove that maintenance tax and prevent three expensive failures:

1. **Late awareness:** the team discovers an important change too late.
2. **Lost context:** the team sees a development but cannot connect it to previous evidence or decisions.
3. **Execution gap:** the team understands a development but never converts it into an action.

---

## 2. What the moat actually is

A feature is not a moat. Summaries, chat, voice, knowledge graphs, email briefs, and embeddings can all be reproduced.

Briefly's moat must be built as four compounding assets:

| Compounding asset | What accumulates | Why it becomes harder to replace |
|---|---|---|
| **Context asset** | Company, role, goals, competitors, technology stack, strategic questions and preferences | Briefly understands relevance in the user's operating context instead of using generic interests |
| **Temporal intelligence asset** | Versioned changes, entity histories, contradictions, story arcs and invalidated assumptions | The product knows how reality evolved, not merely what documents currently say |
| **Decision and outcome asset** | Recommendations accepted, rejected, edited, acted on and their eventual outcomes | Briefly learns which signals and actions produce value for this user and this type of company |
| **Workflow and team asset** | Shared watchlists, decision records, action history, internal commentary and team usage | Briefly becomes embedded in how the organization detects and responds to change |

### Moat maturity ladder

| Level | Product state | Defensibility |
|---:|---|---|
| 0 | Generic summaries | Commodity |
| 1 | Personalized summaries from chosen sources | Useful but copyable |
| 2 | Persistent context and temporal memory | Compounding personal value |
| 3 | Decision recommendations trained by outcomes | Proprietary learning loop |
| 4 | Approved actions inside company workflows | Workflow switching cost |
| 5 | Shared organizational intelligence and category-specific models | Durable product and data moat |

Briefly is technically around Level 1 with pieces of Level 2 already implemented. It does **not** yet have a validated commercial moat because usage, retention, outcomes, and willingness to pay have not proved that the accumulated context matters.

---

## 3. Product principles for every phase

1. **One beachhead before multiple personas.** Build deeply for AI/software founders before expanding to investors, researchers, PMs or other professionals.
2. **Decision value over reading volume.** Optimize for important signals and completed actions, not articles scanned or estimated reading time saved.
3. **Evidence before confidence.** Every material claim must expose citations, confidence, conflicts and the difference between fact and inference.
4. **Progressive autonomy.** Briefly may observe and recommend automatically, but world-changing actions require explicit approval until trust is proven.
5. **No new surface without a retention reason.** Improve the brief, decision memory or action loop before creating another page, mode or client.
6. **Commercial gates control engineering.** A phase does not begin because the previous code is finished; it begins because customers prove the previous value proposition.

### North-star metric

> **Weekly paid accounts that take at least one evidence-backed action from Briefly or confirm that a Briefly signal changed or prioritized a decision.**

Supporting metrics:

- Time to first decision-worthy signal
- Useful-signal rate and false-positive rate
- Evidence/citation coverage
- Percentage of briefs producing an action
- Recommended-action acceptance and edit rate
- D30, D60 and D90 paid retention
- Active decision threads per account
- Team-seat activation and net revenue retention
- Gross margin per account

---

## 4. Phased implementation roadmap

Timelines are planning ranges, not permission to progress automatically. Every phase has a measurable gate.

## Phase 0 — Strategic reset and paid validation

**Timing:** Weeks 0–4  
**Goal:** Prove that a narrow customer will pay for decision-worthy intelligence before adding more technology.

### Customer promise

“Every morning, Briefly tells me the few external changes that could affect my company, connects them to my context, and tells me what deserves action.”

### Implementation

- Freeze new top-level surfaces, voice expansion, desktop work and additional personas.
- Rewrite positioning and onboarding for AI/software founders.
- Capture structured operating context:
  - Company and product
  - Target customers
  - Competitors and substitutes
  - Technology/model stack
  - Strategic goals and risks
  - Important entities and sources
  - Three to five active strategic questions
- Create a concierge “Founder Intelligence Pack” for 15–20 pilot users.
- Charge from the beginning; test US$49–$99/month instead of optimizing a free tier.
- Instrument open, click, save, track, ask, dismiss, act and “changed my decision” events.
- Conduct short remote onboarding and weekly feedback sessions. No in-person selling is required.

### Reuse from the current repository

- Existing source ingestion and nightly briefing pipeline
- User profile, memory and relevance infrastructure
- Email delivery and dashboard
- Existing citations and Ask Briefly entry points

### Moat asset started

Structured company context and the first labeled examples of what each founder considers decision-worthy.

### Gate to Phase 1

All of the following should be true:

- At least **10 paying pilot accounts**
- At least **5 accounts active for four consecutive weeks**
- At least **3 users say they would be seriously disappointed if Briefly disappeared**
- At least **30% of weekly active accounts identify one decision-worthy signal per week**
- Clear evidence that users value impact/recommendation more than the summary itself

**If the gate fails:** change the niche, monitored universe or brief format. Do not solve it by adding features.

---

## Phase 1 — Trustworthy signal and change-detection engine

**Timing:** Weeks 5–10  
**Goal:** Make Briefly exceptionally good at detecting high-value changes and suppressing noise.

### Customer promise

“Briefly notices the changes I cannot afford to miss and shows me exactly why it believes they matter.”

### Product deliverables

1. **Tracked universe**
   - Companies, products, people, technologies, regulations and strategic themes
   - Per-entity importance and monitoring rules
2. **Change detectors**
   - Pricing and packaging changes
   - Product launches and changelogs
   - API/model releases and deprecations
   - Positioning and website changes
   - Funding, acquisitions and material hires
   - Relevant GitHub releases and breaking changes
3. **Evidence bundle**
   - Source, timestamp, extracted claim and supporting passage
   - Previous state versus new state
   - Confidence and corroborating sources
   - Contradictory evidence when present
4. **Decision-oriented brief format**
   - What changed
   - Why it matters to this company
   - What earlier context it connects to
   - Who or what is affected
   - Recommended next step
   - Evidence and confidence
5. **Evaluation harness**
   - Founder-labeled gold set
   - Precision of top-ranked signals
   - Missed-signal and false-positive review
   - Citation and extraction accuracy

### Technical implementation

Add a temporal signal layer rather than treating every item as an independent article:

| New object | Purpose |
|---|---|
| `tracked_entities` | User/company-specific monitoring universe |
| `entity_snapshots` | Versioned observed state for an entity |
| `signals` | A normalized material change or development |
| `signal_evidence` | Source-level evidence and provenance |
| `signal_impacts` | User/company-specific impact assessment |
| `signal_feedback` | Useful, irrelevant, duplicate, incorrect, acted-on labels |

Refactor the existing pipeline into observable stages:

1. Collect and normalize
2. Detect change
3. Verify and deduplicate
4. Map impact to company context
5. Rank and compose

Avoid adding more loosely defined agents. Each stage should have a typed contract, trace, retry policy and evaluation dataset.

### Reuse from the current repository

- `content_ingestion.py`, collector and normalization services
- Deduplication, relevance and novelty agents
- PostgreSQL, pgvector and enrichment cache
- Briefing writer, citation verifier and proactive gating

### Moat asset created

A growing, user-labeled dataset of material changes, their evidence, and company-specific impact.

### Gate to Phase 2

- **≥75% precision** among the top five daily signals in human review
- **<15% false-positive rate** for high-priority alerts
- **≥95% evidence coverage** for material claims
- **<24 hours median detection time** for tracked public changes
- **≥40% D30 paid retention**

---

## Phase 2 — Temporal decision memory

**Timing:** Months 3–5  
**Goal:** Make Briefly more valuable with every week of usage by remembering how evidence, assumptions and decisions evolve.

### Customer promise

“Briefly remembers what we believed, what changed, and which decisions may need to be reconsidered.”

### Product deliverables

1. **Decision Threads**
   - Examples: “Is competitor X moving upmarket?” or “Should we change model providers?”
   - Current hypothesis, supporting evidence, contradicting evidence, confidence and open questions
2. **Temporal entity history**
   - Pricing, positioning, releases, leadership, funding and relationship changes over time
3. **Assumption invalidation**
   - Detect when new evidence weakens or invalidates an earlier conclusion
4. **Contextual connections in the brief**
   - Show relevant history inline; do not force users into a graph canvas
5. **Ask Briefly over decisions**
   - Answer questions using decision threads, events, previous briefs and source evidence
6. **Explicit outcome feedback**
   - No action, monitored, discussed, acted, decision changed, result positive/negative/unknown

### Technical implementation

Add:

| New object | Purpose |
|---|---|
| `decision_threads` | Persistent strategic question or hypothesis |
| `thread_signals` | Evidence associated with a thread |
| `thread_updates` | Versioned conclusion, confidence and open questions |
| `decisions` | Human-confirmed decision and rationale |
| `decision_outcomes` | Later result and retrospective label |

Upgrade retrieval from “top semantically similar documents” to a hybrid of:

- Entity and relationship match
- Temporal relevance
- Decision-thread membership
- Semantic similarity
- Source trust and evidence strength
- User/company-specific impact

### Reuse from the current repository

- Knowledge graph and entity services
- Ask Briefly threads, citations and contextual entry points
- User memory, content embeddings and enrichment cache
- Existing proactive surfacing infrastructure

### Moat asset created

A private, time-aware record of how each customer's strategic understanding and decisions evolved.

### Gate to Phase 3

- **≥50% D60 paid retention**
- **≥40% of weekly active accounts** receive at least one useful historical connection per week
- **≥25% of weekly active accounts** use or update a Decision Thread
- **≥95% citation correctness** in decision-oriented Ask responses
- Users can identify at least one decision that Briefly helped revisit or accelerate

---

## Phase 3 — Closed-loop action system

**Timing:** Months 5–8  
**Goal:** Move Briefly from intelligence consumption to reviewable execution.

### Customer promise

“When something important changes, Briefly prepares the work required to respond.”

### Initial action set

Build only actions repeatedly requested during the pilot:

- Draft a concise team intelligence memo
- Update a living competitor battlecard
- Produce a model/API cost-impact comparison
- Create a product or engineering investigation task
- Draft an email or stakeholder update
- Add or modify a tracked entity or Decision Thread
- Schedule a follow-up check with an explicit condition

### Action architecture

Every action follows:

**Propose → show evidence → preview artifact/change → user edits → explicit approval → execute → audit → collect outcome**

Add:

| New object | Purpose |
|---|---|
| `recommended_actions` | Proposed action, rationale, risk and evidence |
| `action_artifacts` | Draft memos, reports, battlecards or tasks |
| `action_approvals` | Approver, decision, edits and timestamp |
| `action_runs` | Execution status, external reference and errors |
| `action_outcomes` | Whether the action was useful and what happened |

Start with internal artifacts and email drafts. Add only one or two workflow integrations—likely Slack and Linear or GitHub Issues—after repeated demand.

### Reuse from the current repository

- Email drafting, report generation and proactive services
- Existing assistant/orb routing and approval-friendly UI patterns
- Background jobs, notifications and audit-capable database

### Moat asset created

Outcome-labeled recommendations and deep workflow embedding. Briefly learns not just what the user reads, but what the user actually does.

### Gate to Phase 4

- **≥25% of weekly paid accounts** execute or export at least one recommended action
- **≥70% of executed action drafts** are accepted with only light edits
- Action users demonstrate materially higher D60 retention than non-action users
- **Zero unauthorized external actions**
- At least three action types show repeated monthly usage

---

## Phase 4 — Shared team intelligence

**Timing:** Months 8–12  
**Goal:** Increase value and switching cost by making Briefly part of team decision-making.

### Customer promise

“Our team shares one trusted memory of what changed, what we decided, and why.”

### Product deliverables

- Team workspaces, roles and permissions
- Shared tracked entities and Decision Threads
- Team comments, corrections and field intelligence
- Shared decision log with evidence and ownership
- Slack delivery and discussion capture
- Weekly strategic-review report
- Pre-meeting context for decisions and tracked entities
- Team-level action assignments and status
- Exportability and clear data ownership

### Technical implementation

- Introduce organization-scoped data tenancy without duplicating personal and team models.
- Add role-based access control and audit logs.
- Separate private user memory from organization-approved shared memory.
- Support evidence-level corrections and conflict resolution.
- Build a contribution model showing who added, verified or acted on intelligence.

### Moat asset created

Shared organizational memory, collaborative corrections, team workflows and multi-user switching cost.

### Gate to Phase 5

- At least **20 paying teams** or **US$25,000 MRR**
- **≥70% 90-day team-logo retention**
- **≥50% of team accounts** have three or more active seats
- Team ARPA consistently above **US$250/month**
- Clear evidence that shared context—not merely seat bundling—drives retention

---

## Phase 5 — Repeatable distribution and intelligence packs

**Timing:** Months 12–18  
**Goal:** Turn the validated workflow into a scalable acquisition and configuration system.

### Product deliverables

- Self-serve “track my company and five competitors” onboarding
- High-quality AI-founder intelligence pack with predefined entities, detectors and actions
- Configurable packs for specific workflows—not an open marketplace yet
- Shareable, cited intelligence cards and reports with Briefly attribution
- Public weekly AI-market change report generated from non-private signals
- Referral and team-invite loops
- Portfolio deployment for accelerators and venture funds
- API/webhooks only for validated customer workflows

### Distribution system

- Build-in-public examples showing decisions Briefly enabled, not feature announcements
- Founder-specific templates and landing pages
- Searchable public change pages for companies, models and products
- Partnerships with AI newsletters, founder communities, accelerators and VCs
- Remote product-led onboarding with optional concierge setup

### Moat asset created

Category-specific signal models, reusable workflow knowledge, public discovery loops and lower-cost distribution.

### Gate to Phase 6

- **US$50,000 MRR**
- One acquisition channel supplies **≥30% of new paid accounts** predictably
- **≥70% self-serve activation** without founder intervention
- CAC payback below six months
- Positive net revenue retention for team accounts

---

## Phase 6 — Category leadership and US$100k MRR

**Timing:** Months 18–36  
**Goal:** Become the default decision-intelligence system for a defensible customer category.

### Scale priorities

- Improve signal coverage, precision, latency and action success before broadening personas.
- Add enterprise controls—SSO, retention policies, security review and custom connectors—only when qualified customers request them.
- Expand to one adjacent persona only after AI-founder acquisition and retention are repeatable.
- Expose a governed Briefly API for customer-owned intelligence and actions.
- Develop benchmark models from aggregated, privacy-safe outcome patterns; never expose private customer data.
- Hire for the proven constraint: reliability/engineering, customer success or distribution—not according to a preset org chart.

### Illustrative US$100k MRR mix

| Segment | Accounts | ARPA | MRR |
|---|---:|---:|---:|
| Founder Pro | 250 | $149 | $37,250 |
| Teams | 100 | $499 | $49,900 |
| Scale | 13 | $999 | $12,987 |
| **Total** | **363** | — | **$100,137** |

This is more credible than requiring more than 2,000 users at $49/month. The product must earn higher pricing through decisions, actions and team workflow—not through longer summaries.

### Moat reached

Briefly now combines:

- Longitudinal entity and event history
- Company-specific context
- Decision and outcome data
- Trusted evidence and corrections
- Action workflows and approvals
- Shared organizational memory
- Category-specific acquisition and configuration assets

A general assistant could copy an interface or summary format. Replacing this accumulated operating context and workflow history would require reconstructing how the customer observed, decided and acted over time.

---

## 5. Immediate implementation sequence: next 90 days

The next 90 days should not attempt the full roadmap.

| Sprint | Primary deliverable | Exit evidence |
|---|---|---|
| **Sprint 1** | Freeze scope; implement company-context onboarding and event instrumentation | Five pilot accounts configured end-to-end |
| **Sprint 2** | `tracked_entities`, `signals` and `signal_evidence` data model | Three detector types produce reviewable signal records |
| **Sprint 3** | Evidence-backed six-part decision brief | Founders rate top signals; baseline precision established |
| **Sprint 4** | Ranking/evaluation loop and false-positive review | Top-five precision approaches 75% |
| **Sprint 5** | Decision Threads v0 with history and confidence | Users create or accept at least one thread each |
| **Sprint 6** | First action card: team memo or investigation task | At least five approved/exported actions |

### First detector types

Start with the changes most likely to affect an AI/software founder:

1. Competitor pricing or positioning change
2. Model/API launch, price change or deprecation
3. Competitor product release or changelog

Do not add a fourth detector until the first three meet the precision target.

### First action types

1. Draft a cited team memo
2. Create an investigation task
3. Update a competitor/decision thread

Do not add autonomous sending or task creation until preview, approval and audit are reliable.

---

## 6. Current codebase: retain, reshape and park

### Retain and deepen

- FastAPI backend and PostgreSQL/pgvector foundation
- Source ingestion and overnight workers
- Relevance, novelty, deduplication and citation capabilities
- Brief delivery and read experience
- Ask Briefly with grounded citations
- Proactive gating and notifications
- Entity/knowledge services as the basis for temporal intelligence

### Reshape

- Relevance profile → structured company and strategic context
- Article-centric memory → signals, entity snapshots and Decision Threads
- Knowledge graph canvas → progressive connections inside briefs and decisions
- Generic chat → decision-thread queries and action review
- Behavioral tracking → explicit signal, decision and outcome labels
- Multi-agent sprawl → typed, evaluated and observable pipeline stages

### Park until the relevant gate

- Tauri desktop client
- Additional mobile/native clients
- General-purpose voice assistant and telephony
- Audio/podcast brief expansion
- Camera capture
- Broad open-web assistant behaviour
- New personas and verticals
- Marketplace and enterprise administration

Existing code may remain, but it should not receive roadmap priority unless it directly improves a gated metric.

---

## 7. Moat scorecard

Review this monthly. A rising feature count is not progress unless one of these measures improves.

| Dimension | Early indicator | Strong moat indicator |
|---|---|---|
| Context depth | Company profile completed | Context actively affects signal ranking and recommendations |
| Temporal depth | Days of indexed history | Decisions routinely cite and reconsider older evidence |
| Signal quality | Useful-signal labels | High precision with low false-positive rate across many accounts |
| Outcome density | Actions accepted/rejected | Outcomes improve future recommendation selection |
| Trust | Citation coverage | Users rely on Briefly in real business decisions |
| Workflow embedding | Artifacts exported | Actions executed and tracked in daily tools |
| Team value | Seats invited | Shared memory and decisions drive retention and expansion |
| Distribution | One-off launches | Repeatable category-specific acquisition channel |

---

## 8. Anti-roadmap

Do not prioritize the following before the corresponding commercial evidence exists:

- A more beautiful graph without proof that connections change decisions
- Generic “chat with the web” capabilities
- More news categories or consumer personas
- Dozens of source integrations
- Voice as a headline feature
- Autonomous external actions without approval
- A marketplace before one pack is demonstrably valuable
- Enterprise features before repeatable team demand
- Vanity metrics based on articles scanned or theoretical reading time

---

## 9. Quarterly decision rules

At the end of every quarter, answer:

1. Which Briefly signals caused a real decision or action?
2. Which accumulated context made Briefly better than a fresh ChatGPT prompt?
3. Which feature improved paid retention or expansion?
4. Which source or feature generated cost but little decision value?
5. What would retained users be unwilling to lose?

Then:

- **Double down** on capabilities that increase decision-worthy signals, actions or retention.
- **Repair** trust failures immediately.
- **Park** features with usage but no retention or willingness-to-pay effect.
- **Change the niche or promise** if paid validation fails; do not hide weak demand behind more implementation.

---

## 10. Final direction

The destination is not “a better briefing app.” It is:

> **A living, evidence-backed operating memory that notices external change, understands its consequence for the company, prepares the response, and learns from what the team decides.**

The brief creates the habit. Temporal memory creates compounding value. Actions create measurable outcomes. Shared team context creates switching cost. Category-specific distribution turns those product advantages into a durable business.

