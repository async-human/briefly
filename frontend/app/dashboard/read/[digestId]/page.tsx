"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api, type Digest, type DigestItem } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────
type Mode = "quick" | "deep";

// ── Helpers ───────────────────────────────────────────────────────────────────
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const CARD_VARIANTS = {
  enter:  (d: number) => ({ x: d * 64, opacity: 0, scale: 0.98 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit:   (d: number) => ({ x: d * -64, opacity: 0, scale: 0.98 }),
};

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec.toString().padStart(2, "0")}s` : `${sec}s`;
}

// ── Card component ─────────────────────────────────────────────────────────────
function ReadingCard({
  item, mode, isSaved, onSave,
}: { item: DigestItem; mode: Mode; isSaved: boolean; onSave: () => void }) {
  const firstMemory = item.memory_connections?.[0];
  const coverageNote = item.duplicate_count > 1
    ? `Also covered by ${item.duplicate_count - 1} other source${item.duplicate_count > 2 ? "s" : ""}`
    : null;

  return (
    <div className="read-card">
      {/* ① Source row */}
      <div className="read-card-top">
        <div className="read-source-row">
          {item.source_name && (
            <span className="read-chip">{item.source_name.toUpperCase()}</span>
          )}
          {item.section && (
            <span className="read-chip read-chip-accent">{item.section}</span>
          )}
          {coverageNote && (
            <span className="read-coverage">{coverageNote}</span>
          )}
        </div>
        <button
          className={`read-save-btn${isSaved ? " saved" : ""}`}
          onClick={onSave}
          aria-label={isSaved ? "Saved" : "Save for later"}
        >
          {isSaved ? "★" : "☆"}
        </button>
      </div>

      {/* ② Headline */}
      <h2 className="read-headline">{item.headline}</h2>

      {/* ③ Summary — Deep Read only */}
      {mode === "deep" && item.summary && (
        <p className="read-summary">{item.summary}</p>
      )}

      {/* ④ Why This Matters — always visible, the core value prop */}
      <div className="read-why">
        <span className="read-why-label">💡 Why this matters to you</span>
        <p className="read-why-text">{item.why_it_matters}</p>
      </div>

      {/* ⑤ Memory connection — Deep Read only */}
      {firstMemory && mode === "deep" && (
        <div className="read-memory">
          <span className="read-memory-icon">🔗</span>
          <span className="read-memory-text">{firstMemory.description}</span>
        </div>
      )}

      {/* ⑥ Read full article link — Deep Read only */}
      {item.source_url && mode === "deep" && (
        <a
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="read-article-link"
        >
          Read full article ↗
        </a>
      )}
    </div>
  );
}

// ── Completion screen ─────────────────────────────────────────────────────────
function CompletionScreen({
  digest, savedCount, elapsed, streak, onBack,
}: { digest: Digest; savedCount: number; elapsed: number; streak: number; onBack: () => void }) {
  const [skippedOpen, setSkippedOpen] = useState(false);
  const skipped = digest.meta?.skipped ?? [];
  const filtered = digest.total_items_ingested - digest.total_items_shown;

  return (
    <div className="read-complete">
      <motion.div
        className="read-complete-inner"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
      >
        <div className="read-complete-sun">☀️</div>

        <div className="read-complete-header">
          <h1 className="read-complete-heading">You&apos;re up to speed.</h1>
          <p className="read-complete-sub">
            {savedCount > 0 ? `${savedCount} saved for later · ` : ""}
            That&apos;s everything that matters today.
          </p>
        </div>

        {/* Stat boxes — stories / time / streak */}
        <div className="read-stats-row">
          <div className="read-stat-box">
            <span className="read-stat-num">{digest.items.length}</span>
            <span className="read-stat-label">stories</span>
          </div>
          <div className="read-stat-box">
            <span className="read-stat-num">{fmtTime(elapsed)}</span>
            <span className="read-stat-label">reading time</span>
          </div>
          <div className="read-stat-box read-stat-streak">
            <span className="read-stat-num">{Math.max(streak, 1)}</span>
            <span className="read-stat-label">day streak 🔥</span>
          </div>
        </div>

        <p className="read-compare">
          The average reader spends 38 minutes on social media and gets a
          fraction of this signal. You got the same in{" "}
          <strong>{fmtTime(elapsed)}</strong>.
        </p>

        {/* ⑥ Skipped items transparency layer */}
        {(skipped.length > 0 || filtered > 0) && (
          <div className="read-skipped">
            <button
              className="read-skipped-toggle"
              onClick={() => setSkippedOpen((v) => !v)}
            >
              <span>
                What I filtered today
                {filtered > 0 ? ` (${filtered} items)` : ""}
              </span>
              <motion.span
                animate={{ rotate: skippedOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                ▾
              </motion.span>
            </button>

            <AnimatePresence>
              {skippedOpen && (
                <motion.div
                  className="read-skipped-list"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {skipped.slice(0, 12).map((s, i) => (
                    <div key={i} className="read-skipped-item">
                      <span className="read-skipped-reason">{s.reason}</span>
                      <span className="read-skipped-title">{s.title}</span>
                      {s.source && (
                        <span className="read-skipped-source">{s.source}</span>
                      )}
                    </div>
                  ))}
                  {filtered > skipped.length && (
                    <p className="read-skipped-more">
                      +{filtered - skipped.length} more items filtered
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <button className="read-back-btn" onClick={onBack}>
          ← Back to dashboard
        </button>
      </motion.div>
    </div>
  );
}

// ── Main reading page ─────────────────────────────────────────────────────────
export default function ReadingPage() {
  const params = useParams();
  const router = useRouter();
  const digestId = params.digestId as string;

  const [digest, setDigest]       = useState<Digest | null>(null);
  const [streak, setStreak]       = useState(0);
  const [loading, setLoading]     = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [mode, setMode]           = useState<Mode>("quick");
  const [saved, setSaved]         = useState<Set<string>>(new Set());
  const [isComplete, setIsComplete] = useState(false);
  const [elapsed, setElapsed]     = useState(0);

  const startRef  = useRef(Date.now());
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load digest + streak
  useEffect(() => {
    Promise.all([api.getDigest(digestId), api.getMe()])
      .then(([d, me]) => {
        setDigest(d);
        setStreak(me.reading_streak);
        setLoading(false);
      })
      .catch(() => router.replace("/dashboard"));
  }, [digestId, router]);

  // Reading clock
  useEffect(() => {
    if (loading || isComplete) return;
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading, isComplete]);

  const items = digest?.items ?? [];

  // ── Navigation ────────────────────────────────────────────────────────────
  const complete = useCallback(() => {
    if (!digest) return;
    setIsComplete(true);
    if (timerRef.current) clearInterval(timerRef.current);
    api.completeReading(digest.id, elapsed);
  }, [digest, elapsed]);

  const advance = useCallback((withSave = false) => {
    if (!digest) return;
    const item = items[currentIndex];
    if (withSave && item && !saved.has(item.id)) {
      setSaved((prev) => new Set([...prev, item.id]));
      api.recordFeedback({ signal_type: "saved", digest_item_id: item.id, digest_id: digest.id });
    }
    setDirection(1);
    if (currentIndex >= items.length - 1) {
      complete();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, items, digest, saved, complete]);

  const goBack = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((i) => i - 1);
    }
  }, [currentIndex]);

  const toggleSave = useCallback(() => {
    if (!digest) return;
    const item = items[currentIndex];
    if (!item || saved.has(item.id)) return;
    setSaved((prev) => new Set([...prev, item.id]));
    api.recordFeedback({ signal_type: "saved", digest_item_id: item.id, digest_id: digest.id });
  }, [currentIndex, items, digest, saved]);

  // Keyboard shortcuts
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (isComplete) return;
      switch (e.key) {
        case "ArrowRight":
        case " ": e.preventDefault(); advance(); break;
        case "ArrowLeft": goBack(); break;
        case "s":
        case "S": toggleSave(); break;
        case "Escape": router.replace("/dashboard"); break;
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [advance, goBack, toggleSave, isComplete, router]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="read-shell read-shell-center">
        <span className="read-loading-dot" />
      </div>
    );
  }

  if (!digest || items.length === 0) {
    return (
      <div className="read-shell read-shell-center">
        <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
          No items to read.
        </p>
        <button className="read-back-btn" onClick={() => router.replace("/dashboard")}>
          ← Back to dashboard
        </button>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="read-shell">
        <CompletionScreen
          digest={digest}
          savedCount={saved.size}
          elapsed={elapsed}
          streak={streak}
          onBack={() => router.replace("/dashboard")}
        />
      </div>
    );
  }

  const item = items[currentIndex];
  const progress = (currentIndex / items.length) * 100;

  return (
    <div className="read-shell">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="read-header">
        <button
          className="read-back-icon"
          onClick={() => router.replace("/dashboard")}
          aria-label="Back to dashboard"
        >
          ←
        </button>

        <div className="read-progress-bar">
          <motion.div
            className="read-progress-fill"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: EASE }}
          />
        </div>

        <div className="read-header-right">
          {streak > 0 && (
            <span className="read-streak-badge">Day {streak} 🔥</span>
          )}
          <button
            className={`read-mode-btn${mode === "quick" ? " active" : ""}`}
            onClick={() => setMode((m) => m === "quick" ? "deep" : "quick")}
            title={mode === "quick" ? "Switch to Deep Read" : "Switch to Quick Takes"}
          >
            {mode === "quick" ? "⚡ Quick" : "📖 Deep"}
          </button>
        </div>
      </header>

      {/* ── Card area ──────────────────────────────────────────────────── */}
      <main className="read-card-area">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={CARD_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.28, ease: EASE }}
            className="read-card-wrapper"
          >
            <ReadingCard
              item={item}
              mode={mode}
              isSaved={saved.has(item.id)}
              onSave={toggleSave}
            />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="read-footer">
        <button
          className="read-nav-btn read-nav-back"
          onClick={goBack}
          disabled={currentIndex === 0}
        >
          ← Back
        </button>

        <div className="read-footer-center">
          <span className="read-counter">{currentIndex + 1} of {items.length}</span>
          <button
            className="read-save-text-btn"
            onClick={() => advance(true)}
          >
            {saved.has(item.id) ? "★ Saved" : "☆ Save & next"}
          </button>
        </div>

        <button
          className="read-nav-btn read-nav-next"
          onClick={() => advance(false)}
        >
          {currentIndex === items.length - 1 ? "Finish ✓" : "Skip →"}
        </button>
      </footer>
    </div>
  );
}
