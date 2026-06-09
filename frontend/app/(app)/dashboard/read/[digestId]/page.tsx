"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { api, type Digest, type DigestItem } from "@/lib/api";
import { SourceIcon } from "@/components/SourceIcon";
import { isReadableArticleUrl } from "@/lib/articleUrls";
import {
  SECTION_HIGHLY_RELEVANT,
  SECTION_WHATS_NEW,
  sectionBadgeClass,
} from "@/lib/digestSections";
import { askAboutContent } from "@/lib/askLinks";
import { graphItemUrl } from "@/lib/graphLinks";

// ── Types ─────────────────────────────────────────────────────────────────────
type Mode = "quick" | "deep";

// ── Web Speech API hook ───────────────────────────────────────────────────────
function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (typeof window === "undefined") return;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onstart  = () => setSpeaking(true);
    utterance.onend    = () => setSpeaking(false);
    utterance.onerror  = () => setSpeaking(false);
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const toggle = useCallback((text: string) => {
    if (speaking) { stop(); } else { speak(text); }
  }, [speaking, speak, stop]);

  // Cleanup on unmount
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);

  return { speaking, speak, stop, toggle };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const CARD_VARIANTS = {
  enter:  (d: number) => ({ x: d * 64, opacity: 0, scale: 0.98 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit:   (d: number) => ({ x: d * -64, opacity: 0, scale: 0.98 }),
};

function sectionHint(section: string): string | null {
  if (section === SECTION_WHATS_NEW) return "Latest from your sources";
  if (section === SECTION_HIGHLY_RELEVANT) return "Picked for your interests";
  return null;
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec.toString().padStart(2, "0")}s` : `${sec}s`;
}

// ── Card component ─────────────────────────────────────────────────────────────
function SpeakerIcon({ speaking }: { speaking: boolean }) {
  return speaking ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M15.54 8.46a5 5 0 010 7.07" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M19.07 4.93a10 10 0 010 14.14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function SaveIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} aria-hidden>
      <path
        d="M12 3.5l2.35 4.76 5.25.76-3.8 3.7.9 5.23L12 15.9l-4.7 2.47.9-5.23-3.8-3.7 5.25-.76L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DislikeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ReadingCard({
  item, mode, isSaved, isDisliked, onSave, onDislike, index, showMemoryCallout,
}: {
  item: DigestItem;
  mode: Mode;
  isSaved: boolean;
  isDisliked: boolean;
  onSave: () => void;
  onDislike: () => void;
  index: number;
  showMemoryCallout: boolean;
}) {
  const firstMemory = item.memory_connections?.[0];
  const memoryText = item.memory_reference || firstMemory?.description || null;
  const coverageNote = item.duplicate_count > 1
    ? `Also covered by ${item.duplicate_count - 1} other source${item.duplicate_count > 2 ? "s" : ""}`
    : null;
  const hasDeepSummary = mode === "deep" && !!item.summary;
  const articleUrl = isReadableArticleUrl(item.source_url) ? item.source_url : null;

  return (
    <div className="read-stage">

      {/* ── Meta row ── */}
      <motion.div
        className="read-meta"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        <div className="read-meta-left">
          <SourceIcon
            name={item.source_name ?? undefined}
            url={item.source_url ?? undefined}
            size={18}
          />
          {item.source_name && (
            <span className="read-meta-source">{item.source_name}</span>
          )}
          {item.section && (
            <>
              <span className="read-meta-sep" aria-hidden>·</span>
              <span className="read-meta-chip">{item.section}</span>
            </>
          )}
          {coverageNote && (
            <span className="read-meta-coverage">{coverageNote}</span>
          )}
        </div>
        <div className="read-meta-actions">
          {item.content_id ? (
            <>
              <Link
                href={askAboutContent(item.content_id, item.id, item.headline)}
                className="read-ask-link"
              >
                Ask
              </Link>
              <Link href={graphItemUrl(item.content_id)} className="read-graph-link">
                Graph
              </Link>
            </>
          ) : null}
          {/* Dislike — one tap, "less like this" */}
          <button
            className={`read-dislike-btn${isDisliked ? " disliked" : ""}`}
            onClick={onDislike}
            aria-label="Less like this"
            title="Less like this"
          >
            <DislikeIcon />
          </button>
          <button
            className={`read-save-btn${isSaved ? " saved" : ""}`}
            onClick={onSave}
            aria-label={isSaved ? "Saved" : "Save for later"}
          >
            <SaveIcon filled={isSaved} />
          </button>
        </div>
      </motion.div>

      {/* ── Memory callout — shown on the item Briefly remembers (both modes) ── */}
      {showMemoryCallout && memoryText && (
        <motion.div
          className="read-memory-callout"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          <span className="read-memory-callout-icon" aria-hidden>⟳</span>
          <span className="read-memory-callout-text">{memoryText}</span>
        </motion.div>
      )}

      {/* ── Headline zone — vertically centered ── */}
      <div className="read-headline-zone">
        <span className="read-bg-num" aria-hidden>
          {String(index + 1).padStart(2, "0")}
        </span>

        <motion.h1
          className="read-headline-xl"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          {item.headline}
        </motion.h1>

        {hasDeepSummary && (
          <motion.p
            className="read-summary-v2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: EASE }}
          >
            {item.summary}
          </motion.p>
        )}
      </div>

      {/* ── Why this matters ── */}
      <motion.div
        className="read-why-v2"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: hasDeepSummary ? 0.18 : 0.12, ease: EASE }}
      >
        <div className="read-why-v2-header">
          <span className="read-why-v2-icon" aria-hidden>✦</span>
          <span className="read-why-v2-label">Why this matters to you</span>
        </div>
        <p className="read-why-v2-text">{item.why_it_matters}</p>

        {/* Confidence signal — how Briefly knows this is relevant */}
        {item.confidence_signal && (
          <p className="read-confidence-signal">◈ {item.confidence_signal}</p>
        )}

        <div className="read-why-links">
          {articleUrl ? (
            <motion.a
              href={articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="read-article-link"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.28, ease: EASE }}
            >
              Read full article
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M7 17L17 7M17 7H9M17 7v8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.a>
          ) : null}
          {item.content_id ? (
            <motion.div
              className="read-why-ask-graph"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.32, ease: EASE }}
            >
              <Link
                href={askAboutContent(item.content_id, item.id, item.headline)}
                className="read-ask-link read-ask-link-why"
              >
                Ask about this
              </Link>
              <Link href={graphItemUrl(item.content_id)} className="read-graph-link read-graph-link-why">
                View in graph
              </Link>
            </motion.div>
          ) : null}
        </div>
      </motion.div>

      {/* ── Evolution note (deep mode) — surfaces when behavior diverges from stated interests ── */}
      {item.evolution_note && mode === "deep" && (
        <motion.div
          className="read-evolution-note"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3, ease: EASE }}
        >
          <span className="read-evolution-icon" aria-hidden>◐</span>
          <p className="read-evolution-text">{item.evolution_note}</p>
        </motion.div>
      )}

      {/* ── Memory connection detail (deep only, fallback if no callout) ── */}
      {firstMemory && mode === "deep" && !showMemoryCallout && (
        <motion.div
          className="read-memory-v2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.24, ease: EASE }}
        >
          <span className="read-memory-v2-label">⌥  Connected to you</span>
          <p className="read-memory-v2-text">{firstMemory.description}</p>
        </motion.div>
      )}
    </div>
  );
}

// ── Completion screen ─────────────────────────────────────────────────────────
function CompletionScreen({
  digest, savedCount, elapsed, streak, onBack,
}: { digest: Digest; savedCount: number; elapsed: number; streak: number; onBack: () => void }) {
  const [moreTodayOpen, setMoreTodayOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);

  // Good-fit articles cut for length — bonus reading, not rejections
  const moreToday = digest.meta?.more_today ?? [];
  // Truly filtered: never_show, low_relevance, too_old
  const blocked = digest.meta?.blocked ?? digest.meta?.skipped ?? [];

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

        {/* ── More from today — good fit, cut for length cap ── */}
        {moreToday.length > 0 && (
          <div className="read-more-today">
            <button
              className="read-skipped-toggle"
              onClick={() => setMoreTodayOpen((v) => !v)}
            >
              <span className="read-more-today-label">
                More from today
                <span className="read-more-today-count"> · {moreToday.length} articles</span>
              </span>
              <motion.span
                animate={{ rotate: moreTodayOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                ▾
              </motion.span>
            </button>

            <AnimatePresence>
              {moreTodayOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <p className="read-more-today-desc">
                    These {moreToday.length} articles matched your interests but didn&apos;t fit
                    in today&apos;s brief — usually because Briefly limits how many items one
                    source can contribute. Open any you want; unrelated topics belong in{" "}
                    <a href="/settings">Preferences → Never show</a>.
                  </p>
                  <div className="read-more-today-list">
                    {moreToday.map((item, i) => (
                      <div key={i} className="read-more-today-item">
                        <div className="read-more-today-body">
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="read-more-today-title"
                            >
                              {item.title}
                            </a>
                          ) : (
                            <span className="read-more-today-title">{item.title}</span>
                          )}
                          {item.source && (
                            <span className="read-more-today-source">{item.source}</span>
                          )}
                        </div>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="read-more-today-link"
                            aria-label={`Read ${item.title}`}
                          >
                            →
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── What Briefly actually filtered ── */}
        {blocked.length > 0 && (
          <div className="read-skipped">
            <button
              className="read-skipped-toggle"
              onClick={() => setBlockedOpen((v) => !v)}
            >
              <span>What Briefly filtered ({blocked.length} items)</span>
              <motion.span
                animate={{ rotate: blockedOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                ▾
              </motion.span>
            </button>

            <AnimatePresence>
              {blockedOpen && (
                <motion.div
                  className="read-skipped-list"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="read-skipped-scroll">
                    {blocked.map((s, i) => (
                      <div key={i} className="read-skipped-item">
                        <span className="read-skipped-reason">{s.reason}</span>
                        <span className="read-skipped-title">{s.title}</span>
                        {s.source && (
                          <span className="read-skipped-source">{s.source}</span>
                        )}
                      </div>
                    ))}
                  </div>
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

// ── Progress dots ─────────────────────────────────────────────────────────────
function ProgressDots({ current, total }: { current: number; total: number }) {
  const MAX = 13;
  const n = Math.min(total, MAX);
  const active = total <= MAX
    ? current
    : Math.round((current / Math.max(total - 1, 1)) * (n - 1));
  return (
    <div className="read-dots" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`read-dot${i === active ? " active" : i < active ? " done" : ""}`} />
      ))}
    </div>
  );
}

// ── Skeleton loading screen ───────────────────────────────────────────────────
function ReadingSkeleton() {
  return (
    <div className="read-shell">
      <header className="read-header">
        <div className="rsk rsk-back" />
        <div className="read-progress-bar" />
        <div className="read-header-right">
          <div className="rsk rsk-badge" />
          <div className="rsk rsk-toggle" />
        </div>
      </header>

      <main className="read-card-area">
        <div className="read-card-wrapper">
          <div className="read-stage">
            {/* Meta row */}
            <div className="read-meta">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="rsk" style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0 }} />
                <div className="rsk rsk-chip" />
                <div className="rsk rsk-chip-sm" />
              </div>
              <div className="rsk rsk-save" />
            </div>

            {/* Headline zone */}
            <div className="read-headline-zone">
              <div className="rsk-group">
                <div className="rsk rsk-h1-xl" />
                <div className="rsk rsk-h2-xl" />
                <div className="rsk rsk-h3-xl" />
              </div>
            </div>

            {/* Why block */}
            <div className="rsk-why-wrap">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="rsk" style={{ width: 10, height: 10, borderRadius: "50%" }} />
                <div className="rsk rsk-why-label" />
              </div>
              <div className="rsk rsk-why-line" />
              <div className="rsk rsk-why-line" style={{ width: "74%" }} />
            </div>
          </div>
        </div>
      </main>

      <footer className="read-footer">
        <div className="rsk rsk-nav" />
        <div className="read-footer-center">
          <div className="rsk rsk-counter" />
          <div className="rsk rsk-save-label" />
        </div>
        <div className="rsk rsk-nav" />
      </footer>
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
  const [disliked, setDisliked]   = useState<Set<string>>(new Set());
  const [isComplete, setIsComplete] = useState(false);
  const [elapsed, setElapsed]     = useState(0);
  // Track which item index gets the memory callout (first item with memory_reference or memory_connections)
  const memoryCalloutIndex = useMemo(() => {
    const items = digest?.items ?? [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].memory_reference || items[i].memory_connections?.length) return i;
    }
    return -1;
  }, [digest]);

  const startRef  = useRef(Date.now());
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const { speaking, stop, toggle: toggleSpeech } = useSpeech();

  // Load digest, streak, and persisted save/dislike signals in one shot
  useEffect(() => {
    Promise.all([
      api.getDigest(digestId),
      api.getMe(),
      api.getDigestFeedback(digestId).catch(() => ({} as Record<string, "saved" | "disliked">)),
    ])
      .then(([d, me, feedback]) => {
        setDigest(d);
        setStreak(me.reading_streak);
        // Restore saved/disliked state so stars and thumbs-downs persist across sessions
        const savedIds  = new Set(Object.entries(feedback).filter(([, v]) => v === "saved").map(([k]) => k));
        const dislikedIds = new Set(Object.entries(feedback).filter(([, v]) => v === "disliked").map(([k]) => k));
        if (savedIds.size)    setSaved(savedIds);
        if (dislikedIds.size) setDisliked(dislikedIds);
        setLoading(false);
      })
      .catch(() => router.replace("/dashboard"));
  }, [digestId, router]);

  // Stop speech when navigating to a different card
  useEffect(() => { stop(); }, [currentIndex, stop]);

  // Reading clock
  useEffect(() => {
    if (loading || isComplete) return;
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [loading, isComplete]);

  // Memoise so useCallback deps don't change on every render
  const items = useMemo(() => digest?.items ?? [], [digest]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const complete = useCallback(() => {
    if (!digest) return;
    setIsComplete(true);
    if (timerRef.current) clearInterval(timerRef.current);
    api.completeReading(digest.id, elapsed);
  }, [digest, elapsed]);

  const addToSaved = useCallback((id: string) => {
    // Array.from avoids the Set-spread downlevelIteration TS error
    setSaved((prev) => new Set(Array.from(prev).concat(id)));
  }, []);

  const advance = useCallback((withSave = false) => {
    if (!digest) return;
    const item = items[currentIndex];
    if (withSave && item && !saved.has(item.id)) {
      addToSaved(item.id);
      api.recordFeedback({ signal_type: "saved", digest_item_id: item.id, digest_id: digest.id });
    } else if (!withSave && item && !saved.has(item.id) && !disliked.has(item.id)) {
      // User skipped without saving or disliking — record skip signal
      api.recordFeedback({ signal_type: "skipped", digest_item_id: item.id, digest_id: digest.id })
        .catch(() => {});
    }
    setDirection(1);
    if (currentIndex >= items.length - 1) {
      complete();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, items, digest, saved, disliked, complete, addToSaved]);

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
    addToSaved(item.id);
    api.recordFeedback({ signal_type: "saved", digest_item_id: item.id, digest_id: digest.id });
  }, [currentIndex, items, digest, saved, addToSaved]);

  const toggleDislike = useCallback(() => {
    if (!digest) return;
    const item = items[currentIndex];
    if (!item || disliked.has(item.id)) return;
    setDisliked((prev) => new Set(Array.from(prev).concat(item.id)));
    api.recordFeedback({ signal_type: "disliked", digest_item_id: item.id, digest_id: digest.id })
      .catch(() => {});
  }, [currentIndex, items, digest, disliked]);

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
        case "d":
        case "D": toggleDislike(); break;
        case "Escape": router.replace("/dashboard"); break;
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [advance, goBack, toggleSave, toggleDislike, isComplete, router]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <ReadingSkeleton />;

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
  const prevItem = currentIndex > 0 ? items[currentIndex - 1] : null;
  const showSectionBanner = Boolean(
    item.section && item.section !== prevItem?.section,
  );
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
            <span className="read-streak-badge">
              <span className="read-streak-dot" aria-hidden />
              Day {streak}
            </span>
          )}
          <button
            type="button"
            className={`read-speak-btn${speaking ? " speaking" : ""}`}
            onClick={() => toggleSpeech(`${item.headline}. ${item.why_it_matters}`)}
            aria-label={speaking ? "Stop reading" : "Read this item aloud"}
            title={speaking ? "Stop" : "Listen"}
          >
            <SpeakerIcon speaking={speaking} />
          </button>
          <div className="read-mode-toggle" role="group" aria-label="Reading mode">
            <button
              type="button"
              className={`read-mode-opt${mode === "quick" ? " active" : ""}`}
              onClick={() => setMode("quick")}
            >
              Quick
            </button>
            <button
              type="button"
              className={`read-mode-opt${mode === "deep" ? " active" : ""}`}
              onClick={() => setMode("deep")}
            >
              Deep
            </button>
          </div>
        </div>
      </header>

      {/* ── Card area ──────────────────────────────────────────────────── */}
      <main className="read-card-area">
        {/* Desktop gutter arrows */}
        {currentIndex > 0 && (
          <button className="read-arrow read-arrow-left" onClick={goBack} aria-label="Previous article" tabIndex={-1}>←</button>
        )}
        <button className="read-arrow read-arrow-right" onClick={() => advance(false)} aria-label="Next article" tabIndex={-1}>→</button>

        {showSectionBanner && item.section && (
          <motion.div
            className="read-section-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <span className={sectionBadgeClass(item.section)}>{item.section}</span>
            {sectionHint(item.section) && (
              <span className="read-section-hint">{sectionHint(item.section)}</span>
            )}
          </motion.div>
        )}
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
              isDisliked={disliked.has(item.id)}
              onSave={toggleSave}
              onDislike={toggleDislike}
              index={currentIndex}
              showMemoryCallout={currentIndex === memoryCalloutIndex}
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
          <ProgressDots current={currentIndex} total={items.length} />
          <button
            className={`read-save-text-btn${saved.has(item.id) ? " saved" : ""}`}
            onClick={() => advance(true)}
          >
            <SaveIcon filled={saved.has(item.id)} />
            {saved.has(item.id) ? "Saved" : "Save & next"}
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
