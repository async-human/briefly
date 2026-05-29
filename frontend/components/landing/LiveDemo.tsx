"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/* ── Types ─────────────────────────────────────────────────────────────────── */
type Phase = "collect" | "process" | "write" | "deliver";

const PHASE_DURATIONS: Record<Phase, number> = {
  collect: 3800,
  process: 3400,
  write:   6000,
  deliver: 2800,
};

const PHASES: Phase[] = ["collect", "process", "write", "deliver"];

/* ── Typewriter ─────────────────────────────────────────────────────────────── */
function useTypewriter(text: string, active: boolean, speed = 18) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!active) { setShown(0); return; }
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setShown(i);
      if (i >= text.length) clearInterval(iv);
    }, speed);
    return () => clearInterval(iv);
  }, [active, text, speed]);
  return text.slice(0, shown);
}

/* ── Collect phase ─────────────────────────────────────────────────────────── */
const SOURCES = [
  { name: "Gmail newsletters", icon: "✉", count: 14, delay: 0.1 },
  { name: "YouTube transcripts", icon: "▶", count: 8,  delay: 0.5 },
  { name: "Reddit threads",      icon: "↑", count: 12, delay: 0.9 },
  { name: "RSS feeds",           icon: "◉", count: 13, delay: 1.3 },
];

function CollectPhase() {
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0]);

  useEffect(() => {
    SOURCES.forEach((s, i) => {
      const to = s.count;
      setTimeout(() => {
        let n = 0;
        const iv = setInterval(() => {
          n++;
          setCounts(prev => { const c = [...prev]; c[i] = n; return c; });
          if (n >= to) clearInterval(iv);
        }, 80);
      }, s.delay * 1000);
    });
  }, []);

  return (
    <div className="demo-panel">
      <div className="demo-panel-header">
        <span className="demo-status-dot demo-dot-active" />
        <span className="demo-phase-label">Collecting from your sources</span>
      </div>
      <div className="demo-source-list">
        {SOURCES.map((s, i) => (
          <motion.div
            key={s.name}
            className="demo-source-row"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: s.delay, duration: 0.4 }}
          >
            <span className="demo-source-icon">{s.icon}</span>
            <span className="demo-source-name">{s.name}</span>
            <div className="demo-source-bar-wrap">
              <motion.div
                className="demo-source-bar"
                initial={{ width: 0 }}
                animate={{ width: `${(counts[i] / s.count) * 100}%` }}
              />
            </div>
            <span className="demo-source-count">
              {counts[i]} <span className="demo-source-total">/ {s.count}</span>
            </span>
          </motion.div>
        ))}
      </div>
      <motion.div
        className="demo-panel-footer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.2 }}
      >
        <span className="demo-footer-num">47</span> items collected from your sources
      </motion.div>
    </div>
  );
}

/* ── Process phase ─────────────────────────────────────────────────────────── */
const ITEMS = [
  { title: "Claude 4 shows 40% improvement on agentic tasks", keep: true,  score: 0.91 },
  { title: "Best coffee shops for remote work in Bangalore",   keep: false, score: 0.12 },
  { title: "Perplexity raises $500M — pivoting to AI agents",  keep: true,  score: 0.88 },
  { title: "Celebrity news: weekend roundup",                  keep: false, score: 0.03 },
  { title: "Zepto hits ₹5,000 Cr GMV — unit economics shift", keep: true,  score: 0.79 },
  { title: "10 productivity hacks you haven't tried",          keep: false, score: 0.21 },
];

function ProcessPhase() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setShown(p => Math.min(p + 1, ITEMS.length)), 380);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="demo-panel">
      <div className="demo-panel-header">
        <span className="demo-status-dot demo-dot-processing" />
        <span className="demo-phase-label">Scoring relevance to your profile</span>
      </div>
      <div className="demo-item-list">
        {ITEMS.slice(0, shown).map((item) => (
          <motion.div
            key={item.title}
            className={`demo-item-row ${item.keep ? "demo-item-keep" : "demo-item-drop"}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <span className="demo-item-verdict">{item.keep ? "✓" : "✕"}</span>
            <span className="demo-item-title">{item.title}</span>
            <div className="demo-score-bar-wrap">
              <div
                className={`demo-score-bar ${item.keep ? "demo-score-high" : "demo-score-low"}`}
                style={{ width: `${item.score * 100}%` }}
              />
            </div>
            <span className="demo-score-num">{item.score.toFixed(2)}</span>
          </motion.div>
        ))}
      </div>
      {shown >= ITEMS.length && (
        <motion.div
          className="demo-panel-footer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <span className="demo-footer-num">10</span> items selected ·{" "}
          <span style={{ color: "var(--text-muted)" }}>37 skipped (off-topic or seen before)</span>
        </motion.div>
      )}
    </div>
  );
}

/* ── Write phase ─────────────────────────────────────────────────────────────── */
const WHY_TEXT = "As someone building an agent-based product, this directly affects how much you can trust multi-step tool calls without human oversight. The benchmark jump is significant enough to revisit your current review checkpoints.";
const HEADLINE_TEXT = "Anthropic's Claude 4 shows 40% improvement on agentic tasks — tool use reliability crosses enterprise threshold";

function WritePhase() {
  const headline = useTypewriter(HEADLINE_TEXT, true, 22);
  const why = useTypewriter(WHY_TEXT, headline.length === HEADLINE_TEXT.length, 16);
  const showCursor = why.length < WHY_TEXT.length;

  return (
    <div className="demo-panel demo-panel-write">
      <div className="demo-panel-header">
        <span className="demo-status-dot demo-dot-write" />
        <span className="demo-phase-label">Writing why this matters to you…</span>
      </div>
      <div className="demo-briefing-preview">
        <p className="demo-briefing-section">AI &amp; Product</p>
        <div className="demo-briefing-meta">
          <span className="demo-briefing-source">The Rundown AI</span>
          <span className="demo-briefing-tag">new</span>
        </div>
        <h3 className="demo-briefing-headline">
          {headline}
          {headline.length < HEADLINE_TEXT.length && (
            <span className="demo-cursor" />
          )}
        </h3>
        {headline.length === HEADLINE_TEXT.length && (
          <motion.div
            className="demo-why-block"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.4 }}
          >
            <p className="demo-why-label">Why this matters to you</p>
            <p className="demo-why-text">
              {why}
              {showCursor && <span className="demo-cursor" />}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ── Deliver phase ─────────────────────────────────────────────────────────── */
function DeliverPhase() {
  return (
    <div className="demo-panel">
      <div className="demo-panel-header">
        <span className="demo-status-dot demo-dot-deliver" />
        <span className="demo-phase-label">Sent to your inbox</span>
      </div>
      <motion.div
        className="demo-email-card"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="demo-email-header">
          <div className="demo-email-avatar">B</div>
          <div>
            <p className="demo-email-from">Briefly</p>
            <p className="demo-email-time">7:02 AM</p>
          </div>
          <span className="demo-delivered-badge">✓ Delivered</span>
        </div>
        <p className="demo-email-subject">Your briefing — Thursday, 29 May</p>
        <p className="demo-email-preview">
          Read 47 items across 4 sources. Here&apos;s what matters to you today.
        </p>
        <div className="demo-email-items">
          {["Claude 4 — agentic benchmark", "Perplexity pivots to agents", "Zepto unit economics"].map((t) => (
            <span key={t} className="demo-email-item-pill">{t}</span>
          ))}
          <span className="demo-email-item-pill demo-pill-more">+7 more</span>
        </div>
      </motion.div>
      <motion.p
        className="demo-see-you"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        See you tomorrow morning.
      </motion.p>
    </div>
  );
}

/* ── Main LiveDemo ──────────────────────────────────────────────────────────── */
export function LiveDemo() {
  const [phase, setPhase] = useState<Phase>("collect");
  const [phaseIdx, setPhaseIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dur = PHASE_DURATIONS[phase];
    const t = setTimeout(() => {
      const next = (phaseIdx + 1) % PHASES.length;
      setPhaseIdx(next);
      setPhase(PHASES[next]);
    }, dur);
    return () => clearTimeout(t);
  }, [phase, phaseIdx]);

  const PHASE_LABELS: Record<Phase, string> = {
    collect: "01  Collect",
    process: "02  Process",
    write:   "03  Write",
    deliver: "04  Deliver",
  };

  return (
    <section className="livedemo-section" id="demo">
      <div className="livedemo-inner">
        <div className="section-header-centered" style={{ marginBottom: 48 }}>
          <p className="section-eyebrow" style={{ color: "var(--accent)" }}>Live demo</p>
          <h2 className="section-heading">
            Watch it work
          </h2>
          <p className="section-body">
            This is exactly what runs every night for your sources — in real time.
          </p>
        </div>

        {/* Phase tabs */}
        <div className="livedemo-tabs">
          {PHASES.map((p) => (
            <button
              key={p}
              type="button"
              className={`livedemo-tab${phase === p ? " active" : ""}`}
              onClick={() => { setPhase(p); setPhaseIdx(PHASES.indexOf(p)); }}
            >
              <span className={`livedemo-tab-dot${phase === p ? " active" : ""}`} />
              {PHASE_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Animated phase content */}
        <div className="livedemo-stage" ref={ref}>
          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: EASE }}
              style={{ width: "100%" }}
            >
              {phase === "collect"  && <CollectPhase  />}
              {phase === "process"  && <ProcessPhase  />}
              {phase === "write"    && <WritePhase    />}
              {phase === "deliver"  && <DeliverPhase  />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress bar */}
        <div className="livedemo-progress-wrap">
          {PHASES.map((p) => (
            <motion.div
              key={p}
              className={`livedemo-progress-seg${phase === p ? " active" : ""}`}
            >
              {phase === p && (
                <motion.div
                  className="livedemo-progress-fill"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: PHASE_DURATIONS[p] / 1000, ease: "linear" }}
                />
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
