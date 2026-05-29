"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const loop = [
  { num: "01", label: "Connect your sources" },
  { num: "02", label: "Briefly reads overnight" },
  { num: "03", label: "Briefing in your inbox" },
  { num: "04", label: "Gets smarter every day" },
];

export function CTA() {
  return (
    <section className="cta-v2" id="start">
      <div className="cta-bg" aria-hidden>
        <div className="cta-orb" />
      </div>

      <div className="cta-v2-inner">
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

        <Reveal delay={0.28}>
          <div className="cta-loop">
            {loop.map((step, i) => (
              <motion.div
                key={step.num}
                className="cta-loop-item"
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.35 + i * 0.08, duration: 0.5 }}
              >
                <span className="cta-loop-num">{step.num}</span>
                <span className="cta-loop-label">{step.label}</span>
                {i < loop.length - 1 && (
                  <span className="cta-loop-arrow" aria-hidden>→</span>
                )}
              </motion.div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
