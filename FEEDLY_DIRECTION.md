# Briefly vs Feedly — product direction

**Date:** 31 August 2026  
**Companion docs:** [`MOAT_ROADMAP.md`](MOAT_ROADMAP.md) (phased gates), [`FEATURES.md`](FEATURES.md) (what has shipped)

Borrow Feedly’s **intelligence machinery**. Borrow almost none of Feedly’s **product philosophy**.

Feedly is becoming extremely good at:

> collect → classify → filter → analyze → distribute

Briefly goes one step further:

> collect → detect change → understand personal/company impact → connect history → update a decision → recommend action → learn from outcome

That final half is where Briefly can be substantially more interesting than Feedly.

---

## 1. What Feedly has actually become

Feedly is no longer primarily an RSS reader. Its Market Intelligence product is increasingly an external intelligence operating system.

```
Millions of sources
        ↓
AI classification
        ↓
AI Feeds
        ↓
event / company / technology extraction
        ↓
deduplication
        ↓
trend detection
        ↓
Insights Cards
        ↓
Ask AI / AI Actions
        ↓
newsletters / Slack / Teams / API
```

Feedly says Market Intelligence now uses 10,000+ AI models across its source universe. AI Feeds let analysts combine concepts, companies and events through AND/OR/NOT rules, while a natural-language filter handles more nuanced filtering.

That is much more sophisticated than RSS + LLM summarization. Several of its product ideas are worth studying — and then reshaping.

---

## 2. Don’t organize articles — organize signals

This is the biggest lesson for Briefly.

Feedly has trained models for strategic signals such as product launch, funding, partnership, acquisition, leadership change, hiring, layoffs, regulatory change, patent, geographic expansion, IPO, and customer traction.

So Feedly can understand “Anthropic launches a new enterprise product” as:

- Company: Anthropic  
- Event: Product launch  
- Domain: Generative AI  
- Industry: Software  
- Date: …

instead of Article #92837.

Briefly should borrow this aggressively, then improve it into a **Signal & Change Engine**.

Store a state transition, not a headline:

```
ENTITY            Anthropic
SIGNAL TYPE       Product launch
PREVIOUS STATE    No product serving X use case
NEW STATE         Product X now launched
OBSERVED          31 August 2026
CONFIDENCE        0.94
EVIDENCE          3 independent sources
RELATED HISTORY   Anthropic announced expansion into
                  enterprise workflows 47 days ago
IMPACT ON YOU     Potentially overlaps Feature Y
DECISION THREAD   Should we move Briefly further toward
                  founder intelligence?
RECOMMENDED       Review whether this changes
                  Briefly’s differentiation
```

Feedly identifies **events**. Briefly should understand **state transitions**.

This already matches the loop in [`MOAT_ROADMAP.md`](MOAT_ROADMAP.md): observe → detect change → connect history → assess impact → recommend action → execute with approval → learn from outcome.

---

## 3. Feedly AI Feeds → Briefly Intelligence Missions

Feedly’s flagship capability is the AI Feed. Example:

```
(OpenAI OR Anthropic OR Google DeepMind)
AND
(Product Launches OR Pricing Changes)
NOT
(Job postings)
```

Powerful — and it still makes the human configure the intelligence system: which companies, concepts, sources, exclusions, queries, and refinements.

That is exactly the maintenance tax Briefly exists to remove. Do **not** build Briefly AI Feeds.

Build **Intelligence Missions**.

Onboarding asks what the founder is trying to achieve. Briefly learns company, product, industry, competitors, technologies, customers, strategic goals, and risks. Then it constructs missions such as:

**Competitive moves** — monitor OpenAI, Anthropic, Perplexity, Glean, Notion, Feedly; look for pricing, launches, positioning, partnerships, acquisitions, AI-agent capabilities.

**Technology risk** — monitor OpenAI / Anthropic / Gemini APIs, LangGraph, major model releases; look for price changes, deprecations, new capabilities, context limits, tool calling, agent infrastructure.

**Market signals** — a strategic question such as “Are founders increasingly paying for external intelligence tools?”

The user should not construct these feeds. Briefly constructs the monitoring strategy from operating context.

---

## 4. Feedly “Less Like This” → Relevance DNA

Feedly lets users downvote with Less Like This and mute topics, companies, authors, and sites. It mostly learns “don’t show me content like this.”

Briefly should learn **why it wasn’t useful**:

- Already knew this  
- Not important enough  
- Wrong company  
- Doesn’t affect me  
- Duplicate development  
- Too speculative  
- Wrong topic  

If someone repeatedly dismisses AI-company funding news but opens new APIs, pricing changes, agent capabilities, and competitor launches, Briefly learns weights such as funding −0.34, API changes +0.82, pricing +0.91, competitor launches +0.89.

Also learn from behavior, not just explicit feedback:

| Behavior | Weight |
|---|---|
| Open | Weak positive |
| Ask | Stronger |
| Track | Stronger |
| Create a Decision Thread | Very strong |
| Take an action | Strongest |
| Ignore / dismiss repeatedly | Negative |

That compounding profile is **Relevance DNA**. It is unique to each company/user and is not a preference questionnaire.

---

## 5. Feedly deduplication → event clustering + delta

Feedly already deduplicates by content overlap (and newer newsletter dedup can detect the same story in a time window). Briefly already deduplicates articles too.

Do not stop at one canonical article. Cluster **events**.

Twenty-six publications covering “OpenAI launches GPT-6” is one event: first detected 11:03, then pricing at 11:47, API availability at 13:22, benchmarks at 15:40, enterprise rollout at 19:10.

Tomorrow’s brief must not repeat “OpenAI launched GPT-6.” It should report the delta:

> GPT-6 update: pricing was published overnight and is 28% lower than GPT-5.6 for cached input.

That is delta intelligence. It is how Briefly stops feeling like “I’ve already seen this.”

---

## 6. Feedly Company Insights Cards → living entity memory

Feedly’s company cards show top stories, coverage volume, and metrics. Briefly should borrow the object and make it **historical and personal**.

For Anthropic, Briefly could know current positioning, products, pricing history, recent strategic moves, and **your relationship**: tracked since March, appeared in 19 briefs, mentioned in 4 Decision Threads, relevant to positioning / model-provider strategy / agent roadmap. Then a 30-day “what changed” delta.

Feedly’s card tells you about Anthropic. Briefly’s card tells you **what Anthropic means to you**.

Do not create a `/companies` page while the surface freeze holds. These cards belong inside the brief and Ask Briefly.

---

## 7. Feedly Emerging Trends → personal weak-signal radar

Feedly detects candidate trends, groups synonyms, and tracks volume/growth. Popularity ≠ relevance. Quantum computing exploding globally may not matter to this founder.

**Trend score** ≈ velocity × source diversity × novelty × entity relevance × company relevance × strategic-question relevance × credibility.

An early signal should name momentum, independent sources, companies, confidence, **why you should care**, and the **connected decision** — not a global trend dashboard.

Some Feedly reviews already criticize Emerging Trends for not fully delivering. The opening is contextual scoring, not a broader dashboard.

---

## 8. Ask AI → Temporal Ask Briefly

Do not compete on “chat with articles.” That is commodity.

Ask Briefly should be temporal:

- How has Anthropic’s strategy changed in the last six months?  
- When did we first see evidence that Anthropic was moving into coding?  
- What did I previously believe about AI coding agents, and has the evidence changed?  
- Which assumptions behind our Briefly roadmap are becoming weaker?  

That requires current evidence + historical snapshots + previous briefs + user conclusions + Decision Threads + decisions + outcomes. ChatGPT and Feedly cannot reproduce the answer from the open web, because part of it exists only inside this user’s history with Briefly.

---

## 9. Feedly Boards → Decision Threads

Feedly Team Boards curate **content**. Briefly should organize around **decisions and questions**.

A Decision Thread holds current belief, evidence for, evidence against, signals since last update, confidence movement (e.g. 72% → 81%), and open questions.

Feedly helps you accumulate research. Briefly should accumulate **understanding**. After this Feedly pass, Decision Threads look even more important than in the original moat sequence.

---

## 10. Feedly AI Actions → action compiler

Feedly AI Actions are still largely information → artifact.

Briefly’s loop:

```
signal → impact → decision → recommended response
      → approval → action → outcome
```

Example: competitor pricing $99 → $59, tied to a pricing Decision Thread assumption from 12 August, with [Review pricing] producing old comparison, new prices, revenue implications, alternatives, recommendation, evidence — eventually [Update pricing model] after approval.

That is outside Feedly territory. Do not ship autonomous execution before preview, approval, and audit.

---

## 11. Feedly newsletters → adaptive briefs (later)

Same intelligence, different contextualization (CEO / CTO / Product views). **Do not build this now.** It belongs in the team phase, not the founder product.

---

## 12. Feedly custom summaries → learned brief style

Do not ask users to enter a prompt. Learn that this founder cares about product implication, technical implication, competitive threat, and business opportunity — and usually ignores fundraising gossip, executive commentary, and generic trend pieces. The brief adapts. No configuration.

---

## 13. Feedly private company lists → dynamic tracked universe

Keep the underlying concept. Do not keep lists static.

Briefly notices: “Eleven stories relevant to you now repeatedly mention Tavily. Track it?” [Track] [Ignore]. The tracked universe evolves.

---

## 14. Feedly alerts → conditional intelligence watches

Not keyword alerts. Semantic conditions:

- Tell me if OpenAI cuts API prices by more than 20%.  
- Tell me when Feedly launches something aimed specifically at startups.  
- Watch whether three or more competitors start offering persistent memory.  
- Tell me if this trend accelerates for three consecutive weeks.  

---

## 15. Copy almost exactly: evidence transparency

Every recommendation distinguishes:

| Layer | Example |
|---|---|
| **Fact** | OpenAI reduced API pricing. |
| **Inference** | This increases price pressure on AI SaaS products. |
| **Personal impact** | Briefly’s projected inference cost could decrease ~X%. |
| **Recommendation** | Revisit model routing. |

Every layer is traceable. For a decision product, trust matters more than eloquence.

---

## 16–19. Feedly’s weaknesses (Briefly’s counter-position)

1. **Setup complexity.** Feedly: configure your intelligence platform. Briefly: tell me about your company. Then Briefly does the configuration.
2. **It remembers information, not your reasoning.** Briefly should remember what happened → what you believed → why → what changed → what you decided → what you did → what happened afterward. That decision history cannot be purchased.
3. **Article intelligence still dominates.** Hierarchy should be source → claim → event → signal → entity change → impact → decision → action. Articles are evidence, not the product.
4. **Enterprise pricing gap.** Feedly Market Intelligence is listed around $1,600/month Standard and $2,400/month Advanced (annual). There is a large gap between ~$20 consumer AI tools and that band. Briefly’s opening is Feedly-quality mechanics for a founder/operator, plus personal company memory and decision intelligence, at the $49–$99 band in the moat roadmap. Do not compete with Feedly enterprise sales first.

---

## 20. Feature matrix

| Feedly | Briefly version | Improvement | Priority |
|---|---|---|---|
| AI Feeds | Intelligence Missions | Auto-generated from company context | Very high |
| Strategic Moves | Signal ontology | Detect actual state changes | Very high |
| Less Like This | Relevance DNA | Learn from reasons + behavior + actions | Very high |
| Deduplication | Event clustering + delta | Report only what changed | Very high |
| Company Cards | Living entity memory | Company history + personal relevance | High |
| Emerging Trends | Personal weak-signal radar | Company-specific trend scoring | High |
| Ask AI | Temporal Ask Briefly | Query history + beliefs + decisions | Very high |
| Boards | Decision Threads | Organize around questions, not content | Very high |
| AI Actions | Action compiler | Recommendation → approval → execution | Later |
| Automated newsletter | Adaptive brief | Audience-specific interpretation | Team phase |
| Company lists | Dynamic tracked universe | Automatically evolves | High |
| Alerts | Conditional watches | Monitor semantic conditions | High |
| Citations | Evidence bundles | Fact / inference / impact separation | Very high |
| Analytics | Decision analytics | Measure decisions/actions, not article volume | High |

Implementation status for each row: [`FEATURES.md`](FEATURES.md).

---

## 21. The five to build next

Do not implement the whole matrix.

```
YOUR COMPANY CONTEXT
         │
         ▼
TRACKED UNIVERSE
         │
Internet ──► SIGNAL DETECTION
         │
         ▼
EVENT CLUSTERING
         │
         ▼
CHANGE DETECTION
         │
         ▼
VERIFICATION
         │
         ▼
COMPANY IMPACT MODEL
    ┌────┴────┐
    ▼         ▼
DECISION    BRIEF
THREAD
    └────┬────┘
         ▼
RECOMMENDED ACTION
         │
         ▼
USER FEEDBACK
         │
         ▼
RELEVANCE DNA
```

1. Signal ontology & change detection  
2. Intelligence missions / tracked universe  
3. Event clustering + delta  
4. Company impact + evidence bundle  
5. Decision Threads  

Those five move Briefly from a personalized news product to a personal decision-intelligence system.

---

## 22. Finished experience (target)

Not:

> OpenAI announces lower API pricing. Summary. Source. Related company information.

This:

> **Decision-worthy change.** OpenAI cut cached-token pricing 40%.  
> **Why this matters to Briefly.** Your architecture estimates LLM inference at 31% of variable cost. New pricing could reduce that if nightly synthesis migrates.  
> **This changes something you previously believed.** On 18 August, your Model Economics Decision Thread assumed OpenAI remained ~22% more expensive than Provider X for this workload. That assumption may no longer hold.  
> **Evidence.** OpenAI pricing page · developer announcement · 2 independent reports. Confidence 96%.  
> **Recommended action.** Recalculate model-routing economics. [Review analysis] [Keep monitoring] [Not important]

That is an analyst who has worked beside you for two years and remembers the reasoning behind your company decisions.

---

## 23. Do not copy

| Don’t copy | Why |
|---|---|
| Infinite RSS / feed-centric UI | Turns Briefly back into information consumption |
| Complex AI Feed builder | Violates zero-maintenance |
| Hundreds of configurable filters | High cognitive cost |
| Generic global trends dashboard | Interesting ≠ actionable |
| Huge collection of disconnected pages | Surface freeze; deepen the brief |
| Chat-with-selected-articles as the core AI | Commodity |
| Article-count metrics | Optimizes consumption, not decisions |
| Enterprise collaboration too early | Before founder retention |
| Newsletter-builder complexity | Different product |
| Thousands of generic AI taxonomies | Start with founder-relevant signal classes |

Deepen the spine. Do not widen the surface.

---

## 24. Positioning

| Product | Promise |
|---|---|
| Feedly | Know what's happening. |
| Perplexity | Find out what's happening. |
| ChatGPT | Understand whatever you ask about. |
| Notion | Store what your team knows. |
| **Briefly** | **Know what changed, why it matters to you, what it changes about what you previously believed, and what you should do next.** |

“An AI that reads everything you follow and creates a personalized brief” is now too weak. Feedly can increasingly do a large portion of that.

---

## 25. Moat

Not sources (copyable). Not summaries (commodity). Not even the knowledge graph (replicable).

```
World
  → external signals
  → your company context
  → your Relevance DNA
  → your entity history
  → your Decision Threads
  → your decisions
  → your actions
  → outcomes
  → system learns
  → better next decision
```

Feedly has spent years on the left-hand side: understanding the world. Briefly does not need to win that entire game. Own the relationship between the changing world and **one particular company’s ongoing decisions**.

If we stay disciplined around that, this analysis strengthens rather than weakens [`MOAT_ROADMAP.md`](MOAT_ROADMAP.md).
