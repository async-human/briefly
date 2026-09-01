# Briefly — Vision & North Star

*The durable answer to "what is Briefly?" Read alongside [PRODUCT.md](PRODUCT.md)
(scope discipline) and [ROADMAP.md](ROADMAP.md) (phases and gates). When a new idea
shows up, test it against this file first.*

---

## The one-liner

> **Briefly is the chief of staff for your information life: it reads everything
> you follow, remembers it, and acts on it — so the people who can't afford to
> fall behind, never do.**

Not a briefing app (too narrow — that's one feature). Not a generic agent (too
broad — a race we lose to ChatGPT/Gemini/Operator on resources). The defining
word is **grounded**: every capability must be sharper *because it knows your
sources and your history*. A generic agent starts cold on every task. Briefly
starts with everything you've read and everyone you follow. That accumulated
context is the moat, and it must stay the center of the identity.

---

## One engine, three layers

Briefly is one coherent product, not a bundle of features. The three layers are
also the roadmap order:

1. **It reads** — ingests everything you follow (the morning brief).
2. **It remembers & connects** — compounding memory, story threads, proactive
   surfacing ("this connects to what you read three weeks ago").
3. **It acts** — the grounded agent: answers, researches, drafts, and (with your
   sign-off) sends — corpus-first, the open web as an attributed backstop.

**Read → remember → act, all anchored in your context.**

---

## One engine, many people

The engine never changes. Only the *sources*, the *"why it matters" lens*, and
the *actions* change per person — which is exactly why Briefly serves very
different backgrounds without becoming generic. A founder and a researcher run
identical code and get a completely different, personal product, because the
context is theirs.

| Persona | Follows | A grounded moment |
|---|---|---|
| **Founders & operators** *(beachhead)* | competitors, customers, investors, the market | "A competitor shipped the thing that reshapes your differentiation story — here's the 3-line version for your investor update." |
| **Investors** | portfolio companies, sectors, founders | "Your portfolio company is named in this morning's report — and you meet their founder Thursday. Here's what changed and two questions to ask." |
| **Product managers** | user communities, changelogs, competitors | "The pain point your users keep raising just shipped in a competitor's changelog — here's the synthesis for standup." |
| **Engineers** | GitHub, papers, eng blogs, HN | "A library in your stack shipped a breaking change — here's the migration delta and whether it touches you." |
| **Researchers** | arXiv, labs, journals | "A new paper extends the method you've tracked for weeks — it cites the work you read in March. Here's how it moves your thread forward." |

---

## The discipline that keeps it from drifting generic

1. **Breadth of *persona*, not breadth of *capability*.** Serve many backgrounds;
   keep the capability set bounded to **read / remember / act-on-your-corpus**.
   *"Draft an email about something you read"* passes. *"Play a song"* fails —
   no corpus tie, pure surface, cut it.
2. **Pick a beachhead and go deep first.** The engine serves everyone
   eventually, but the path is *one persona deep*, not all personas shallow.
3. **Who it's NOT for:** casual consumers who don't follow much, and anyone
   wanting a general assistant. The wedge is **people whose work depends on
   staying current and who subscribe to too much.** That constraint is a feature.

---

## Beachhead: Founders & operators

The first persona we build *for*. Their sources, their "why it matters," and
their actions get to be genuinely great before we widen.

- **Why them:** highest pain (falling behind has direct cost), already pay for
  time-saving tools, and the "connect external news to *my* company/roadmap"
  value is uniquely served by a grounded agent.
- **Their grounded actions (in priority order):**
  1. **Grounded email** — "draft a reply / intro / team note about the thing I
     read," reviewed and sent with sign-off.
  2. **Competitor / company research → report** — corpus + web, a reviewable doc.
  3. **Composite** — research → report → send, once the above are solid.

---

## Roadmap (act layer)

The "act" layer is built deliberately, smallest-validating-step first. Every
world-changing action is gated; nothing irreversible happens without sign-off.

- **Phase 0 — Harden the assistant.** Make the orb / Ask reliable before it can
  act on the world. Foundation before autonomy.
- **Phase 1 — Grounded email (one world-changing action, done right).** Draft →
  **review card** → send. Proves the human-in-the-loop + action + audit pattern
  end-to-end, and it's uniquely Briefly (grounded in your corpus).
- **Phase 2 — Deep research → report (read-only output).** Corpus + web, a
  reviewable document. Introduces the **Task / background-execution + progress**
  architecture. No send yet.
- **Phase 3 — Composite orchestration** (research → report → send). The planner
  chains proven tools through the approval gate.
- **Throughout — the learning loop.** Extend the behavioral fingerprint so the
  agent learns your email tone, report format, trusted sources, and when to act
  vs. ask. This "gets better over time" is the moat, not a nice-to-have.

### Non-negotiable principles for the act layer

- **Human-in-the-loop on anything outbound or irreversible.** Read-only actions
  (search, research, draft) run freely; send / post / purchase always stop at an
  approval card the user reviews and edits first.
- **Audit log** of every action taken — what, when, with what inputs.
- **Provenance + confidence** on research/financial output. Never auto-send
  anything with real-world consequences.
- **Per-task budgets / caps** — multi-step agents burn tokens; protect margins.
- **Corpus-first.** The open web is an attributed backstop, never the front door.

---

## Relationship to the spine

This *evolves* the PRODUCT.md spine — it doesn't discard it. The original spine
("reads everything you follow, remembers it, hands you a briefing you can talk
to") is layers 1–2. This adds layer 3 (act) and reframes the identity from
"briefing" to "grounded chief of staff." The stop rule still governs: a feature
ships only if you can draw a straight line from it back to **read → remember →
act, grounded in the user's corpus.**
