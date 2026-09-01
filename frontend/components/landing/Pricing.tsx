"use client";

import { motion } from "framer-motion";
import { Reveal } from "./Reveal";
import { StaggerHeadline } from "./StaggerHeadline";
import {
  FREE_FEATURES,
  PRO_FEATURES,
  PRO_MONTHLY_PRICE,
  PRO_YEARLY_PRICE,
  PRO_PRICING_HEADLINE,
  PRO_FOUNDING_NOTE,
} from "@/lib/plans";

const freeFeatures = FREE_FEATURES;
const proFeatures = PRO_FEATURES;

function Check({ dim }: { dim?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      className={`pricing-check${dim ? " pricing-check-dim" : ""}`}
      style={{ flexShrink: 0 }}
    >
      <circle cx="7" cy="7" r="6.5" className="pricing-check-ring" />
      {!dim && (
        <path
          d="M4 7l2 2 4-4"
          className="pricing-check-mark"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {dim && (
        <path d="M5 7h4" className="pricing-check-mark" strokeWidth="1.5" strokeLinecap="round" />
      )}
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
            <StaggerHeadline
              as="h2"
              trigger="inView"
              className="section-heading"
              text={"Start free.\nUpgrade when a signal changes a decision."}
            />
            <p className="section-body">
              Free shows the format. Pro is for founders who need cited change detection
              and decision threads on their competitive universe.
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
                  <p className="pricing-v2-name">{PRO_PRICING_HEADLINE}</p>
                  <span className="pricing-pro-badge">Pro</span>
                </div>
                <div className="pricing-v2-price-row">
                  <span className="pricing-v2-amount">${PRO_MONTHLY_PRICE}</span>
                  <div className="pricing-v2-period-stack">
                    <span className="pricing-v2-period">/ month</span>
                    <span className="pricing-v2-annual">or ${PRO_YEARLY_PRICE}/year</span>
                  </div>
                </div>
                <p className="pricing-founding-cap">{PRO_FOUNDING_NOTE}</p>
                <p className="pricing-v2-tagline">
                  Cited signals, decision threads, unlimited watches
                </p>
              </div>
              <ul className="pricing-v2-features">
                {proFeatures.map((f) => (
                  <li key={f.text} className="pricing-v2-feature">
                    <Check />
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
              <a href="/upgrade" className="pricing-v2-btn pricing-v2-btn-pro">
                Get Founder Intelligence — ${PRO_MONTHLY_PRICE}/month
              </a>
            </motion.div>
          </div>
        </Reveal>

        <Reveal delay={0.2}>
          <p className="pricing-footnote">
            Cancel anytime. Your sources, briefings, and history stay yours —
            export everything, no lock-in.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
