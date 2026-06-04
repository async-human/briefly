"use client";

import { motion } from "framer-motion";
import { DigestPreview } from "./DigestPreview";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const VALUE_PROPS = [
  {
    fig: "FIG 0.1",
    title: "Connect once",
    body: "Link Gmail, YouTube, Reddit, and RSS a single time. Briefly ingests every night — no tagging or inbox zero.",
  },
  {
    fig: "FIG 0.2",
    title: "Reads overnight",
    body: "Agents collect, deduplicate, and score while you sleep. Every claim cited before it reaches your briefing.",
  },
  {
    fig: "FIG 0.3",
    title: "Learns your taste",
    body: "Skips, saves, and follow-ups shape tomorrow's digest. Memory compounds without manual tuning.",
  },
] as const;

export function Hero() {
  return (
    <section className="hero-linear">
      <motion.div
        className="hero-linear-intro"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
      >
        <p className="hero-linear-eyebrow">
          <a href="#demo">Morning briefing →</a>
        </p>
        <h1 className="hero-linear-headline">
          The intelligence system for everything you follow
        </h1>
        <p className="hero-linear-sub">
          Purpose-built for people who subscribe to too much. Briefly reads your
          feeds overnight and delivers one sharp, cited briefing — designed for
          the way you actually consume news.
        </p>
        <div className="hero-linear-actions">
          <a href="/login" className="btn-light-primary">
            Start free →
          </a>
          <a href="#demo" className="btn-light-ghost">
            See it work
          </a>
        </div>
        <p className="hero-linear-fine">Free to start · No credit card required</p>
      </motion.div>

      <div className="hero-linear-product">
        <DigestPreview />
      </div>

      <div className="hero-value-row">
        {VALUE_PROPS.map((item, i) => (
          <motion.div
            key={item.fig}
            className="hero-value-card"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
          >
            <p className="hero-value-fig">{item.fig}</p>
            <h2 className="hero-value-title">{item.title}</h2>
            <p className="hero-value-body">{item.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
