"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, googleLoginUrl } from "@/lib/auth";
import { api } from "@/lib/api";

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
      .then((me) => { router.replace(me.onboarding_completed ? "/dashboard" : "/onboarding"); })
      .catch(() => setChecking(false));
  }, [router]);

  const quote = SOCIAL_PROOF[quoteIndex];

  return (
    <div className="login-shell">

      {/* ── Left panel — branding + value props ── */}
      <div className="login-left">
        <div className="login-left-inner">
          <Link href="/" className="login-brand">Briefly</Link>

          <div className="login-pitch">
            <h1 className="login-headline">
              Read less.<br />
              <span className="login-headline-accent">Know more.</span>
            </h1>
            <p className="login-pitch-sub">
              Briefly reads everything you follow — newsletters, YouTube, Reddit, RSS —
              and delivers one sharp, personalised briefing every morning. Nothing to manage. Forever.
            </p>
          </div>

          <ul className="login-features">
            {[
              { icon: "→", text: "Connect Gmail, YouTube, Reddit once" },
              { icon: "→", text: "Reads 50 items · Shows the 10 that matter to you" },
              { icon: "→", text: "Cited, personal, in your inbox at 7 am" },
            ].map(({ icon, text }) => (
              <li key={text} className="login-feature-item">
                <span className="login-feature-icon">{icon}</span>
                <span>{text}</span>
              </li>
            ))}
          </ul>

          {checking ? null : (
            <div className="login-quote">
              <p className="login-quote-text">&ldquo;{quote.quote}&rdquo;</p>
              <p className="login-quote-attr">— {quote.name}</p>
            </div>
          )}
        </div>

        {/* Decorative ambient glow */}
        <div className="login-left-glow" aria-hidden />
      </div>

      {/* ── Right panel — sign-in card ── */}
      <div className="login-right">
        {checking ? (
          <div className="login-card">
            <span className="btn-spinner" style={{ borderColor: "var(--border-strong)", borderTopColor: "var(--accent)" }} />
            <p className="auth-loading">Signing you in…</p>
          </div>
        ) : (
          <div className="login-card">
            <div className="login-card-head">
              <h2 className="login-card-title">Welcome to Briefly</h2>
              <p className="login-card-sub">Sign in to start your morning briefing</p>
            </div>

            <a href={googleLoginUrl()} className="login-google-btn">
              <GoogleIcon />
              Continue with Google
            </a>

            <p className="login-card-footnote">
              By continuing you agree to our{" "}
              <Link href="/terms" className="login-card-link">terms</Link>
              {" "}and{" "}
              <Link href="/privacy" className="login-card-link">privacy policy</Link>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
