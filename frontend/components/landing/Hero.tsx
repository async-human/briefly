"use client";

import { motion } from "framer-motion";
import { ProductPreview } from "./ProductPreview";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] },
});

export function Hero() {
  return (
    <section className="hero-v2">
      {/* Ambient background */}
      <div className="hero-bg" aria-hidden>
        <div className="hero-orb hero-orb-gold" />
        <div className="hero-orb hero-orb-purple" />
        <div className="hero-orb hero-orb-blue" />
        <div className="hero-noise" />
      </div>

      <div className="hero-inner">
        {/* Left column */}
        <div className="hero-left">
          <motion.div className="hero-badge" {...fadeUp(0.1)}>
            <span className="hero-badge-pulse" />
            Self-building second brain
          </motion.div>

          <motion.h1 className="hero-v2-headline" {...fadeUp(0.2)}>
            The second brain
            <br />
            <span className="hero-gradient-text">that builds itself</span>
          </motion.h1>

          <motion.p className="hero-v2-sub" {...fadeUp(0.35)}>
            Connect your accounts once. Briefly reads every newsletter, channel,
            and feed you follow — then sends a personalised briefing that gets
            smarter every single day. Zero maintenance. Forever.
          </motion.p>

          <motion.div className="hero-actions-row" {...fadeUp(0.48)}>
            <a href="/login" className="btn-hero-primary">
              Start building yours free
              <span className="btn-arrow">→</span>
            </a>
            <a href="#how" className="btn-hero-ghost">
              See how it works
            </a>
          </motion.div>

          <motion.div className="hero-stats-row" {...fadeUp(0.58)}>
            <div className="hero-stat">
              <span className="hero-stat-num">12+</span>
              <span className="hero-stat-label">source types</span>
            </div>
            <span className="hero-stat-sep" />
            <div className="hero-stat">
              <span className="hero-stat-num">8–14</span>
              <span className="hero-stat-label">items per briefing</span>
            </div>
            <span className="hero-stat-sep" />
            <div className="hero-stat">
              <span className="hero-stat-num">7am</span>
              <span className="hero-stat-label">in your inbox</span>
            </div>
          </motion.div>
        </div>

        {/* Right column */}
        <motion.div
          className="hero-right"
          initial={{ opacity: 0, x: 40, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="hero-product-glow" aria-hidden />
          <ProductPreview />
        </motion.div>
      </div>

      {/* Scroll hint */}
      <motion.div
        className="hero-scroll-hint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.6 }}
      >
        <div className="scroll-mouse">
          <div className="scroll-wheel" />
        </div>
      </motion.div>
    </section>
  );
}
