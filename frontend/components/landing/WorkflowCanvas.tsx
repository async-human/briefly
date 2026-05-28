"use client";

import { motion } from "framer-motion";

const sources = [
  { name: "The Rundown AI", count: 12 },
  { name: "Stratechery", count: 8 },
  { name: "r/MachineLearning", count: 23 },
  { name: "YouTube · Lenny's Podcast", count: 4 },
];

export function GatherPhase({ activeCount }: { activeCount: number }) {
  return (
    <div className="canvas-area">
      <div className="source-grid">
        {sources.map((source, i) => (
          <motion.div
            key={source.name}
            className={`source-pill${i < activeCount ? " active" : ""}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: i < activeCount ? 1 : 0.35, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.15 }}
          >
            <span className="source-pill-dot" />
            <span>{source.name}</span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-muted)" }}>
              {i < activeCount ? source.count : "—"}
            </span>
          </motion.div>
        ))}
      </div>
      <motion.div
        className="incoming-counter"
        initial={{ opacity: 0 }}
        animate={{ opacity: activeCount >= 4 ? 1 : 0.5 }}
        transition={{ duration: 0.3 }}
      >
        {activeCount >= 4 ? "47 items collected from 12 sources" : "Connecting sources…"}
      </motion.div>
    </div>
  );
}

const rawItems = [
  { text: "Anthropic Claude 4 — 40% agentic improvement", dup: false },
  { text: "Claude 4 benchmarks show tool use gains", dup: true },
  { text: "Anthropic releases Claude 4 model", dup: true },
  { text: "Remote work is dead (again)", dup: false, skip: true },
  { text: "Bitcoin hits new ATH", dup: false, skip: true },
];

export function FilterPhase({ stage }: { stage: number }) {
  return (
    <div className="canvas-area">
      <div className="filter-stack">
        {rawItems.map((item, i) => {
          let className = "filter-card";
          if (stage >= 2 && item.dup) className += " duplicate";
          if (stage >= 3 && item.dup && i === 0) className += " merged";
          if (stage >= 3 && item.dup && i > 0) className += " skipped";
          if (stage >= 3 && item.skip) className += " skipped";

          if (stage >= 3 && item.dup && i > 0) return null;
          if (stage >= 3 && item.skip) return null;

          const displayText =
            stage >= 3 && item.dup && i === 0
              ? "Anthropic Claude 4 — 40% agentic improvement · 3 sources"
              : item.text;

          return (
            <motion.div
              key={item.text}
              className={className}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: i * 0.1 }}
              layout
            >
              {displayText}
            </motion.div>
          );
        })}
      </div>
      {stage >= 3 && (
        <motion.p
          className="skipped-line"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <span>39 items filtered</span> — duplicates, off-topic, already seen
        </motion.p>
      )}
    </div>
  );
}

export function PersonalizePhase({ typedChars }: { typedChars: number }) {
  const fullText =
    "As someone building an agent-based product, the 40% improvement in tool-use reliability changes how much you can trust multi-step chains without human oversight.";

  return (
    <div className="canvas-area">
      <div className="personalize-block">
        <p className="personalize-generic">
          Anthropic released Claude 4 with improved reasoning capabilities.
        </p>
        <div className="personalize-label">Why this matters to you</div>
        <p className="personalize-tailored">
          {fullText.slice(0, typedChars)}
          {typedChars < fullText.length && (
            <span style={{ display: "inline-block", width: 1, height: 12, background: "var(--accent)", marginLeft: 1, verticalAlign: "middle" }} />
          )}
        </p>
      </div>
    </div>
  );
}

const deliverItems = [
  {
    source: "The Rundown AI · TechCrunch · Wired",
    headline: "Anthropic's Claude 4 shows 40% improvement on agentic tasks",
    why: "As someone building an agent-based product, this directly affects how much you can trust multi-step tool calls.",
  },
  {
    source: "Stratechery",
    headline: "The platform shift from search to autonomous agents is accelerating",
    why: "You've been tracking the search-to-agent shift for 3 weeks. This confirms the timeline.",
  },
  {
    source: "YourStory",
    headline: "Zepto hits profitability milestone — quick commerce unit economics improve",
    why: "Update to the thread you've followed since March. Timeline moved up 6 months.",
  },
];

export function DeliverPhase({ visibleCount }: { visibleCount: number }) {
  return (
    <div className="canvas-area">
      <div className="digest-meta">
        <span className="digest-date">Thursday, May 28</span>
        <span className="digest-count">{Math.min(visibleCount * 3, 10)} / 10 items</span>
      </div>
      <p className="digest-greeting">Good morning</p>
      <p className="digest-summary">8 items from 47 sources. Here&apos;s what matters.</p>
      <div className="deliver-list">
        {deliverItems.map((item, i) => (
          <motion.div
            key={item.headline}
            className="digest-item"
            initial={{ opacity: 0, y: 10 }}
            animate={i < visibleCount ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          >
            <div className="item-source">{item.source}</div>
            <div className="item-headline">{item.headline}</div>
            <div className="item-why">{item.why}</div>
          </motion.div>
        ))}
      </div>
      {visibleCount >= 3 && (
        <motion.p
          className="skipped-line"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <span>39 stories skipped</span> — crypto updates, remote work trends, duplicates
        </motion.p>
      )}
    </div>
  );
}
