"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const stages = [
  {
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
  now:    { badge: "Live now",    badgeClass: "roadmap-badge-now",    opacity: 1,    dim: false },
  coming: { badge: "Coming soon", badgeClass: "roadmap-badge-coming", opacity: 0.62, dim: true  },
  vision: { badge: "Vision",      badgeClass: "roadmap-badge-vision", opacity: 0.38, dim: true  },
};

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

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

        {/* ── Vertical timeline ── */}
        <div className="rm-timeline">
          {stages.map((stage, i) => {
            const cfg = STATUS[stage.status];
            const isLast = i === stages.length - 1;

            return (
              <div key={stage.version} className="rm-row">

                {/* Spine: icon dot + connecting line */}
                <div className="rm-spine" aria-hidden>
                  <div className={`rm-icon-wrap${stage.status === "now" ? " rm-icon-live" : ""}`}>
                    <span className="rm-icon">{stage.icon}</span>
                  </div>
                  {!isLast && <div className="rm-connector" />}
                </div>

                {/* Card */}
                <motion.div
                  className={`rm-card${stage.status === "now" ? " rm-card-live" : ""}`}
                  style={{ opacity: cfg.opacity }}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: cfg.opacity, x: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ delay: i * 0.1, duration: 0.55, ease: EASE }}
                >
                  <div className="rm-card-header">
                    <span className="rm-ver">{stage.version}</span>
                    <span className={`roadmap-badge ${cfg.badgeClass}`}>{cfg.badge}</span>
                  </div>

                  <h3 className="rm-name">{stage.name}</h3>
                  <p className="rm-tagline">{stage.tagline}</p>

                  <ul className="rm-features">
                    {stage.features.map((f) => (
                      <li key={f} className="rm-feature">
                        <span className="rm-check" aria-hidden>
                          {stage.status === "now" ? "✓" : "◌"}
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>

                  {stage.status === "now" && (
                    <a href="/login" className="rm-cta">
                      Start with V1 free →
                    </a>
                  )}
                </motion.div>

              </div>
            );
          })}
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
