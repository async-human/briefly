"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const steps = [
  {
    num: "01",
    icon: "⬡",
    label: "Connect",
    sub: "Link your Gmail, YouTube, Reddit & RSS in 3 minutes",
    color: "rgba(201,184,150,0.1)",
    border: "rgba(201,184,150,0.2)",
  },
  {
    num: "02",
    icon: "◌",
    label: "Reads overnight",
    sub: "Briefly processes everything while you sleep",
    color: "rgba(91,71,224,0.08)",
    border: "rgba(91,71,224,0.2)",
  },
  {
    num: "03",
    icon: "◎",
    label: "In your inbox",
    sub: "Personalised briefing lands at 7am every morning",
    color: "rgba(201,184,150,0.1)",
    border: "rgba(201,184,150,0.2)",
  },
  {
    num: "04",
    icon: "✦",
    label: "Gets smarter",
    sub: "Learns from every briefing. Day 90 feels like magic",
    color: "rgba(56,189,248,0.06)",
    border: "rgba(56,189,248,0.15)",
  },
];

export function CTA() {
  return (
    <section className="cta-v2" id="start">
      <div className="cta-bg" aria-hidden>
        <div className="cta-orb" />
      </div>

      <div className="cta-v2-inner" style={{ maxWidth: 860 }}>
        <Reveal>
          <p className="section-eyebrow" style={{ textAlign: "center", marginBottom: 20 }}>
            Ready?
          </p>
          <h2 className="cta-v2-headline">
            Your second brain
            <br />
            <span className="hero-gradient-text">starts tonight</span>
          </h2>
        </Reveal>

        <Reveal delay={0.1}>
          <p className="cta-v2-sub">
            Connect your accounts in 3 minutes. Briefly runs tonight.
            <br />
            Your first personalised briefing lands tomorrow at 7am.
          </p>
        </Reveal>

        <Reveal delay={0.18}>
          <div className="cta-v2-actions">
            <a href="/login" className="btn-hero-primary btn-cta-large">
              Start building yours free
              <span className="btn-arrow">→</span>
            </a>
            <p className="cta-fine-print">
              Free to start · No credit card · First briefing tomorrow
            </p>
          </div>
        </Reveal>

        {/* Step cards */}
        <div className="cta-steps-row">
          {steps.map((step, i) => (
            <motion.div
              key={step.num}
              className="cta-step-card"
              style={
                {
                  "--step-color": step.color,
                  "--step-border": step.border,
                } as React.CSSProperties
              }
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: 0.1 + i * 0.1, duration: 0.5, type: "spring", bounce: 0.25 }}
              whileHover={{ y: -4, transition: { duration: 0.18 } }}
            >
              <span className="cta-step-icon">{step.icon}</span>
              <span className="cta-step-num">{step.num}</span>
              <p className="cta-step-label">{step.label}</p>
              <p className="cta-step-sub">{step.sub}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
