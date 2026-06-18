"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Reveal } from "./Reveal";
import { StaggerHeadline } from "./StaggerHeadline";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const ROTATE_MS = 5500;

type BriefingItem = {
  source: string;
  headline: string;
  why: string;
  tag: "breaking" | "thread" | "signal";
};

type Persona = {
  key: string;
  label: string;
  tagline: string;
  follows: string[];
  adapts: string[];
  items: BriefingItem[];
};

const PERSONAS: Persona[] = [
  {
    key: "founder",
    label: "Founders & operators",
    tagline: "Market moves, competitor signals, and investor context — before standup.",
    follows: ["Competitor changelogs", "Industry newsletters", "Customer communities", "Funding news"],
    adapts: [
      "Weights competitor moves against your pitch narrative",
      "Surfaces only what changes your roadmap or fundraising story",
      "Connects today's news to threads you've tracked for weeks",
    ],
    items: [
      {
        tag: "breaking",
        source: "The Information · competitor changelog",
        headline: "A rival just shipped the capability your pitch leans on.",
        why: "You're raising next quarter — this reshapes your differentiation. Three-line version ready for your investor update.",
      },
      {
        tag: "signal",
        source: "r/SaaS · a community you follow",
        headline: "Enterprise buyers are naming your category in procurement threads.",
        why: "Matches the ICP shift you noted in last week's voice note — worth a product strategy check.",
      },
      {
        tag: "thread",
        source: "TechCrunch · ×2 sources",
        headline: "A seed-stage peer closed a round in your adjacent space.",
        why: "You've tracked this space for a month. Here's how their positioning differs from yours.",
      },
    ],
  },
  {
    key: "investor",
    label: "Investors",
    tagline: "Portfolio signals, sector shifts, and founder context — before the partner meeting.",
    follows: ["Portfolio mentions", "Sector reports", "Founder updates", "LP-relevant macro"],
    adapts: [
      "Flags portfolio companies by name across your reading",
      "Builds meeting prep from what changed since you last spoke",
      "Separates sector noise from thesis-relevant moves",
    ],
    items: [
      {
        tag: "breaking",
        source: "Industry report · portfolio mention",
        headline: "Your portfolio company is named in this morning's sector report.",
        why: "You meet their founder Thursday — here's what changed and two sharp questions to bring.",
      },
      {
        tag: "signal",
        source: "The Information · sector you cover",
        headline: "Regulatory draft could reshape the unit economics in your thesis space.",
        why: "You've been bullish on this vertical — this is the first concrete policy signal.",
      },
      {
        tag: "thread",
        source: "Founder email · saved last week",
        headline: "A portfolio CEO's update contradicts the growth narrative from Q3.",
        why: "Briefly connected their note to the metrics they shared in your last call.",
      },
    ],
  },
  {
    key: "pm",
    label: "Product managers",
    tagline: "User pain, competitor releases, and community signal — synthesized for standup.",
    follows: ["User communities", "Competitor changelogs", "Release notes", "Support themes"],
    adapts: [
      "Clusters recurring user pain from communities you follow",
      "Maps competitor ships to your roadmap priorities",
      "Writes standup-ready synthesis, not raw link dumps",
    ],
    items: [
      {
        tag: "breaking",
        source: "r/your-market · competitor release notes",
        headline: "The pain point your users keep raising just shipped — in a rival's changelog.",
        why: "It's been building in the community you track all week. Synthesis ready for standup.",
      },
      {
        tag: "thread",
        source: "Intercom themes · your product area",
        headline: "Onboarding friction spiked in a segment you've been watching.",
        why: "Connects to the experiment you discussed two sprints ago — same drop-off pattern.",
      },
      {
        tag: "signal",
        source: "Product Hunt · adjacent category",
        headline: "A new entrant is positioning on the workflow you deprioritized.",
        why: "Worth revisiting the PRD note where you flagged this as 'watch, not build'.",
      },
    ],
  },
  {
    key: "engineer",
    label: "Engineers",
    tagline: "Dependency changes, security advisories, and papers — filtered to your stack.",
    follows: ["GitHub releases", "HN & lobste.rs", "Security advisories", "Engineering blogs"],
    adapts: [
      "Tracks libraries and repos you've pinned or starred",
      "Explains migration impact — not just that a release exists",
      "Surfaces papers and posts connected to problems you're solving",
    ],
    items: [
      {
        tag: "breaking",
        source: "GitHub releases · dependency you pinned",
        headline: "A library in your stack shipped a breaking change in v3.",
        why: "You pinned v2 three weeks ago — migration delta and whether it actually touches you.",
      },
      {
        tag: "signal",
        source: "HN · security advisory",
        headline: "CVE affects a transitive dependency in your monorepo.",
        why: "Scoped to packages you actually import — not a generic security feed alert.",
      },
      {
        tag: "thread",
        source: "arXiv · method you've followed",
        headline: "New paper improves on the approach in your side-project README.",
        why: "Cites the implementation pattern you bookmarked last month.",
      },
    ],
  },
  {
    key: "researcher",
    label: "Researchers",
    tagline: "Paper threads, lab output, and citation chains — mapped to your reading history.",
    follows: ["arXiv feeds", "Lab blogs", "Journal alerts", "Citation networks"],
    adapts: [
      "Tracks methods and authors you've read before",
      "Explains how new work extends your active threads",
      "Filters preprint noise to papers that cite your corpus",
    ],
    items: [
      {
        tag: "breaking",
        source: "arXiv · thread you've followed",
        headline: "A new paper extends the method you've tracked for weeks.",
        why: "It cites the work you read in March — here's exactly how it moves your thread forward.",
      },
      {
        tag: "thread",
        source: "Lab blog · group you follow",
        headline: "A lab you watch pre-registered results on your open question.",
        why: "Connects to the hypothesis you saved in your literature notes.",
      },
      {
        tag: "signal",
        source: "Journal alert · adjacent field",
        headline: "A replication study challenges a baseline you rely on.",
        why: "Flags the statistical critique — not just the abstract summary.",
      },
    ],
  },
];

const TAG_LABEL: Record<BriefingItem["tag"], string> = {
  breaking: "Breaking",
  thread: "Thread",
  signal: "Signal",
};

function BriefingPreview({ persona, reducedMotion }: { persona: Persona; reducedMotion: boolean | null }) {
  return (
    <div className="personas-brief">
      <header className="personas-brief-head">
        <div>
          <p className="personas-brief-eyebrow">Your morning brief</p>
          <p className="personas-brief-meta">{persona.items.length} items · personalized</p>
        </div>
        <span className="personas-brief-live" aria-hidden>
          <span className="personas-brief-live-dot" />
          Live preview
        </span>
      </header>

      <ul className="personas-brief-list">
        {persona.items.map((item, i) => (
          <motion.li
            key={`${persona.key}-${i}`}
            className="personas-brief-item"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.38, delay: reducedMotion ? 0 : i * 0.08, ease: EASE }}
          >
            <div className="personas-brief-item-top">
              <span className={`personas-brief-tag personas-brief-tag--${item.tag}`}>
                {TAG_LABEL[item.tag]}
              </span>
              <span className="personas-brief-source">{item.source}</span>
            </div>
            <p className="personas-brief-headline">{item.headline}</p>
            <p className="personas-brief-why">
              <span className="personas-brief-why-label">Why it matters to you</span>
              {item.why}
            </p>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

export function Personas() {
  const sectionRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: false, margin: "-12% 0px" });
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!inView || paused || reducedMotion) return;
    const started = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - started;
      setProgress(Math.min(1, elapsed / ROTATE_MS));
      if (elapsed >= ROTATE_MS) {
        setActive((i) => (i + 1) % PERSONAS.length);
        setProgress(0);
      }
    }, 50);
    return () => window.clearInterval(tick);
  }, [inView, paused, reducedMotion, active]);

  const persona = PERSONAS[active];

  function selectPersona(i: number) {
    setActive(i);
    setProgress(0);
  }

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const activeBtn = rail.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    activeBtn?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [active]);

  return (
    <section
      className="personas-section landing-section landing-band-base"
      id="personas"
      ref={sectionRef}
    >
      <div className="landing-section-inner personas-inner">
        <Reveal>
          <div className="section-header-centered personas-header">
            <p className="section-eyebrow">Built for how you work</p>
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text="However you work, Briefly knows your world"
            />
            <p className="section-body personas-lead">
              One engine — your sources, your history. Pick a role to see what your morning
              brief actually looks like.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div
            className="personas-layout"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="personas-rail-wrap">
              <div className="personas-rail" ref={railRef} role="tablist" aria-label="Who Briefly is for">
                {PERSONAS.map((p, i) => (
                  <button
                    key={p.key}
                    type="button"
                    role="tab"
                    aria-selected={i === active}
                    className={`personas-rail-item${i === active ? " is-active" : ""}`}
                    onClick={() => selectPersona(i)}
                    onFocus={() => setPaused(true)}
                    onBlur={() => setPaused(false)}
                  >
                    <span className="personas-rail-label">{p.label}</span>
                    <span className="personas-rail-tagline">{p.tagline}</span>
                    {i === active && !reducedMotion ? (
                      <span
                        className="personas-rail-progress"
                        style={{ transform: `scaleX(${progress})` }}
                        aria-hidden
                      />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="personas-detail">
              <p className="personas-mobile-active" aria-live="polite">
                <span className="personas-mobile-active-label">{persona.label}</span>
                <span className="personas-mobile-active-tagline">{persona.tagline}</span>
              </p>
              <AnimatePresence mode="wait">
                <motion.div
                  key={persona.key}
                  className="personas-detail-panel"
                  initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.35, ease: EASE }}
                >
                  <div className="personas-sources-block">
                    <p className="personas-sources-label">Sources Briefly watches</p>
                    <ul className="personas-sources">
                      {persona.follows.map((src) => (
                        <li key={src} className="personas-source-chip">
                          {src}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <BriefingPreview persona={persona} reducedMotion={reducedMotion} />

                  <div className="personas-adapts">
                    <p className="personas-adapts-label">How Briefly adapts</p>
                    <ul className="personas-adapts-list">
                      {persona.adapts.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
