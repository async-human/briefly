"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
} from "framer-motion";
import { Reveal } from "./Reveal";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const stages = [
  {
    num: "01",
    version: "V1",
    status: "now" as const,
    icon: "⚡",
    name: "Self-Building Digest",
    tagline: "The core loop. Reads everything. Writes for you.",
    highlights: ["Gmail · YouTube · Reddit · RSS", "Dual-pool briefing", "Why-it-matters on every item", "Brain dump capture"],
    features: [
      "Gmail, YouTube, Reddit, RSS — connected once",
      "Dual-pool planner: What's new + Highly relevant",
      "Why-it-matters-to-you on every item",
      "Voice & text brain dump → injected into briefings",
      "Email delivery at your chosen time",
    ],
  },
  {
    num: "02",
    version: "V1.5",
    status: "now" as const,
    icon: "🌙",
    name: "Passive Ingestion",
    tagline: "Briefly reads overnight. Mornings are instant.",
    highlights: ["Nightly source fetch", "Pre-scored content pool", "Pool-first briefings", "Ingestion activity feed"],
    features: [
      "Sources fetched at ~3am in your timezone",
      "Content pool with relevance pre-scoring",
      "Morning briefing reads from pool — no cold start",
      "Dashboard: what Briefly ingested last night",
      "Auto-expand sources from your engagement signals",
    ],
  },
  {
    num: "03",
    version: "V2",
    status: "coming" as const,
    icon: "✏",
    name: "Manual Capture Layer",
    tagline: "Add your own voice to the second brain.",
    highlights: ["Paste any link", "PDF & doc upload", "Browser extension", "Readwise sync"],
    features: [
      "Paste any link — Briefly fetches and indexes it",
      "Upload documents — PDF, Word, text ingested",
      "Browser extension — one-click save from anywhere",
      "Deeper Readwise & bookmark integrations",
    ],
  },
  {
    num: "04",
    version: "V3",
    status: "coming" as const,
    icon: "◎",
    name: "Ask Briefly",
    tagline: "Conversational search across everything it knows.",
    highlights: ["Ask your knowledge base", "Answers with citations", "Follow-up on any item", "Weekly memory digest"],
    features: [
      "Ask questions across your full knowledge base",
      "Synthesised answers with citations — not just results",
      '"What have I read about X in the last month?"',
      "Follow-up questions on any digest item",
      "Weekly memory digest — themes and what to revisit",
    ],
  },
  {
    num: "05",
    version: "V4",
    status: "vision" as const,
    icon: "✦",
    name: "Knowledge Graph",
    tagline: "Proactive intelligence in the background.",
    highlights: ["Connected topics & entities", "Story threads over time", "Proactive resurfacing", "Mobile + X integration"],
    features: [
      "Entities, topics, ideas connected across all content",
      "Story threads tracked across sources and time",
      '"This connects to something you saved 3 weeks ago"',
      "Proactive resurfacing when context becomes relevant",
      "Twitter/X integration + mobile app",
    ],
  },
];

const STAGE_DURATION_MS = 7000;

const STATUS = {
  now: { badge: "Live now", cls: "roadmap-badge-now" },
  coming: { badge: "Coming soon", cls: "roadmap-badge-coming" },
  vision: { badge: "Vision", cls: "roadmap-badge-vision" },
};

function useStageTimer(active: number, paused: boolean, inView: boolean) {
  const [progress, setProgress] = useState(0);
  const [remainingSec, setRemainingSec] = useState(STAGE_DURATION_MS / 1000);

  useEffect(() => {
    setProgress(0);
    setRemainingSec(Math.ceil(STAGE_DURATION_MS / 1000));
  }, [active]);

  useEffect(() => {
    if (!inView || paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const started = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - started;
      const p = Math.min(elapsed / STAGE_DURATION_MS, 1);
      setProgress(p);
      setRemainingSec(Math.max(0, Math.ceil((STAGE_DURATION_MS - elapsed) / 1000)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, paused, inView]);

  return { progress, remainingSec };
}

function TimerRing({
  progress,
  size = 28,
  stroke = 2,
  className = "",
}: {
  progress: number;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - progress);

  return (
    <svg
      className={`rm3-timer-ring-svg ${className}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      <circle
        className="rm3-timer-ring-track"
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        className="rm3-timer-ring-progress"
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
      />
    </svg>
  );
}

function InlineTimer({
  progress,
  remainingSec,
  paused,
  version,
  compact,
}: {
  progress: number;
  remainingSec: number;
  paused: boolean;
  version: string;
  compact?: boolean;
}) {
  return (
    <span
      className={`rm3-inline-timer${compact ? " rm3-inline-timer-compact" : ""}${paused ? " is-paused" : ""}`}
      role="timer"
      aria-live="off"
      aria-label={
        paused
          ? `Auto-advance paused on ${version}`
          : `Advancing in ${remainingSec} seconds`
      }
    >
      <TimerRing progress={progress} size={compact ? 14 : 16} stroke={1.75} />
      <span className="rm3-inline-timer-val">{remainingSec}s</span>
    </span>
  );
}

function CountdownBar({ progress }: { progress: number }) {
  return (
    <div className="rm3-countdown-bar" aria-hidden>
      <div
        className="rm3-countdown-fill"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}

function DotProgressRing({ progress }: { progress: number }) {
  return (
    <span
      className="rm3-dot-progress"
      style={{ "--rm3-progress": `${progress * 360}deg` } as React.CSSProperties}
      aria-hidden
    />
  );
}

function JourneyTrack({
  active,
  onSelect,
  inView,
  progress,
  remainingSec,
  paused,
}: {
  active: number;
  onSelect: (i: number) => void;
  inView: boolean;
  progress: number;
  remainingSec: number;
  paused: boolean;
}) {
  const fillPercent = (active / (stages.length - 1)) * 100;

  return (
    <div className="rm3-track" role="tablist" aria-label="Product roadmap versions">
      <div className="rm3-track-rail" aria-hidden>
        <motion.div
          className="rm3-track-fill"
          initial={{ width: "0%" }}
          animate={{ width: inView ? `${fillPercent}%` : "0%" }}
          transition={{ duration: 0.65, ease: EASE }}
        />
        <motion.div
          className="rm3-track-shimmer"
          animate={inView ? { x: ["-100%", "220%"] } : { x: "-100%" }}
          transition={{ duration: 2.8, repeat: Infinity, repeatDelay: 3, ease: "easeInOut" }}
        />
      </div>

      {stages.map((stage, i) => {
        const isActive = i === active;
        const isReached = i <= active;
        const cfg = STATUS[stage.status];

        return (
          <button
            key={stage.version}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`rm3-panel-${stage.version}`}
            className={`rm3-track-node${isActive ? " active" : ""}${isReached ? " reached" : ""}`}
            onClick={() => onSelect(i)}
          >
            <motion.span
              className={`rm3-track-dot rm3-track-dot-${stage.status}`}
              animate={
                isActive
                  ? { scale: [1, 1.08, 1], boxShadow: ["0 0 0 0 rgba(201,184,150,0)", "0 0 0 10px rgba(201,184,150,0.12)", "0 0 0 0 rgba(201,184,150,0)"] }
                  : { scale: 1 }
              }
              transition={{ duration: 2.2, repeat: isActive ? Infinity : 0, ease: "easeInOut" }}
            >
              {isActive && <DotProgressRing progress={progress} />}
              <motion.span
                className="rm3-track-icon"
                animate={isActive ? { y: [0, -3, 0], rotate: [0, 8, -6, 0] } : { y: 0, rotate: 0 }}
                transition={{ duration: 2.5, repeat: isActive ? Infinity : 0, ease: "easeInOut", repeatDelay: 0.5 }}
              >
                {stage.icon}
              </motion.span>
            </motion.span>
            <span className="rm3-track-ver-row">
              <span className="rm3-track-ver">{stage.version}</span>
              {isActive && (
                <span className="rm3-track-sec" aria-hidden>
                  {paused ? "—" : `${remainingSec}s`}
                </span>
              )}
            </span>
            <span className={`roadmap-badge ${cfg.cls} rm3-track-badge`}>{cfg.badge}</span>
          </button>
        );
      })}
    </div>
  );
}

function SpotlightPanel({
  stage,
  progress,
  remainingSec,
  paused,
}: {
  stage: (typeof stages)[0];
  progress: number;
  remainingSec: number;
  paused: boolean;
}) {
  const cfg = STATUS[stage.status];

  return (
    <motion.article
      key={stage.version}
      id={`rm3-panel-${stage.version}`}
      role="tabpanel"
      className={`rm3-spotlight rm3-spotlight-${stage.status}`}
      initial={{ opacity: 0, y: 28, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.98 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      {stage.status === "now" && (
        <>
          <div className="rm3-orb rm3-orb-a" aria-hidden />
          <div className="rm3-orb rm3-orb-b" aria-hidden />
        </>
      )}

      <CountdownBar progress={progress} />

      <div className="rm3-spotlight-timer">
        <InlineTimer
          progress={progress}
          remainingSec={remainingSec}
          paused={paused}
          version={stage.version}
        />
      </div>

      <span className="rm3-watermark" aria-hidden>{stage.num}</span>

      <div className="rm3-spotlight-grid">
        <div className="rm3-spotlight-left">
          <motion.div
            className={`rm3-icon-stage rm3-icon-stage-${stage.status}`}
            initial={{ scale: 0.6, rotate: -12, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.05 }}
          >
            <motion.span
              className="rm3-icon-emoji"
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            >
              {stage.icon}
            </motion.span>
            {stage.status === "now" && <span className="rm3-icon-ring" aria-hidden />}
          </motion.div>

          <div className="rm3-spotlight-meta">
            <span className="rm3-ver">{stage.version}</span>
            <span className={`roadmap-badge ${cfg.cls}`}>{cfg.badge}</span>
          </div>

          <h3 className="rm3-name">{stage.name}</h3>
          <p className="rm3-tagline">{stage.tagline}</p>

          {stage.status === "now" && (
            <motion.a
              href="/login"
              className="rm3-cta"
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.98 }}
            >
              Start with V1 free →
            </motion.a>
          )}
        </div>

        <div className="rm3-spotlight-right">
          <p className="rm3-highlights-label">What ships</p>
          <ul className="rm3-chips">
            {stage.highlights.map((h, hi) => (
              <motion.li
                key={h}
                className="rm3-chip"
                initial={{ opacity: 0, y: 12, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.35, ease: EASE, delay: 0.08 + hi * 0.07 }}
                whileHover={{ y: -2, transition: { duration: 0.15 } }}
              >
                <span className="rm3-chip-dot" aria-hidden />
                {h}
              </motion.li>
            ))}
          </ul>

          <details className="rm3-details">
            <summary>Full feature list</summary>
            <ul className="rm3-details-list">
              {stage.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </motion.article>
  );
}

function StageStrip({
  active,
  onSelect,
  progress,
  remainingSec,
  paused,
}: {
  active: number;
  onSelect: (i: number) => void;
  progress: number;
  remainingSec: number;
  paused: boolean;
}) {
  return (
    <div className="rm3-strip">
      {stages.map((stage, i) => (
        <motion.button
          key={stage.version}
          type="button"
          className={`rm3-strip-card${i === active ? " active" : ""}`}
          onClick={() => onSelect(i)}
          whileHover={{ y: i === active ? 0 : -3 }}
          whileTap={{ scale: 0.98 }}
          layout
        >
          {i === active && (
            <span className="rm3-strip-timer-corner">
              <InlineTimer
                progress={progress}
                remainingSec={remainingSec}
                paused={paused}
                version={stage.version}
                compact
              />
            </span>
          )}
          {i === active && (
            <span className="rm3-strip-timer" aria-hidden>
              <span
                className="rm3-strip-timer-fill"
                style={{ transform: `scaleX(${progress})` }}
              />
            </span>
          )}
          <span className="rm3-strip-icon">{stage.icon}</span>
          <span className="rm3-strip-ver">{stage.version}</span>
          <span className="rm3-strip-name">{stage.name}</span>
        </motion.button>
      ))}
    </div>
  );
}

export function Roadmap() {
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef, { once: false, margin: "-8% 0px" });
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const { progress, remainingSec } = useStageTimer(active, paused, inView);

  const selectStage = (i: number) => {
    setActive(i);
  };

  useEffect(() => {
    if (!inView || paused) return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;
    const timer = window.setInterval(() => {
      setActive((prev) => (prev + 1) % stages.length);
    }, STAGE_DURATION_MS);
    return () => window.clearInterval(timer);
  }, [inView, paused, active]);

  return (
    <section
      className="roadmap-section rm3-section"
      id="roadmap"
      ref={sectionRef}
    >
      <div className="rm3-bg-grid" aria-hidden />

      <div className="roadmap-inner">
        <Reveal>
          <div className="section-header-centered rm3-header">
            <p className="section-eyebrow">Roadmap</p>
            <h2 className="section-heading">
              You&apos;re joining at V1.
              <br />
              <span className="hero-gradient-text">Here&apos;s the journey ahead.</span>
            </h2>
            <p className="section-body rm3-subcopy">
              Tap a version to explore. Each release stands on its own — Pro includes them all.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="rm3-track-wrap">
            <JourneyTrack
              active={active}
              onSelect={selectStage}
              inView={inView}
              progress={progress}
              remainingSec={remainingSec}
              paused={paused}
            />
          </div>
        </Reveal>

        <div
          className="rm3-stage-wrap"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <AnimatePresence mode="wait">
            <SpotlightPanel
              key={stages[active].version}
              stage={stages[active]}
              progress={progress}
              remainingSec={remainingSec}
              paused={paused}
            />
          </AnimatePresence>
        </div>

        <Reveal delay={0.15}>
          <div className="rm3-strip-wrap">
            <StageStrip
              active={active}
              onSelect={selectStage}
              progress={progress}
              remainingSec={remainingSec}
              paused={paused}
            />
          </div>
        </Reveal>

        <Reveal delay={0.25}>
          <motion.p
            className="roadmap-footnote rm3-footnote"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            The first 200 founding members get V2, V3, and V4 as they ship — $9/month, price locked forever.
          </motion.p>
        </Reveal>
      </div>
    </section>
  );
}
