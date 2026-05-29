"use client";

import { motion, useInView } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { ProductPreview } from "./ProductPreview";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.75, delay, ease: EASE },
});

// Animated counter that counts up when in view
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const duration = 1400;
    const start = Date.now();
    let raf: number;
    const tick = () => {
      const elapsed = Date.now() - start;
      const p = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(eased * to));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);

  return <span ref={ref}>{count}{suffix}</span>;
}

// Floating particles — purely decorative
const PARTICLES = [
  { top: "18%", left: "8%",  size: 2, dur: 9,  delay: 0   },
  { top: "65%", left: "12%", size: 3, dur: 13, delay: 2   },
  { top: "40%", left: "72%", size: 2, dur: 11, delay: 4   },
  { top: "75%", left: "82%", size: 2, dur: 8,  delay: 1.5 },
  { top: "25%", left: "88%", size: 3, dur: 15, delay: 3   },
  { top: "55%", left: "45%", size: 1.5, dur: 10, delay: 6 },
];

export function Hero() {
  return (
    <section className="hero-v2">
      {/* Ambient background */}
      <div className="hero-bg" aria-hidden>
        <div className="hero-orb hero-orb-gold" />
        <div className="hero-orb hero-orb-purple" />
        <div className="hero-orb hero-orb-blue" />
        <div className="hero-noise" />
        {/* Floating particles */}
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="hero-particle"
            style={{
              top: p.top,
              left: p.left,
              width: p.size,
              height: p.size,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
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
            <motion.a
              href="/login"
              className="btn-hero-primary"
              whileHover={{ scale: 1.03, boxShadow: "0 12px 40px rgba(201,184,150,0.25)" }}
              whileTap={{ scale: 0.98 }}
            >
              Start building yours free
              <motion.span
                className="btn-arrow"
                initial={{ x: 0 }}
                whileHover={{ x: 4 }}
              >→</motion.span>
            </motion.a>
            <a href="#how" className="btn-hero-ghost">
              See how it works
            </a>
          </motion.div>

          <motion.div className="hero-stats-row" {...fadeUp(0.58)}>
            <div className="hero-stat">
              <span className="hero-stat-num">
                <Counter to={12} suffix="+" />
              </span>
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

        {/* Right column — floating product preview */}
        <motion.div
          className="hero-right"
          initial={{ opacity: 0, x: 40, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 1, delay: 0.3, ease: EASE }}
        >
          <div className="hero-product-glow" aria-hidden />
          {/* Float wrapper */}
          <div className="hero-float-wrap">
            <ProductPreview />
          </div>
        </motion.div>
      </div>

      {/* Scroll hint */}
      <motion.div
        className="hero-scroll-hint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.6 }}
      >
        <div className="scroll-mouse">
          <div className="scroll-wheel" />
        </div>
      </motion.div>
    </section>
  );
}
