"use client";

import { motion } from "framer-motion";
import { ProductPreview } from "./ProductPreview";

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
          Personal briefing
        </motion.p>
        <motion.h1
          className="hero-headline"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
        >
          Everything you follow, one morning read
        </motion.h1>
        <motion.p
          className="hero-sub"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.35 }}
        >
          Briefly reads your newsletters, feeds, and channels overnight — then sends a briefing written for you, with sources cited.
        </motion.p>
        <motion.div
          className="hero-actions"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <a href="/login" className="btn-primary">
            Get early access
          </a>
          <a href="#how" className="btn-ghost">
            See how it works
          </a>
        </motion.div>
      </div>

      <ProductPreview />
    </section>
  );
}
