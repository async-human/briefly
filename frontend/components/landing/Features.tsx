"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const features = [
  {
    num: "01",
    title: "Builds itself while you sleep",
    desc: "Connect Gmail, YouTube, Reddit, and any RSS feed once. Every night, Briefly fetches everything automatically. No saving, tagging, or organising — ever.",
    icon: "⚡",
    accent: "rgba(201,184,150,0.12)",
  },
  {
    num: "02",
    title: "Remembers what you read",
    desc: "Today's story gets connected to what you read last week. \"Update to the thread you've been following since March.\" The reading finally compounds.",
    icon: "🧠",
    accent: "rgba(91,71,224,0.1)",
  },
  {
    num: "03",
    title: "Written specifically for you",
    desc: "Every item explains why it matters to your role, goals, and history — not why it's generally important. Your briefing reads nothing like anyone else's.",
    icon: "✦",
    accent: "rgba(201,184,150,0.12)",
  },
  {
    num: "04",
    title: "Confident, not comprehensive",
    desc: "Briefly reads 50 items and shows you 10. Then tells you exactly what it skipped and why. You know what you're missing. That's the point.",
    icon: "◎",
    accent: "rgba(91,71,224,0.1)",
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

        <div className="feature-cards-grid">
          {features.map((f, i) => (
            <Reveal key={f.num} delay={i * 0.07}>
              <motion.div
                className="feature-card-v2"
                style={{ "--card-accent": f.accent } as React.CSSProperties}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
              >
                <div className="feature-card-glow" aria-hidden />
                <div className="feature-card-top">
                  <span className="feature-card-icon">{f.icon}</span>
                  <span className="feature-card-num">{f.num}</span>
                </div>
                <h3 className="feature-card-title">{f.title}</h3>
                <p className="feature-card-desc">{f.desc}</p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
