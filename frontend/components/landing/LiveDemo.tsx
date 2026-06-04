"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { SourceIcon } from "@/components/SourceIcon";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

type Phase = "collect" | "process" | "write" | "deliver";

const PHASE_DURATIONS: Record<Phase, number> = {
  collect: 3800,
  process: 3400,
  write: 6000,
  deliver: 2800,
};

const PHASES: Phase[] = ["collect", "process", "write", "deliver"];

const PHASE_META: Record<
  Phase,
  { num: string; label: string; status: string }
> = {
  collect: { num: "01", label: "Collect", status: "Collecting from your sources" },
  process: { num: "02", label: "Process", status: "Scoring relevance to your profile" },
  write: { num: "03", label: "Write", status: "Writing why this matters to you" },
  deliver: { num: "04", label: "Deliver", status: "Sent to your inbox" },
};

function useTypewriter(text: string, active: boolean, speed = 18) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!active) {
      setShown(0);
      return;
    }
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

const SOURCES = [
  { name: "Gmail newsletters", type: "gmail", count: 14, delay: 0.1 },
  { name: "YouTube transcripts", type: "youtube", count: 8, delay: 0.5 },
  { name: "Reddit threads", type: "reddit", count: 12, delay: 0.9 },
  { name: "RSS feeds", type: "rss", count: 13, delay: 1.3 },
];

function CollectPhase({ runId }: { runId: number }) {
  const [counts, setCounts] = useState<number[]>([0, 0, 0, 0]);

  useEffect(() => {
    setCounts([0, 0, 0, 0]);
    const timers: ReturnType<typeof setInterval>[] = [];
    SOURCES.forEach((s, i) => {
      const timeout = setTimeout(() => {
        let n = 0;
        const iv = setInterval(() => {
          n++;
          setCounts((prev) => {
            const c = [...prev];
            c[i] = n;
            return c;
          });
          if (n >= s.count) clearInterval(iv);
        }, 80);
        timers.push(iv);
      }, s.delay * 1000);
      void timeout;
    });
    return () => timers.forEach(clearInterval);
  }, [runId]);

  return (
    <div className="demo-panel">
      <div className="demo-panel-header">
        <span className="demo-status-dot demo-dot-active" />
        <span className="demo-phase-label">{PHASE_META.collect.status}</span>
      </div>
      <div className="demo-panel-body">
        <div className="demo-source-list">
          {SOURCES.map((s, i) => (
            <motion.div
              key={s.name}
              className="demo-source-row"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: s.delay, duration: 0.35, ease: EASE }}
            >
              <span className="demo-source-icon">
                <SourceIcon type={s.type} name={s.name} size={16} />
              </span>
              <span className="demo-source-name">{s.name}</span>
              <div className="demo-source-bar-wrap">
                <motion.div
                  className="demo-source-bar"
                  initial={{ width: 0 }}
                  animate={{ width: `${(counts[i] / s.count) * 100}%` }}
                  transition={{ duration: 0.08, ease: "linear" }}
                />
              </div>
              <span className="demo-source-count">
                {counts[i]} <span className="demo-source-total">/ {s.count}</span>
              </span>
            </motion.div>
          ))}
        </div>
      </div>
      <div className="demo-panel-footer">
        <span className="demo-footer-num">47</span>
        items collected from your sources
      </div>
    </div>
  );
}

const ITEMS = [
  { title: "Claude 4 shows 40% improvement on agentic tasks", keep: true, score: 0.91 },
  { title: "Best coffee shops for remote work in Bangalore", keep: false, score: 0.12 },
  { title: "Perplexity raises $500M — pivoting to AI agents", keep: true, score: 0.88 },
  { title: "Celebrity news: weekend roundup", keep: false, score: 0.03 },
  { title: "Zepto hits ₹5,000 Cr GMV — unit economics shift", keep: true, score: 0.79 },
  { title: "10 productivity hacks you haven't tried", keep: false, score: 0.21 },
];

function ProcessPhase({ runId }: { runId: number }) {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    setRevealed(0);
    const iv = setInterval(() => setRevealed((p) => Math.min(p + 1, ITEMS.length)), 380);
    return () => clearInterval(iv);
  }, [runId]);

  return (
    <div className="demo-panel">
      <div className="demo-panel-header">
        <span className="demo-status-dot demo-dot-processing" />
        <span className="demo-phase-label">{PHASE_META.process.status}</span>
      </div>
      <div className="demo-panel-body">
        <div className="demo-item-list">
          {ITEMS.map((item, i) => (
            <motion.div
              key={item.title}
              className={`demo-item-row ${item.keep ? "demo-item-keep" : "demo-item-drop"}`}
              initial={false}
              animate={{
                opacity: i < revealed ? 1 : 0.12,
                x: i < revealed ? 0 : -6,
              }}
              transition={{ duration: 0.28, ease: EASE }}
            >
              <span className="demo-item-verdict">{item.keep ? "✓" : "✕"}</span>
              <span className="demo-item-title">{item.title}</span>
              <div className="demo-score-bar-wrap">
                <div
                  className={`demo-score-bar ${item.keep ? "demo-score-high" : "demo-score-low"}`}
                  style={{ width: i < revealed ? `${item.score * 100}%` : "0%" }}
                />
              </div>
              <span className="demo-score-num">
                {i < revealed ? item.score.toFixed(2) : "—"}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
      <motion.div
        className="demo-panel-footer"
        animate={{ opacity: revealed >= ITEMS.length ? 1 : 0.35 }}
        transition={{ duration: 0.3 }}
      >
        <span className="demo-footer-num">10</span>
        items selected ·{" "}
        <span className="demo-footer-muted">37 skipped (off-topic or seen before)</span>
      </motion.div>
    </div>
  );
}

const WHY_TEXT =
  "As someone building an agent-based product, this directly affects how much you can trust multi-step tool calls without human oversight. The benchmark jump is significant enough to revisit your current review checkpoints.";
const HEADLINE_TEXT =
  "Anthropic's Claude 4 shows 40% improvement on agentic tasks — tool use reliability crosses enterprise threshold";

function WritePhase({ runId }: { runId: number }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
    const t = setTimeout(() => setActive(true), 120);
    return () => clearTimeout(t);
  }, [runId]);

  const headline = useTypewriter(HEADLINE_TEXT, active, 22);
  const headlineDone = headline.length === HEADLINE_TEXT.length;
  const why = useTypewriter(WHY_TEXT, headlineDone, 16);
  const showCursor =
    !headlineDone || (headlineDone && why.length < WHY_TEXT.length);

  return (
    <div className="demo-panel demo-panel-write">
      <div className="demo-panel-header">
        <span className="demo-status-dot demo-dot-write" />
        <span className="demo-phase-label">{PHASE_META.write.status}…</span>
      </div>
      <div className="demo-panel-body">
        <div className="demo-briefing-preview">
          <p className="demo-briefing-section">AI &amp; Product</p>
          <div className="demo-briefing-meta">
            <span className="demo-briefing-source">The Rundown AI</span>
            <span className="demo-briefing-tag">new</span>
          </div>
          <h3 className="demo-briefing-headline">
            {headline}
            {!headlineDone && <span className="demo-cursor" />}
          </h3>
          <div className={`demo-why-block${headlineDone ? " is-visible" : ""}`}>
            <p className="demo-why-label">Why this matters to you</p>
            <p className="demo-why-text">
              {headlineDone ? why : "\u00A0"}
              {headlineDone && showCursor && <span className="demo-cursor" />}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeliverPhase({ runId }: { runId: number }) {
  return (
    <div className="demo-panel" key={runId}>
      <div className="demo-panel-header">
        <span className="demo-status-dot demo-dot-deliver" />
        <span className="demo-phase-label">{PHASE_META.deliver.status}</span>
      </div>
      <div className="demo-panel-body demo-panel-body-center">
        <motion.div
          className="demo-email-card"
          initial={{ opacity: 0, scale: 0.98, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE }}
        >
          <div className="demo-email-header">
            <div className="demo-email-avatar">B</div>
            <div>
              <p className="demo-email-from">Briefly</p>
              <p className="demo-email-time">7:02 AM</p>
            </div>
            <span className="demo-delivered-badge">Delivered</span>
          </div>
          <p className="demo-email-subject">Your briefing — Thursday, 29 May</p>
          <p className="demo-email-preview">
            Read 47 items across 4 sources. Here&apos;s what matters to you today.
          </p>
          <div className="demo-email-items">
            {["Claude 4 — agentic benchmark", "Perplexity pivots to agents", "Zepto unit economics"].map(
              (t) => (
                <span key={t} className="demo-email-item-pill">
                  {t}
                </span>
              )
            )}
            <span className="demo-email-item-pill demo-pill-more">+7 more</span>
          </div>
        </motion.div>
        <p className="demo-see-you">See you tomorrow morning.</p>
      </div>
    </div>
  );
}

export function LiveDemo() {
  const [phase, setPhase] = useState<Phase>("collect");
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [runId, setRunId] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goToPhase = useCallback((next: Phase, idx: number, bumpRun = true) => {
    setPhase(next);
    setPhaseIdx(idx);
    if (bumpRun) setRunId((r) => r + 1);
  }, []);

  useEffect(() => {
    if (paused) return;
    timerRef.current = setTimeout(() => {
      const next = (phaseIdx + 1) % PHASES.length;
      goToPhase(PHASES[next], next, true);
    }, PHASE_DURATIONS[phase]);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, phaseIdx, paused, goToPhase]);

  return (
    <section className="livedemo-section" id="demo">
      <div className="livedemo-inner">
        <div className="section-header-centered livedemo-header">
          <p className="section-eyebrow">Live demo</p>
          <h2 className="section-heading">Watch it work</h2>
          <p className="section-body">
            This is exactly what runs every night for your sources — tap a step to explore.
          </p>
        </div>

        <div
          className="livedemo-chrome"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="livedemo-tabs" role="tablist" aria-label="Pipeline steps">
            {PHASES.map((p, i) => {
              const meta = PHASE_META[p];
              const isActive = phase === p;

              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`livedemo-tab${isActive ? " active" : ""}${i < phaseIdx ? " done" : ""}`}
                  onClick={() => goToPhase(p, i, true)}
                >
                  <span className="livedemo-tab-num">{meta.num}</span>
                  <span className="livedemo-tab-label">{meta.label}</span>
                  {i < phaseIdx && <span className="livedemo-tab-check" aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>

          <div className="livedemo-stage">
            <span className="livedemo-stage-glow" aria-hidden />
            <AnimatePresence mode="wait">
              <motion.div
                key={`${phase}-${runId}`}
                className="livedemo-stage-panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.32, ease: EASE }}
              >
                {phase === "collect" && <CollectPhase runId={runId} />}
                {phase === "process" && <ProcessPhase runId={runId} />}
                {phase === "write" && <WritePhase runId={runId} />}
                {phase === "deliver" && <DeliverPhase runId={runId} />}
              </motion.div>
            </AnimatePresence>

            {paused && (
              <span className="livedemo-pause-hint" aria-live="polite">
                Paused
              </span>
            )}
          </div>

          <div className="livedemo-progress-wrap" aria-hidden>
            {PHASES.map((p, i) => (
              <div
                key={p}
                className={`livedemo-progress-seg${phase === p ? " active" : ""}${i < phaseIdx ? " done" : ""}`}
              >
                {phase === p && !paused && (
                  <motion.div
                    className="livedemo-progress-fill"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{
                      duration: PHASE_DURATIONS[p] / 1000,
                      ease: "linear",
                    }}
                    style={{ transformOrigin: "left center" }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
