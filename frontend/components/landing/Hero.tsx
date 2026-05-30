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
      {/* Subtle paper texture gradient */}
      <div className="hero-light-bg" aria-hidden>
        <div className="hero-light-glow" />
        {/* Brain silhouette — ambient background, very low opacity */}
        <BrainCanvas />
      </div>

      <div className="hero-light-inner">
        {/* Problem statement */}
        <motion.div
          className="hero-problem"
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
        >
          <p className="hero-problem-eyebrow">The problem you know too well</p>
          <div className="hero-problem-numbers">
            <div className="hero-problem-stat">
              <span className="hero-problem-num"><CountUp to={12} /></span>
              <span className="hero-problem-label">newsletters<br />you&apos;ll never read</span>
            </div>
            <div className="hero-problem-sep">+</div>
            <div className="hero-problem-stat">
              <span className="hero-problem-num"><CountUp to={52} /></span>
              <span className="hero-problem-label">YouTube channels<br />unwatched</span>
            </div>
            <div className="hero-problem-sep">+</div>
            <div className="hero-problem-stat">
              <span className="hero-problem-num"><CountUp to={18} /></span>
              <span className="hero-problem-label">subreddits<br />you can&apos;t keep up with</span>
            </div>
          </div>
        </motion.div>

        {/* Divider */}
        <motion.div
          className="hero-divider-line"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.9, delay: 0.55, ease: EASE }}
        />

        {/* Solution */}
        <motion.div
          className="hero-solution"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.7, ease: EASE }}
        >
          <h1 className="hero-light-headline">
            Briefly reads all of it.
            <br />
            <span className="hero-light-gradient">You just read the briefing.</span>
          </h1>
          <p className="hero-light-sub">
            Connect your accounts once. Every night, Briefly fetches everything, scores what matters to you, and writes a personalised morning briefing — with sources cited. Zero maintenance. Forever.
          </p>
          <div className="hero-light-actions">
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
          </div>
          <p className="hero-light-fine">
            Free to start · No credit card · First briefing tomorrow at 7am
          </p>
        </motion.div>
      </div>
    </section>
  );
}
