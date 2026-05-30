"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { getToken, googleLoginUrl } from "@/lib/auth";
import { api } from "@/lib/api";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

const FEATURES = [
  "Connect Gmail, YouTube, Reddit once",
  "Reads 50 items · Shows the 10 that matter",
  "Cited, personal, in your inbox every morning",
];

const SOCIAL_PROOF = [
  { quote: "This replaced my entire morning reading routine.", name: "Founder, seed-stage startup" },
  { quote: "I get the same signal in 4 minutes that used to take 45.", name: "Product lead, B2B SaaS" },
  { quote: "It actually understands what I care about.", name: "Engineer & indie hacker" },
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

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [quoteIndex] = useState(() => Math.floor(Math.random() * SOCIAL_PROOF.length));

  useEffect(() => {
    const token = getToken();
    if (!token) { setChecking(false); return; }
    api.getMe()
      .then((me) => router.replace(me.onboarding_completed ? "/dashboard" : "/onboarding"))
      .catch(() => setChecking(false));
  }, [router]);

  const quote = SOCIAL_PROOF[quoteIndex];

  return (
    <div className="login-shell">

      {/* ── Left panel ── */}
      <div className="login-left">
        {/* Animated ambient blobs */}
        <div className="login-blob login-blob-1" aria-hidden />
        <div className="login-blob login-blob-2" aria-hidden />
        <div className="login-blob login-blob-3" aria-hidden />

        <div className="login-left-inner">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05, ease: EASE }}
          >
            <Link href="/" className="login-brand">Briefly</Link>
          </motion.div>

          <div className="login-pitch">
            <motion.h1
              className="login-headline"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
            >
              Read less.<br />
              <span className="login-headline-accent">Know more.</span>
            </motion.h1>
            <motion.p
              className="login-pitch-sub"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3, ease: EASE }}
            >
              Briefly reads everything you follow — newsletters, YouTube, Reddit, RSS —
              and delivers one sharp, personalised briefing every morning.
              Nothing to manage. Forever.
            </motion.p>
          </div>

          <motion.ul
            className="login-features"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.1, delayChildren: 0.45 } } }}
          >
            {FEATURES.map((text) => (
              <motion.li
                key={text}
                className="login-feature-item"
                variants={{
                  hidden: { opacity: 0, x: -12 },
                  visible: { opacity: 1, x: 0, transition: { duration: 0.5, ease: EASE } },
                }}
              >
                <span className="login-feature-icon">→</span>
                <span>{text}</span>
              </motion.li>
            ))}
          </motion.ul>

          {!checking && (
            <motion.div
              className="login-quote"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.85, ease: EASE }}
            >
              {/* Continuous gentle float */}
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              >
                <p className="login-quote-text">&ldquo;{quote.quote}&rdquo;</p>
                <p className="login-quote-attr">— {quote.name}</p>
              </motion.div>
            </motion.div>
          )}
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
              <h2 className="login-card-title">Welcome to Briefly</h2>
              <p className="login-card-sub">Sign in to start your morning briefing</p>
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
