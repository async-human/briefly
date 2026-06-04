"use client";

import { motion } from "framer-motion";
import { DigestPreview } from "./DigestPreview";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const STAGES = [
  {
    title: "Connect once",
    body: "Link Gmail, YouTube, Reddit, and RSS a single time. No tagging or inbox zero required.",
    href: "#demo",
  },
  {
    title: "Reads overnight",
    body: "Agents collect, deduplicate, and score while you sleep. Every claim cited before delivery.",
    href: "#features",
  },
  {
    title: "Learns your taste",
    body: "Skips, saves, and follow-ups shape tomorrow's digest. Memory compounds on its own.",
    href: "#why",
  },
] as const;

export function Hero() {
  return (
    <>
      <section className="hero-linear">
        <motion.div
          className="hero-linear-intro"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          <span className="hero-linear-badge">Personal morning briefing</span>
          <h1 className="hero-linear-headline">
            Reimagine how you stay on top of everything you follow
          </h1>
          <p className="hero-linear-sub">
            One cited briefing each morning — built from your newsletters, feeds,
            and subscriptions. Connect once, read what matters, trust the rest.
          </p>
          <div className="hero-linear-actions">
            <a href="/login" className="btn-light-primary">
              Start free →
            </a>
            <a href="#demo" className="btn-light-ghost">
              See a demo
            </a>
          </div>
          <p className="hero-linear-fine">Free to start · No credit card required</p>
        </motion.div>

        <div className="hero-linear-product">
          <DigestPreview />
        </div>
      </section>

      <section className="hero-stages" aria-labelledby="hero-stages-title">
        <div className="section-block-header">
          <h2 id="hero-stages-title" className="section-block-title">
            How Briefly fits your morning
          </h2>
          <p className="section-block-sub">
            A briefing system that runs itself — wherever you start today.
          </p>
        </div>
        <div className="hero-stages-grid">
          {STAGES.map((stage, i) => (
            <motion.article
              key={stage.title}
              className="hero-stage-card"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: EASE }}
            >
              <h3 className="hero-stage-title">{stage.title}</h3>
              <p className="hero-stage-body">{stage.body}</p>
              <a href={stage.href} className="hero-stage-link">
                Learn more →
              </a>
            </motion.article>
          ))}
        </div>
      </section>
    </>
  );
}
