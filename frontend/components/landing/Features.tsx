"use client";

import React, { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Reveal } from "./Reveal";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type FeatureVariant = "sleep" | "memory" | "personal" | "filter";

type Feature = {
  num: string;
  title: string;
  desc: string;
  icon: string;
  variant: FeatureVariant;
  size: "large" | "small";
  sources?: string[];
};

const features: Feature[] = [
  {
    num: "01",
    title: "Builds itself while you sleep",
    desc: "Connect Gmail, YouTube, Reddit, and any RSS feed once. Every night, Briefly fetches everything automatically. No saving, tagging, or organising — ever.",
    icon: "⚡",
    variant: "sleep",
    size: "large",
    sources: ["Gmail", "YouTube", "Reddit", "RSS", "Readwise", "HN"],
  },
  {
    num: "02",
    title: "Remembers what you read",
    desc: "Today's story connects to what you read last week. \"Update to the thread you've been following since March.\" The reading finally compounds.",
    icon: "◎",
    variant: "memory",
    size: "small",
  },
  {
    num: "03",
    title: "Written specifically for you",
    desc: "Every item explains why it matters to your role, goals, and history — not why it's generally important.",
    icon: "✦",
    variant: "personal",
    size: "small",
  },
  {
    num: "04",
    title: "Confident, not comprehensive",
    desc: "Reads 50 items, shows 10. Then tells you exactly what it skipped and why. You know what you're missing.",
    icon: "◌",
    variant: "filter",
    size: "small",
  },
];

function SpotlightCard({
  children,
  className = "",
  accent = false,
}: {
  children: React.ReactNode;
  className?: string;
  accent?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState(false);

  function onMove(e: React.MouseEvent) {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

  return (
    <div
      ref={ref}
      className={`bento-card${accent ? " bento-card-accent" : ""} ${className}`}
      style={{
        background: hovered
          ? `radial-gradient(300px circle at ${pos.x}px ${pos.y}px, var(--accent-dim) 0%, transparent 68%), var(--surface)`
          : undefined,
      }}
      onMouseMove={onMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="bento-card-shine" aria-hidden />
      {children}
    </div>
  );
}

function FeatureIcon({ icon, variant }: { icon: string; variant: FeatureVariant }) {
  return (
    <motion.span
      className={`bento-icon-stage bento-icon-stage-${variant}`}
      initial={{ scale: 0.85, opacity: 0 }}
      whileInView={{ scale: 1, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ type: "spring", stiffness: 380, damping: 18 }}
    >
      <motion.span
        className="bento-icon-emoji"
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: variant === "sleep" ? 0 : 0.4 }}
      >
        {icon}
      </motion.span>
      {variant === "sleep" && <span className="bento-icon-spark bento-icon-spark-a" aria-hidden />}
      {variant === "memory" && <span className="bento-icon-orbit" aria-hidden />}
      {variant === "personal" && <span className="bento-icon-twinkle" aria-hidden>✧</span>}
    </motion.span>
  );
}

function FilterViz() {
  return (
    <div className="bento-filter-viz" aria-hidden>
      <div className="bento-filter-track">
        <motion.div
          className="bento-filter-bar bento-filter-bar-in"
          initial={{ width: 0 }}
          whileInView={{ width: "100%" }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
        />
        <span className="bento-filter-label">50 ingested</span>
      </div>
      <motion.span
        className="bento-filter-arrow"
        initial={{ opacity: 0, x: -6 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, delay: 0.55 }}
      >
        →
      </motion.span>
      <div className="bento-filter-track">
        <motion.div
          className="bento-filter-bar bento-filter-bar-out"
          initial={{ width: 0 }}
          whileInView={{ width: "20%" }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.75 }}
        />
        <span className="bento-filter-label bento-filter-label-out">10 shown</span>
      </div>
    </div>
  );
}

function SourcePills({ sources }: { sources: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div ref={ref} className="bento-source-pills">
      {sources.map((s, i) => (
        <motion.span
          key={s}
          className="bento-pill"
          initial={{ opacity: 0, y: 8, scale: 0.92 }}
          animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.35, ease: EASE, delay: 0.15 + i * 0.06 }}
          whileHover={{ y: -2, transition: { duration: 0.15 } }}
        >
          {s}
        </motion.span>
      ))}
    </div>
  );
}

function FeatureCard({ feature, accent = false }: { feature: Feature; accent?: boolean }) {
  const isLarge = feature.size === "large";
  const isFilter = feature.variant === "filter";

  return (
    <motion.div
      className={`bento-cell${isLarge ? " bento-large" : ""}${isFilter ? " bento-wide" : ""}`}
      whileHover={{ y: -5, transition: { duration: 0.22, ease: EASE } }}
      style={{ flex: 1, display: "flex", flexDirection: "column" }}
    >
      <SpotlightCard className="bento-card-inner" accent={accent}>
        <div className="bento-top">
          <FeatureIcon icon={feature.icon} variant={feature.variant} />
          <span className="bento-num">{feature.num}</span>
        </div>
        <h3 className={`bento-title${isLarge ? " bento-title-lg" : ""}`}>{feature.title}</h3>
        <p className="bento-desc">{feature.desc}</p>
        {feature.sources && <SourcePills sources={feature.sources} />}
        {isFilter && <FilterViz />}
      </SpotlightCard>
    </motion.div>
  );
}

export function Features() {
  return (
    <section className="features-v2" id="features">
      <div className="features-v2-ambient" aria-hidden />
      <div className="features-v2-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">Why Briefly</p>
            <h2 className="section-heading">Not another tool to maintain</h2>
            <p className="section-body">
              Notion dies when you stop feeding it. Feedly is a firehose. Readwise needs you to highlight first.
              <br />
              Briefly needs nothing except the accounts you already have.
            </p>
          </div>
        </Reveal>

        <div className="bento-grid">
          {features.map((f, i) => (
            <Reveal key={f.num} delay={i * 0.08} className="bento-reveal-cell">
              <FeatureCard feature={f} accent={i === 0} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
