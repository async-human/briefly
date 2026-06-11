"use client";

import { motion } from "framer-motion";
import { BrainCanvas } from "./BrainCanvas";
import { DigestPreview } from "./DigestPreview";
import { StaggerHeadline } from "./StaggerHeadline";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function Hero() {
  return (
    <section className="hero-linear landing-band-base">
      <div className="hero-linear-atmosphere" aria-hidden>
        <div className="hero-linear-mesh" />
        <div className="hero-linear-brain">
          <BrainCanvas tone="accent" />
        </div>
      </div>

      <motion.div
        className="hero-linear-intro"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: EASE }}
      >
        <p className="hero-linear-eyebrow">
          <a href="#demo">
            <span className="hero-eyebrow-pulse" aria-hidden />
            Morning briefing →
          </a>
        </p>
        <StaggerHeadline
          className="hero-linear-headline"
          text="The intelligence system for everything you follow"
        />
        <motion.p
          className="hero-linear-sub"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.55, ease: EASE }}
        >
          Purpose-built for people who subscribe to too much. Briefly processes the
          newsletters, feeds, and channels you choose — then delivers one sharp,
          cited briefing designed for how you actually consume news.
        </motion.p>
        <motion.div
          className="hero-linear-actions"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.68, ease: EASE }}
        >
          <a href="/login" className="btn-light-primary">
            Start free →
          </a>
          <a href="#demo" className="btn-light-ghost">
            See it work
          </a>
        </motion.div>
        <motion.p
          className="hero-linear-fine"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.82, ease: EASE }}
        >
          Free to start · No credit card required
        </motion.p>
      </motion.div>

      <div className="hero-linear-product">
        <DigestPreview />
      </div>
    </section>
  );
}
