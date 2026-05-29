"use client";

import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { BrainCanvas } from "./BrainCanvas";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const dur = 1600;
    const start = Date.now();
    let raf: number;
    const tick = () => {
      const p = Math.min((Date.now() - start) / dur, 1);
      setN(Math.round((1 - Math.pow(1 - p, 3)) * to));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);

  return <span ref={ref}>{n}{suffix}</span>;
}

export function Hero() {
  return (
    <section className="hero-light">
      <div className="hero-light-bg" aria-hidden>
        <div className="hero-light-glow" />
      </div>

      <div className="hero-split">
        {/* ── Left: copy ── */}
        <div className="hero-copy">
          <motion.p
            className="hero-problem-eyebrow"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
          >
            The problem you know too well
          </motion.p>

          <motion.div
            className="hero-problem-stack"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: EASE }}
          >
            <div className="hero-stat-line">
              <span className="hero-big-num"><CountUp to={12} /></span>
              <span className="hero-stat-desc">newsletters<br />you&apos;ll never read</span>
            </div>
            <div className="hero-stat-line">
              <span className="hero-big-num"><CountUp to={52} /></span>
              <span className="hero-stat-desc">YouTube channels<br />unwatched</span>
            </div>
            <div className="hero-stat-line">
              <span className="hero-big-num"><CountUp to={18} /></span>
              <span className="hero-stat-desc">subreddits<br />you can&apos;t keep up with</span>
            </div>
          </motion.div>

          <motion.div
            className="hero-rule"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.55, ease: EASE }}
          />

          <motion.h1
            className="hero-light-headline"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.65, ease: EASE }}
          >
            Briefly reads all of it.
            <br />
            <span className="hero-light-gradient">You just read the briefing.</span>
          </motion.h1>

          <motion.p
            className="hero-light-sub"
            style={{ margin: "0 0 32px", textAlign: "left" }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.8, ease: EASE }}
          >
            Connect once. Briefly reads everything you follow overnight, scores what matters to your interests, and sends a personalised briefing at 7am — with sources cited. Zero maintenance.
          </motion.p>

          <motion.div
            className="hero-light-actions"
            style={{ justifyContent: "flex-start" }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.9, ease: EASE }}
          >
            <motion.a
              href="/login"
              className="btn-light-primary"
              whileHover={{ scale: 1.02, boxShadow: "0 8px 32px rgba(158,123,63,0.22)" }}
              whileTap={{ scale: 0.98 }}
            >
              Start building yours free →
            </motion.a>
            <a href="#demo" className="btn-light-ghost">Watch it work ↓</a>
          </motion.div>

          <motion.p
            className="hero-light-fine"
            style={{ textAlign: "left" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1, duration: 0.5 }}
          >
            Free to start · No credit card · First briefing tomorrow at 7am
          </motion.p>
        </div>

        {/* ── Right: brain ── */}
        <motion.div
          className="hero-brain-panel"
          initial={{ opacity: 0, x: 40, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 1, delay: 0.35, ease: EASE }}
        >
          <div className="hero-brain-label">
            <span className="hero-brain-dot" />
            Building your second brain
          </div>
          <div className="hero-brain-canvas">
            <BrainCanvas />
          </div>
          <div className="hero-brain-footer">
            <span>58 knowledge nodes · 180 connections · live activity</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
