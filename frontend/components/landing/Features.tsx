"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion, useInView, useSpring, useTransform } from "framer-motion";
import { Reveal } from "./Reveal";
import { SourceIcon } from "@/components/SourceIcon";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type FeatureVariant = "sleep" | "memory" | "personal" | "filter";

type Feature = {
  num: string;
  title: string;
  desc: string;
  variant: FeatureVariant;
  size: "large" | "small";
  sources?: string[];
};

const features: Feature[] = [
  {
    num: "01",
    title: "Builds itself while you sleep",
    desc: "Connect Gmail, YouTube, Reddit, and any RSS feed once. Every night, Briefly fetches everything automatically. No saving, tagging, or organising — ever.",
    variant: "sleep",
    size: "large",
    sources: ["Gmail", "YouTube", "Reddit", "RSS", "Readwise", "Hacker News"],
  },
  {
    num: "02",
    title: "Remembers what you read",
    desc: "Today's story connects to what you read last week. The reading finally compounds.",
    variant: "memory",
    size: "small",
  },
  {
    num: "03",
    title: "Written specifically for you",
    desc: "Every item explains why it matters to your role, goals, and history — not why it's generally important.",
    variant: "personal",
    size: "small",
  },
  {
    num: "04",
    title: "Confident, not comprehensive",
    desc: "Reads 50 items, shows 10. Then tells you exactly what it skipped and why.",
    variant: "filter",
    size: "small",
  },
];

function FeatureGlyph({ variant }: { variant: FeatureVariant }) {
  const paths: Record<FeatureVariant, React.ReactNode> = {
    sleep: (
      <>
        <path d="M13 4L6 14h5l-1 8 7-11h-5l1-7Z" className="bento-glyph-stroke" />
      </>
    ),
    memory: (
      <>
        <circle cx="8" cy="14" r="2.5" className="bento-glyph-stroke" />
        <circle cx="16" cy="10" r="2.5" className="bento-glyph-stroke bento-glyph-pulse" />
        <circle cx="24" cy="14" r="2.5" className="bento-glyph-stroke" />
        <path d="M10.5 13.2 14 11.2M17.8 11.2 21.5 13.2" className="bento-glyph-stroke" />
      </>
    ),
    personal: (
      <>
        <path d="M12 6v12M8 10h8M8 14h5" className="bento-glyph-stroke" />
        <circle cx="20" cy="8" r="1.5" className="bento-glyph-fill bento-glyph-pulse" />
      </>
    ),
    filter: (
      <>
        <path d="M8 8h16M11 14h10M14 20h4" className="bento-glyph-stroke" />
      </>
    ),
  };

  return (
    <span className={`bento-glyph bento-glyph-${variant}`} aria-hidden>
      <svg viewBox="0 0 32 32" fill="none">{paths[variant]}</svg>
    </span>
  );
}

function SleepViz({ sources }: { sources: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <div ref={ref} className="bento-viz bento-viz-sleep" aria-hidden>
      <div className="bento-viz-sleep-grid">
        {sources.map((s, i) => (
          <motion.div
            key={s}
            className="bento-viz-source"
            initial={{ opacity: 0, y: 8 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.4, delay: 0.1 + i * 0.07, ease: EASE }}
          >
            <span className="bento-viz-source-icon">
              <SourceIcon name={s} size={18} />
            </span>
            <span className="bento-viz-source-line" />
            <span className="bento-viz-source-label">{s}</span>
          </motion.div>
        ))}
      </div>
      <motion.div
        className="bento-viz-hub"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={inView ? { scale: 1, opacity: 1 } : {}}
        transition={{ duration: 0.5, delay: 0.35, ease: EASE }}
      >
        <span className="bento-viz-hub-core">Briefly</span>
      </motion.div>
    </div>
  );
}

function MemoryViz() {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div className="bento-viz bento-viz-memory" aria-hidden>
      <svg ref={ref} viewBox="0 0 280 64" className="bento-viz-memory-svg">
        <motion.line
          x1="40" y1="32" x2="240" y2="32"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          initial={{ pathLength: 0, opacity: 0.3 }}
          animate={inView ? { pathLength: 1, opacity: 0.45 } : {}}
          transition={{ duration: 1, ease: EASE }}
        />
        {[
          { x: 40, label: "Mar 12" },
          { x: 140, label: "Today", active: true },
          { x: 240, label: "Next" },
        ].map((node, i) => (
          <g key={node.label}>
            <motion.circle
              cx={node.x} cy={32} r={node.active ? 10 : 7}
              className={node.active ? "bento-viz-node-active" : "bento-viz-node"}
              initial={{ scale: 0 }}
              animate={inView ? { scale: 1 } : {}}
              transition={{ type: "spring", stiffness: 320, damping: 20, delay: 0.2 + i * 0.15 }}
            />
            <text x={node.x} y={56} textAnchor="middle" className="bento-viz-node-label">
              {node.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="bento-viz-caption">Update to the thread you&apos;ve been following</p>
    </div>
  );
}

function PersonalViz() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <div ref={ref} className="bento-viz bento-viz-personal" aria-hidden>
      <motion.div
        className="bento-viz-snippet"
        initial={{ opacity: 0, y: 10 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.45, ease: EASE }}
      >
        <span className="bento-viz-snippet-label">Why this matters</span>
        <p className="bento-viz-snippet-text">
          As a{" "}
          <motion.span
            className="bento-viz-highlight"
            animate={inView ? { backgroundSize: ["0% 100%", "100% 100%"] } : {}}
            transition={{ duration: 0.8, delay: 0.4, ease: EASE }}
          >
            founder building in AI
          </motion.span>
          , this signals where the market is moving next week.
        </p>
      </motion.div>
    </div>
  );
}

function FilterViz() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const countSpring = useSpring(0, { stiffness: 60, damping: 18 });
  const shownSpring = useSpring(0, { stiffness: 80, damping: 20 });
  const displayIn = useTransform(countSpring, (v) => Math.round(v));
  const displayOut = useTransform(shownSpring, (v) => Math.round(v));
  const [inVal, setInVal] = useState(0);
  const [outVal, setOutVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    countSpring.set(50);
    const t = setTimeout(() => shownSpring.set(10), 600);
    return () => clearTimeout(t);
  }, [inView, countSpring, shownSpring]);

  useEffect(() => {
    const u1 = displayIn.on("change", setInVal);
    const u2 = displayOut.on("change", setOutVal);
    return () => { u1(); u2(); };
  }, [displayIn, displayOut]);

  return (
    <div ref={ref} className="bento-viz bento-viz-filter" aria-hidden>
      <div className="bento-filter-stage">
        <div className="bento-filter-col">
          <span className="bento-filter-num">{inVal}</span>
          <span className="bento-filter-tag">ingested</span>
          <div className="bento-filter-bar-wrap">
            <motion.div
              className="bento-filter-bar bento-filter-bar-in"
              initial={{ scaleX: 0 }}
              animate={inView ? { scaleX: 1 } : {}}
              transition={{ duration: 0.7, ease: EASE, delay: 0.1 }}
            />
          </div>
        </div>
        <motion.div
          className="bento-filter-funnel"
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.45 }}
        >
          <svg viewBox="0 0 24 32" width="20" height="28">
            <path d="M4 4h16L14 18v10H10V18L4 4Z" className="bento-glyph-stroke" />
          </svg>
        </motion.div>
        <div className="bento-filter-col bento-filter-col-out">
          <span className="bento-filter-num bento-filter-num-out">{outVal}</span>
          <span className="bento-filter-tag">shown</span>
          <div className="bento-filter-bar-wrap">
            <motion.div
              className="bento-filter-bar bento-filter-bar-out"
              initial={{ scaleX: 0 }}
              animate={inView ? { scaleX: 1 } : {}}
              transition={{ duration: 0.5, ease: EASE, delay: 0.65 }}
              style={{ transformOrigin: "left center" }}
            />
          </div>
        </div>
      </div>
      <motion.p
        className="bento-viz-caption"
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : {}}
        transition={{ delay: 0.9 }}
      >
        40 filtered · reasons included
      </motion.p>
    </div>
  );
}

function CardViz({ feature }: { feature: Feature }) {
  if (feature.variant === "sleep" && feature.sources) {
    return <SleepViz sources={feature.sources} />;
  }
  if (feature.variant === "memory") return <MemoryViz />;
  if (feature.variant === "personal") return <PersonalViz />;
  if (feature.variant === "filter") return <FilterViz />;
  return null;
}

function SpotlightCard({
  children,
  variant,
  accent = false,
}: {
  children: React.ReactNode;
  variant: FeatureVariant;
  accent?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [hovered, setHovered] = useState(false);

  function onMove(e: React.MouseEvent) {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    });
  }

  return (
    <div
      ref={ref}
      className={`bento-card bento-card-${variant}${accent ? " bento-card-accent" : ""}`}
      style={{
        ["--mx" as string]: `${pos.x}%`,
        ["--my" as string]: `${pos.y}%`,
      }}
      onMouseMove={onMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className={`bento-card-aurora${hovered ? " is-active" : ""}`} aria-hidden />
      <span className="bento-card-edge" aria-hidden />
      <div className="bento-card-inner">{children}</div>
    </div>
  );
}

function FeatureCard({ feature, accent = false }: { feature: Feature; accent?: boolean }) {
  const isLarge = feature.size === "large";
  const isWide = feature.variant === "filter";

  return (
    <motion.div
      className={`bento-cell${isLarge ? " bento-large" : ""}${isWide ? " bento-wide" : ""}`}
      whileHover={{ y: -6, transition: { duration: 0.25, ease: EASE } }}
    >
      <SpotlightCard variant={feature.variant} accent={accent}>
        <div className="bento-top">
          <FeatureGlyph variant={feature.variant} />
          <span className="bento-num">{feature.num}</span>
        </div>
        <h3 className={`bento-title${isLarge ? " bento-title-lg" : ""}`}>{feature.title}</h3>
        <p className="bento-desc">{feature.desc}</p>
        <CardViz feature={feature} />
      </SpotlightCard>
    </motion.div>
  );
}

export function Features() {
  return (
    <section className="features-v2 landing-section" id="features">
      <div className="landing-section-inner features-v2-inner">
        <Reveal>
          <div className="section-header-centered">
            <p className="section-eyebrow">In practice</p>
            <h2 className="section-heading">Four ideas behind every briefing</h2>
            <p className="section-body">
              Most tools wait for you to save, sort, and revisit.
              Briefly works in the background — and meets you each morning with exactly what matters.
            </p>
          </div>
        </Reveal>

        <div className="bento-grid">
          {features.map((f, i) => (
            <Reveal key={f.num} delay={i * 0.1} className="bento-reveal-cell">
              <FeatureCard feature={f} accent={i === 0} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
