"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { getToken, googleLoginUrl } from "@/lib/auth";
import { api } from "@/lib/api";
import { TimeGreetingBadge, TimeGreetingCardTitle } from "@/components/TimeGreeting";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const SAMPLE_ITEMS = [
  {
    source: "HACKER NEWS",
    tag: "AI",
    headline: "The model context protocol is quietly becoming the standard for AI tooling",
    why: "You've been tracking the MCP thread since January — this is the biggest mainstream pickup yet.",
    time: "3h ago",
  },
  {
    source: "REDDIT · r/startups",
    tag: "FUNDRAISING",
    headline: "YC S25 acceptance rate hit a record low — here's what the batch looks like",
    why: "Relevant to your raise planning. Two threads you saved connect to this.",
    time: "5h ago",
  },
  {
    source: "YOUR NEWSLETTERS",
    tag: "PRODUCT",
    headline: "Figma's new AI features are landing in the next major update",
    why: "Three of your saved threads tie into this. You've been watching the design-AI space.",
    time: "7h ago",
  },
];

const SOURCES = [
  { name: "Gmail",   count: 14, icon: "✉" },
  { name: "YouTube", count: 6,  icon: "▶" },
  { name: "Reddit",  count: 22, icon: "↑" },
  { name: "HN",      count: 18, icon: "#" },
];

const FLOAT_BADGES = [
  { label: "Gmail",    top: "12%",  right: "6%",  cls: "lp-drift-1", delay: "0s" },
  { label: "YouTube",  top: "58%",  right: "3%",  cls: "lp-drift-2", delay: "2.5s" },
  { label: "Reddit",   bottom: "20%", right: "12%", cls: "lp-drift-3", delay: "1s" },
  { label: "Readwise", bottom: "28%", left: "3%",  cls: "lp-drift-2", delay: "3.5s" },
  { label: "HN",       top: "32%",  left: "2%",   cls: "lp-drift-1", delay: "1.8s" },
  { label: "RSS",      bottom: "8%", right: "38%", cls: "lp-drift-3", delay: "4s" },
];

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c3.42-3.15 5.372-7.79 5.372-13.276z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

function useTypewriter(text: string, speed = 22) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    if (!text) { setDisplayed(""); return; }
    setDisplayed("");
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return displayed;
}

function BriefingPreview() {
  const [itemIndex, setItemIndex] = useState(0);
  const [phase, setPhase] = useState<"sources" | "briefing">("sources");
  const [sourceCounts, setSourceCounts] = useState([0, 0, 0, 0]);

  const item = SAMPLE_ITEMS[itemIndex];
  const displayedWhy = useTypewriter(phase === "briefing" ? item.why : "");

  useEffect(() => {
    const delays = [300, 700, 1100, 1500];
    const timers = SOURCES.map((_, i) =>
      setTimeout(() => {
        setSourceCounts(prev => {
          const next = [...prev];
          next[i] = SOURCES[i].count;
          return next;
        });
      }, delays[i])
    );
    const phaseTimer = setTimeout(() => setPhase("briefing"), 2400);
    return () => { timers.forEach(clearTimeout); clearTimeout(phaseTimer); };
  }, [itemIndex]);

  useEffect(() => {
    const id = setInterval(() => {
      setItemIndex(i => (i + 1) % SAMPLE_ITEMS.length);
      setPhase("sources");
      setSourceCounts([0, 0, 0, 0]);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="lp-preview">
      <div className="lp-preview-header">
        <div className="lp-preview-live">
          <span className="lp-live-dot" />
          <span className="lp-live-label">Today&apos;s briefing</span>
        </div>
        <span className="lp-preview-time">7:02 AM ☀️</span>
      </div>

      <div className="lp-preview-sources">
        {SOURCES.map((src, i) => (
          <div key={src.name} className="lp-source-row">
            <span className="lp-source-icon">{src.icon}</span>
            <span className="lp-source-name">{src.name}</span>
            <div className="lp-source-bar-wrap">
              <motion.div
                className="lp-source-bar"
                initial={{ width: "0%" }}
                animate={{ width: sourceCounts[i] > 0 ? `${(sourceCounts[i] / 22) * 100}%` : "0%" }}
                transition={{ duration: 0.6, ease: EASE }}
              />
            </div>
            <motion.span
              className="lp-source-count"
              initial={{ opacity: 0 }}
              animate={{ opacity: sourceCounts[i] > 0 ? 1 : 0 }}
              transition={{ duration: 0.3 }}
            >
              {sourceCounts[i]}
            </motion.span>
          </div>
        ))}
      </div>

      {/* Fixed-height slot so the card never resizes as content changes */}
      <div className="lp-preview-slot">
        <AnimatePresence mode="wait">
          {phase === "briefing" ? (
            <motion.div
              key={`item-${itemIndex}`}
              className="lp-preview-item"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: EASE }}
            >
              <div className="lp-item-meta">
                <span className="lp-item-source">{item.source}</span>
                <span className="lp-item-tag">{item.tag}</span>
                <span className="lp-item-time">{item.time}</span>
              </div>
              <p className="lp-item-headline">{item.headline}</p>
              <div className="lp-item-why">
                <span className="lp-why-label">why this</span>
                <p className="lp-why-text">
                  {displayedWhy}
                  <span className="lp-cursor" />
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="loading"
              className="lp-preview-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <span className="lp-loading-text">Reading your feeds…</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="lp-preview-footer">
        <span className="lp-footer-stat">60 items read</span>
        <span className="lp-footer-dot">·</span>
        <span className="lp-footer-stat">10 selected for you</span>
        <span className="lp-footer-dot">·</span>
        <span className="lp-footer-stat lp-footer-accent">~4 min read</span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) { setChecking(false); return; }
    api.getMe()
      .then((me) => {
        if (me.onboarding_completed) {
          // Returning user — take them straight to their digest feed
          router.replace("/dashboard");
        } else {
          // Has a token but hasn't finished setup — show the sign-in page so
          // they can re-authenticate and proceed through onboarding normally
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router]);

  return (
    <div className="login-shell">

      {/* ── Left panel ── */}
      <div className="login-left">
        <div className="login-blob login-blob-1" aria-hidden />
        <div className="login-blob login-blob-2" aria-hidden />

        {/* Floating ambient source badges */}
        {FLOAT_BADGES.map((b) => (
          <div
            key={b.label}
            className={`lp-float-badge ${b.cls}`}
            style={{
              top: b.top,
              bottom: b.bottom,
              left: b.left,
              right: b.right,
              animationDelay: b.delay,
            } as React.CSSProperties}
            aria-hidden
          >
            {b.label}
          </div>
        ))}

        <div className="login-left-inner">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05, ease: EASE }}
          >
            <Link href="/" className="login-brand">Briefly</Link>
          </motion.div>

          <motion.div
            className="login-pitch"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
          >
            <h1 className="login-headline">
              Read less.<br />
              <span className="login-headline-accent">Know more.</span>
            </h1>
            <p className="login-pitch-sub">
              Briefly reads everything you follow — newsletters, YouTube, Reddit, RSS —
              and delivers one sharp, personalised briefing every morning.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.38, ease: EASE }}
          >
            <BriefingPreview />
          </motion.div>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="login-right">
        {checking ? (
          <div className="login-card" style={{ gap: 16 }}>
            <span className="btn-spinner" style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--accent)" }} />
            <p className="auth-loading">Signing you in…</p>
          </div>
        ) : (
          <motion.div
            className="login-card"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1, ease: EASE }}
          >
            <div className="login-card-head">
              <TimeGreetingBadge />
              <h2 className="login-card-title">
                <TimeGreetingCardTitle />
              </h2>
              <p className="login-card-sub">Your personalised briefing, delivered when you need it.</p>
            </div>

            <div className="lp-perks">
              {[
                { icon: "⚡", text: "Connects to Gmail, YouTube, Reddit & more" },
                { icon: "🧠", text: "Learns what you actually care about" },
                { icon: "📬", text: "One briefing. Inbox. Every morning." },
              ].map((p) => (
                <div key={p.text} className="lp-perk">
                  <span className="lp-perk-icon">{p.icon}</span>
                  <span className="lp-perk-text">{p.text}</span>
                </div>
              ))}
            </div>

            <motion.a
              href={googleLoginUrl()}
              className="login-google-btn"
              whileHover={{ scale: 1.015, boxShadow: "0 6px 20px rgba(28,24,18,0.12)" }}
              whileTap={{ scale: 0.985 }}
            >
              <GoogleIcon />
              Continue with Google
            </motion.a>

            <p className="login-card-footnote">
              By continuing you agree to our{" "}
              <Link href="/terms" className="login-card-link">terms</Link>
              {" "}and{" "}
              <Link href="/privacy" className="login-card-link">privacy policy</Link>.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
