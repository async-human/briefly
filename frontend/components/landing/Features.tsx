"use client";

import React, { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

// ── Cursor-tracking spotlight card (Linear / Raycast signature effect) ────────
function SpotlightCard({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);

  function onMove(e: React.MouseEvent) {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

  return (
    <div
      ref={ref}
      className={`bento-card ${className}`}
      style={{
        ...style,
        background: hovered
          ? `radial-gradient(320px circle at ${pos.x}px ${pos.y}px, rgba(201,184,150,0.09) 0%, transparent 65%), var(--surface)`
          : "var(--surface)",
      }}
      onMouseMove={onMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </div>
  );
}

const features = [
  {
    num: "01",
    title: "Builds itself while you sleep",
    desc: "Connect Gmail, YouTube, Reddit, and any RSS feed once. Every night, Briefly fetches everything automatically. No saving, tagging, or organising — ever.",
    icon: "⚡",
    size: "large",
    sources: ["Gmail", "YouTube", "Reddit", "RSS", "Readwise", "HN"],
  },
  {
    num: "02",
    title: "Remembers what you read",
    desc: "Today's story connects to what you read last week. \"Update to the thread you've been following since March.\" The reading finally compounds.",
    icon: "◎",
    size: "small",
  },
  {
    num: "03",
    title: "Written specifically for you",
    desc: "Every item explains why it matters to your role, goals, and history — not why it's generally important.",
    icon: "✦",
    size: "small",
  },
  {
    num: "04",
    title: "Confident, not comprehensive",
    desc: "Reads 50 items, shows 10. Then tells you exactly what it skipped and why. You know what you're missing.",
    icon: "◌",
    size: "small",
  },
];

export function Features() {
  return (
    <section className="features-v2" id="features">
      <div className="features-v2-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Why Briefly</p>
            <h2 className="section-heading">
              Not another tool to maintain
            </h2>
            <p className="section-body">
              Notion dies when you stop feeding it. Feedly is a firehose.
              Readwise needs you to highlight first.
              <br />
              Briefly needs nothing except the accounts you already have.
            </p>
          </div>
        </Reveal>

        {/* Bento grid */}
        <div className="bento-grid">
          {/* Large card — top left, spans 2 rows */}
          <Reveal delay={0}>
            <motion.div whileHover={{ y: -4, transition: { duration: 0.2 } }} className="bento-cell bento-large">
              <SpotlightCard className="bento-card-inner">
                <div className="bento-top">
                  <span className="bento-icon">{features[0].icon}</span>
                  <span className="bento-num">{features[0].num}</span>
                </div>
                <h3 className="bento-title bento-title-lg">{features[0].title}</h3>
                <p className="bento-desc">{features[0].desc}</p>
                {/* Source pills */}
                <div className="bento-source-pills">
                  {features[0].sources!.map((s) => (
                    <span key={s} className="bento-pill">{s}</span>
                  ))}
                </div>
              </SpotlightCard>
            </motion.div>
          </Reveal>

          {/* Small cards */}
          {features.slice(1).map((f, i) => (
            <Reveal key={f.num} delay={0.08 + i * 0.07}>
              <motion.div whileHover={{ y: -4, transition: { duration: 0.2 } }} className="bento-cell">
                <SpotlightCard className="bento-card-inner">
                  <div className="bento-top">
                    <span className="bento-icon">{f.icon}</span>
                    <span className="bento-num">{f.num}</span>
                  </div>
                  <h3 className="bento-title">{f.title}</h3>
                  <p className="bento-desc">{f.desc}</p>
                </SpotlightCard>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
