"use client";

import { motion } from "framer-motion";
import { DigestPreview } from "./DigestPreview";

export function Hero() {
  return (
    <section className="hero">
      <div className="hero-content">
        <motion.p
          className="hero-label"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Self-building second brain
        </motion.p>
        <motion.h1
          className="hero-headline"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
        >
          The second brain that builds itself
        </motion.h1>
        <motion.p
          className="hero-sub"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35 }}
        >
          Connect your accounts once. Briefly reads every newsletter, channel, and feed you follow — then sends a personalised morning briefing that gets smarter every day. Zero maintenance. Forever.
        </motion.p>
        <motion.div
          className="hero-actions"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <a href="/login" className="btn-primary">
            Start building yours free
          </a>
          <a href="#how" className="btn-ghost">
            See how it works
          </a>
        </motion.div>
        <motion.p
          style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 14 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
        >
          Free to start · No credit card · First briefing tomorrow morning
        </motion.p>
      </div>

      <DigestPreview />
    </section>
  );
}
