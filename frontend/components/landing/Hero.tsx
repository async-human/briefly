"use client";

import { motion } from "framer-motion";
import { DigestPreview } from "./DigestPreview";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

// A/Lumen DNA: hard metrics above the headline
const METRICS = [
  { value: "50+", label: "sources read", sub: "every night" },
  { value: "10",  label: "items shown",  sub: "zero noise"  },
  { value: "7am", label: "in your inbox", sub: "daily, cited" },
] as const;

export function Hero() {
  return (
    <section className="hero-light">
      <div className="hero-light-bg" aria-hidden>
        <div className="hero-light-glow" />
      </div>

      {/* B/Cobalt DNA: asymmetric split — text left, live product right */}
      <div className="hero-split-inner">

        {/* ── Left column ─────────────────────────────────────────────── */}
        <motion.div
          className="hero-left"
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
        >
          {/* Metric row */}
          <div className="hero-metrics">
            {METRICS.map((m, i) => (
              <motion.div
                key={m.label}
                className="hero-metric"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.18 + i * 0.08, ease: EASE }}
              >
                <span className="hero-metric-value">{m.value}</span>
                <span className="hero-metric-label">{m.label}</span>
                <span className="hero-metric-sub">{m.sub}</span>
              </motion.div>
            ))}
          </div>

          <motion.h1
            className="hero-light-headline"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.38, ease: EASE }}
          >
            Briefly reads all of it.
            <br />
            <span className="hero-light-gradient">You just read the briefing.</span>
          </motion.h1>

          <motion.p
            className="hero-light-sub"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.58, ease: EASE }}
          >
            Connect your sources once. Every night, Briefly reads everything —
            deduplicates across sources, scores what matters to you, and writes
            a personal morning briefing with every claim cited. Zero maintenance. Forever.
          </motion.p>

          <motion.div
            className="hero-light-actions"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.72, ease: EASE }}
          >
            <motion.a
              href="/login"
              className="btn-light-primary"
              whileHover={{ scale: 1.02, boxShadow: "0 8px 32px rgba(158,123,63,0.22)" }}
              whileTap={{ scale: 0.98 }}
            >
              Start building yours free →
            </motion.a>
            <a href="#demo" className="btn-light-ghost">
              Watch it work ↓
            </a>
          </motion.div>

          <motion.p
            className="hero-light-fine"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.88, ease: EASE }}
          >
            Free to start · No credit card · First briefing tomorrow at 7am
          </motion.p>
        </motion.div>

        {/* ── Right column: live animated digest ──────────────────────── */}
        <DigestPreview />
      </div>
    </section>
  );
}
