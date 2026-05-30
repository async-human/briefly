"use client";

import { useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Reveal } from "./Reveal";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const stages = [
  {
    num: "01",
    version: "V1",
    status: "now" as const,
    icon: "⚡",
    name: "Self-Building Digest",
    tagline: "The core loop. Reads everything. Writes for you.",
    features: [
      "Gmail, YouTube, Reddit, RSS — connected once",
      "Personalised 8–14 item morning briefing",
      "Why-it-matters-to-you on every item",
      "Email delivery at your chosen time",
      "Source suggestions + Readwise integration",
    ],
  },
  {
    num: "02",
    version: "V2",
    status: "coming" as const,
    icon: "✏",
    name: "Manual Capture Layer",
    tagline: "Add your own voice to the second brain.",
    features: [
      "Paste any link — Briefly fetches and indexes it",
      "Write a note — free-form text into knowledge base",
      "Voice note — speak a thought, Briefly structures it",
      "Upload documents — PDF, Word, text ingested",
      "Browser extension — one-click save from anywhere",
    ],
  },
  {
    num: "03",
    version: "V3",
    status: "coming" as const,
    icon: "◎",
    name: "Ask Briefly",
    tagline: "Conversational search across everything it knows.",
    features: [
      "Ask questions across your full knowledge base",
      "Synthesised answers with citations — not just results",
      '"What have I read about X in the last month?"',
      "Follow-up questions on any digest item",
      "Weekly memory digest — themes and what to revisit",
    ],
  },
  {
    num: "04",
    version: "V4",
    status: "vision" as const,
    icon: "✦",
    name: "Knowledge Graph",
    tagline: "Proactive intelligence that works for you in the background.",
    features: [
      "Entities, topics, ideas connected across all content",
      "Story threads tracked across sources and time",
      '"This connects to something you saved 3 weeks ago"',
      "Proactive resurfacing when context becomes relevant",
      "Twitter/X integration + mobile app",
    ],
  },
];

const STATUS = {
  now:    { badge: "Live now",    cls: "roadmap-badge-now",    opacity: 1    },
  coming: { badge: "Coming soon", cls: "roadmap-badge-coming", opacity: 0.65 },
  vision: { badge: "Vision",      cls: "roadmap-badge-vision", opacity: 0.38 },
};

function RoadmapCard({ stage, index }: { stage: typeof stages[0]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px 0px" });
  const cfg = STATUS[stage.status];

  return (
    <motion.div
      ref={ref}
      className={`rm2-card rm2-card-${stage.status}`}
      initial={{ opacity: 0, y: 36 }}
      whileInView={{ opacity: cfg.opacity, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: EASE, delay: index * 0.1 }}
      whileHover={
        stage.status !== "vision"
          ? { y: -6, transition: { duration: 0.22, ease: EASE } }
          : {}
      }
    >
      {/* Ambient glow — V1 only */}
      {stage.status === "now" && <div className="rm2-glow" aria-hidden />}

      {/* Large background watermark number */}
      <span className="rm2-watermark" aria-hidden>{stage.num}</span>

      {/* Top row: icon + status badge */}
      <div className="rm2-top">
        <div className={`rm2-icon-wrap rm2-icon-wrap-${stage.status}`}>
          <span className="rm2-icon-inner">{stage.icon}</span>
        </div>
        <span className={`roadmap-badge ${cfg.cls}`}>{cfg.badge}</span>
      </div>

      {/* Identity */}
      <div className="rm2-identity">
        <span className="rm2-ver">{stage.version}</span>
        <h3 className="rm2-name">{stage.name}</h3>
        <p className="rm2-tagline">{stage.tagline}</p>
      </div>

      {/* Feature list — items stagger in as card enters viewport */}
      <ul className="rm2-features">
        {stage.features.map((f, fi) => (
          <motion.li
            key={f}
            className="rm2-feature"
            initial={{ opacity: 0, x: -10 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.32, ease: EASE, delay: 0.28 + fi * 0.06 }}
          >
            <span className="rm2-bullet" aria-hidden>
              {stage.status === "now" ? "✓" : "○"}
            </span>
            {f}
          </motion.li>
        ))}
      </ul>

      {stage.status === "now" && (
        <a href="/login" className="rm2-cta">
          Start with V1 free →
        </a>
      )}
    </motion.div>
  );
}

/* Horizontal progress track above the grid */
function ProgressTrack() {
  return (
    <Reveal delay={0.12}>
      <div className="rm2-track">
        {stages.map((stage, i) => {
          const isLive = stage.status === "now";
          return (
            <div key={stage.version} className="rm2-track-item">
              {/* Connector line before this dot (except first) */}
              {i > 0 && (
                <div className={`rm2-track-line ${i === 1 ? "rm2-line-accent" : ""}`} />
              )}

              {/* Dot */}
              <div className={`rm2-track-dot${isLive ? " rm2-track-dot-live" : ""}`}>
                <span className="rm2-track-icon">{stage.icon}</span>
              </div>

              {/* Label */}
              <span className={`rm2-track-label${isLive ? " rm2-track-label-live" : ""}`}>
                {stage.version}
              </span>
            </div>
          );
        })}
      </div>
    </Reveal>
  );
}

export function Roadmap() {
  return (
    <section className="roadmap-section" id="roadmap">
      <div className="roadmap-inner">

        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Roadmap</p>
            <h2 className="section-heading">
              You&apos;re joining at V1.
              <br />
              <span className="hero-gradient-text">Here&apos;s where we&apos;re taking you.</span>
            </h2>
            <p className="section-body">
              Each version ships independently and is valuable on its own.
              Pro members get every version as it ships — no price increase.
            </p>
          </div>
        </Reveal>

        <ProgressTrack />

        {/* 2-column card grid */}
        <div className="rm2-grid">
          {stages.map((stage, i) => (
            <RoadmapCard key={stage.version} stage={stage} index={i} />
          ))}
        </div>

        <Reveal delay={0.3}>
          <p className="roadmap-footnote">
            Pro members get V2, V3, and V4 as they ship — included in the $9/month.
            No price changes, no re-subscription.
            <br />
            The earlier you join, the more you benefit from the compounding.
          </p>
        </Reveal>

      </div>
    </section>
  );
}
