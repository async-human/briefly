"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { Reveal } from "./Reveal";
import { StaggerHeadline } from "./StaggerHeadline";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type Scenario = {
  kind: "connection" | "contradiction";
  tab: string;
  past: { date: string; source: string; text: string };
  present: { date: string; source: string; text: string };
  insightLabel: string;
  insight: string;
};

const SCENARIOS: Scenario[] = [
  {
    kind: "connection",
    tab: "Continues a thread",
    past: {
      date: "3 weeks ago",
      source: "The Information",
      text: "Perplexity is quietly exploring autonomous browser agents",
    },
    present: {
      date: "This morning",
      source: "TechCrunch · ×3 sources",
      text: "Perplexity raises $500M to build an autonomous browser agent",
    },
    insightLabel: "Memory connection",
    insight:
      "You've been tracking the search-to-agent shift for 3 weeks. This is the biggest signal yet that the pivot is real — and now funded.",
  },
  {
    kind: "contradiction",
    tab: "Challenges your view",
    past: {
      date: "Last month",
      source: "Your voice note",
      text: "“Quick commerce is still ~3 years from real profitability.”",
    },
    present: {
      date: "This morning",
      source: "YourStory",
      text: "Zepto hits ₹5,000 Cr GMV — profitability achievable within 18 months",
    },
    insightLabel: "Contradicts what you said",
    insight:
      "This cuts against the timeline you noted last month. The profitability window may be closing faster than you thought — worth a fresh look.",
  },
];

const CYCLE_MS = 7000;

function MemoryThread({ scenario }: { scenario: Scenario }) {
  const isContradiction = scenario.kind === "contradiction";

  return (
    <div className={`memory-thread memory-thread--${scenario.kind}`}>
      <motion.div
        className="memory-node memory-node--past"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <div className="memory-node-meta">
          <span className="memory-node-date">{scenario.past.date}</span>
          <span className="memory-node-source">{scenario.past.source}</span>
        </div>
        <p className="memory-node-text">{scenario.past.text}</p>
      </motion.div>

      <div className="memory-connector" aria-hidden>
        <motion.span
          className="memory-connector-line"
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.55, delay: 0.45, ease: EASE }}
        />
        <motion.span
          className="memory-connector-pulse"
          initial={{ opacity: 0, top: "0%" }}
          animate={{ opacity: [0, 1, 1, 0], top: ["0%", "40%", "60%", "100%"] }}
          transition={{ duration: 1.1, delay: 0.5, ease: "easeInOut" }}
        />
      </div>

      <motion.div
        className="memory-node memory-node--present"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.9, ease: EASE }}
      >
        <div className="memory-node-meta">
          <span className="memory-node-date memory-node-date--now">{scenario.present.date}</span>
          <span className="memory-node-source">{scenario.present.source}</span>
        </div>
        <p className="memory-node-text">{scenario.present.text}</p>
      </motion.div>

      <motion.div
        className={`memory-insight memory-insight--${scenario.kind}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 1.35, ease: EASE }}
      >
        <span className="memory-insight-label">
          <span className={`memory-insight-dot${isContradiction ? " is-warn" : ""}`} aria-hidden />
          {scenario.insightLabel}
        </span>
        <p className="memory-insight-text">{scenario.insight}</p>
      </motion.div>
    </div>
  );
}

export function MemoryDemo() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (paused || reducedMotion) return;
    const t = setTimeout(() => setActive((i) => (i + 1) % SCENARIOS.length), CYCLE_MS);
    return () => clearTimeout(t);
  }, [active, paused, reducedMotion]);

  const scenario = SCENARIOS[active];

  return (
    <section className="memory-demo landing-section landing-band-warm" id="memory">
      <div className="memory-demo-inner landing-section-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Compounding memory</p>
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text={"It remembers what you read —\nthen connects today to it."}
            />
            <p className="section-body">
              Every other tool forgets the moment you close it. Briefly builds a memory of
              what you&apos;ve read and the views you&apos;ve formed, so each morning&apos;s story
              arrives already tied to the thread you&apos;ve been following. Day one, it&apos;s a
              digest anyone could clone. Day ninety, it&apos;s an intelligence layer that knows
              your thinking.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div
            className="memory-stage"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="memory-tabs" role="tablist" aria-label="Memory examples">
              {SCENARIOS.map((s, i) => (
                <button
                  key={s.kind}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className={`memory-tab${i === active ? " active" : ""}`}
                  onClick={() => setActive(i)}
                >
                  {s.tab}
                </button>
              ))}
            </div>

            <div className="memory-stage-body">
              <AnimatePresence mode="wait">
                <motion.div
                  key={scenario.kind}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                >
                  <MemoryThread scenario={scenario} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
