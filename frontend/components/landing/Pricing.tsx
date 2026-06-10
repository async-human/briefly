"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";

const freeFeatures = [
  { text: "3 source connections", included: true },
  { text: "5 items per briefing", included: true },
  { text: "Gmail, YouTube, Reddit, RSS", included: true },
  { text: "7-day history", included: true },
  { text: "Email delivery", included: true },
  { text: "Manual capture", included: false },
  { text: "Interest learning", included: false },
  { text: "Ask Briefly", included: false },
];

const proFeatures = [
  { text: "Unlimited source connections", included: true },
  { text: "Full briefing, 8–14 items", included: true },
  { text: "All source types + Readwise", included: true },
  { text: "Unlimited history", included: true },
  { text: "Interest learning — gets smarter daily", included: true },
  { text: "Manual capture: links, notes, docs", included: true },
  { text: "Ask Briefly — search your knowledge base", included: true },
  { text: "Audio brief for your commute", included: true },
  { text: "Priority support", included: true },
];

function Check({ dim }: { dim?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="6.5" stroke={dim ? "rgba(255,255,255,0.12)" : "rgba(201,184,150,0.4)"} />
      {!dim && <path d="M4 7l2 2 4-4" stroke="#c9b896" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
      {dim && <path d="M5 7h4" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

export function Pricing() {
  return (
    <section className="pricing-v2 landing-section landing-band-mint" id="pricing">
      <div className="pricing-v2-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Pricing</p>
            <h2 className="section-heading">
              Start free.<br />Upgrade when it&apos;s indispensable.
            </h2>
            <p className="section-body">
              Free is enough to feel the value. Pro is what it becomes when you
              can&apos;t live without it.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="pricing-v2-cards">
            {/* Free card */}
            <motion.div
              className="pricing-v2-card"
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
            >
              <div className="pricing-card-header">
                <p className="pricing-v2-name">Free</p>
                <div className="pricing-v2-price-row">
                  <span className="pricing-v2-amount">$0</span>
                  <span className="pricing-v2-period">forever</span>
                </div>
                <p className="pricing-v2-tagline">
                  Everything you need to feel the value
                </p>
              </div>
              <ul className="pricing-v2-features">
                {freeFeatures.map((f) => (
                  <li key={f.text} className={`pricing-v2-feature${f.included ? "" : " dim"}`}>
                    <Check dim={!f.included} />
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
              <a href="/login" className="pricing-v2-btn pricing-v2-btn-ghost">
                Get started free
              </a>
            </motion.div>

            {/* Pro card */}
            <motion.div
              className="pricing-v2-card pricing-v2-card-pro"
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
            >
              <div className="pricing-pro-glow" aria-hidden />
              <div className="pricing-card-header">
                <div className="pricing-pro-top">
                  <p className="pricing-v2-name">Pro</p>
                  <span className="pricing-pro-badge">Founding Price</span>
                </div>
                <div className="pricing-v2-price-row">
                  <span className="pricing-v2-amount">$9</span>
                  <div className="pricing-v2-period-stack">
                    <span className="pricing-v2-period">/ month</span>
                    <span className="pricing-v2-annual">or $90/year · save 17%</span>
                  </div>
                </div>
                <p className="pricing-founding-cap">
                  First 200 founding members · price locked forever
                </p>
                <p className="pricing-v2-tagline">
                  V2, V3 &amp; V4 included as they ship
                </p>
              </div>
              <ul className="pricing-v2-features">
                {proFeatures.map((f) => (
                  <li key={f.text} className="pricing-v2-feature">
                    <Check />
                    <span>
                      {f.text}
                      {f.soon && (
                        <span className="pricing-soon-badge">Soon</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <a href="/login" className="pricing-v2-btn pricing-v2-btn-pro">
                Get Pro — $9/month
              </a>
            </motion.div>
          </div>
        </Reveal>

        <Reveal delay={0.2}>
          <p className="pricing-footnote">
            LLM pipeline costs ~$0.20/user/day. Break-even at 400 paying users.
            Every dollar above that goes into making Briefly smarter.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
