"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const stages = [
  {
    version: "V1",
    status: "now" as const,
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
    version: "V2",
    status: "coming" as const,
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
    version: "V3",
    status: "coming" as const,
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
    version: "V4",
    status: "vision" as const,
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

const STATUS_CONFIG = {
  now: {
    badge: "Available now",
    badgeClass: "roadmap-badge-now",
    opacity: 1,
    borderColor: "rgba(201,184,150,0.3)",
    glow: true,
  },
  coming: {
    badge: "Coming soon",
    badgeClass: "roadmap-badge-coming",
    opacity: 0.6,
    borderColor: "rgba(255,255,255,0.07)",
    glow: false,
  },
  vision: {
    badge: "Vision",
    badgeClass: "roadmap-badge-vision",
    opacity: 0.38,
    borderColor: "rgba(255,255,255,0.05)",
    glow: false,
  },
};

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
              Each version ships independently and is valuable on its own. Pro members get every version
              as it ships — no price increase, no re-subscription.
            </p>
          </div>
        </Reveal>

        {/* Timeline connector line */}
        <div className="roadmap-timeline" aria-hidden>
          <motion.div
            className="roadmap-timeline-fill"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
          />
          {stages.map((s, i) => (
            <div
              key={s.version}
              className={`roadmap-dot${s.status === "now" ? " roadmap-dot-now" : ""}`}
              style={{ left: `${(i / (stages.length - 1)) * 100}%` }}
            />
          ))}
        </div>

        {/* Stage cards */}
        <div className="roadmap-cards">
          {stages.map((stage, i) => {
            const cfg = STATUS_CONFIG[stage.status];
            return (
              <motion.div
                key={stage.version}
                className={`roadmap-card roadmap-card-${stage.status}`}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: cfg.opacity, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: 0.1 + i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                whileHover={
                  stage.status === "now"
                    ? { y: -6, transition: { duration: 0.2 } }
                    : { opacity: Math.min(cfg.opacity + 0.15, 0.85), transition: { duration: 0.2 } }
                }
                style={{ borderColor: cfg.borderColor }}
              >
                {cfg.glow && <div className="roadmap-card-glow" aria-hidden />}

                <div className="roadmap-card-top">
                  <span className="roadmap-version">{stage.version}</span>
                  <span className={`roadmap-badge ${cfg.badgeClass}`}>{cfg.badge}</span>
                </div>

                <h3 className="roadmap-card-name">{stage.name}</h3>
                <p className="roadmap-card-tagline">{stage.tagline}</p>

                <ul className="roadmap-features">
                  {stage.features.map((f) => (
                    <li key={f} className="roadmap-feature">
                      <span className="roadmap-check" aria-hidden>
                        {stage.status === "now" ? "✓" : "◌"}
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                {stage.status === "now" && (
                  <a href="/login" className="roadmap-cta-btn">
                    Start with V1 free →
                  </a>
                )}
              </motion.div>
            );
          })}
        </div>

        <Reveal delay={0.3}>
          <p className="roadmap-footnote">
            Pro members get V2, V3, and V4 as they ship — included in the $9/month. No price changes, no re-subscription.
            <br />
            The earlier you join, the more you benefit from the compounding.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
