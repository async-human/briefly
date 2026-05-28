"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, type OnboardingStatus } from "@/lib/api";
import { AddSourceForm } from "@/components/dashboard/AddSourceForm";

const ROLES = ["Founder", "Product manager", "Engineer", "Investor", "Researcher", "Other"];

const STEPS = [
  { n: 1, label: "About you" },
  { n: 2, label: "Sources" },
  { n: 3, label: "Delivery" },
];

function GmailIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <path fill="#EA4335" d="M24 5.5v13c0 .85-.65 1.5-1.5 1.5H1.5C.65 20 0 19.35 0 18.5v-13C0 4.65.65 4 1.5 4h21c.85 0 1.5.65 1.5 1.5z" />
      <path fill="#FBBC05" d="M0 4l12 9.5L24 4" />
      <path fill="#34A853" d="M0 18.5V4l12 9.5L0 18.5z" opacity="0.8" />
      <path fill="#4285F4" d="M24 4v14.5L12 13.5 24 4z" opacity="0.9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="8" fill="rgba(106,171,138,0.15)" />
      <path d="M5 8l2 2 4-4" stroke="#6aab8a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(1);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [role, setRole] = useState("");
  const [goal, setGoal] = useState("");
  const [digestTime, setDigestTime] = useState("07:00");
  const [loading, setLoading] = useState(true);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");
  const [gmailBanner, setGmailBanner] = useState("");

  useEffect(() => {
    api.getOnboardingStatus()
      .then((s) => {
        setStatus(s);
        if (s.onboarding_completed) {
          router.replace("/dashboard");
          return;
        }
        if (s.profile_started) setStep(2);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load onboarding"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const gmail = searchParams.get("gmail");
    if (gmail === "connected") {
      setGmailBanner("Gmail connected — scanning your newsletters…");
      api.getOnboardingStatus().then(setStatus);
    }
    if (gmail === "denied") {
      setError(
        "Google blocked Gmail access. Add your email as a test user in Google Cloud Console " +
          "(OAuth consent screen → Test users), then try again with the same Google account.",
      );
    }
    if (gmail === "error") {
      setError("Gmail connection was cancelled or failed. Please try again.");
    }
  }, [searchParams]);

  async function handleConnectGmail() {
    setGmailLoading(true);
    setError("");
    try {
      const { url } = await api.startGmailConnect("/onboarding");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Gmail connection");
      setGmailLoading(false);
    }
  }

  async function handleSaveProfile() {
    setError("");
    try {
      const updated = await api.updateOnboardingProfile({
        role: role || undefined,
        goal: goal || undefined,
      });
      setStatus(updated);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    }
  }

  async function handleAddHackerNews() {
    setError("");
    try {
      await api.addSource({ identifier: "https://hnrss.org/frontpage", name: "Hacker News" });
      const updated = await api.getOnboardingStatus();
      setStatus(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add Hacker News");
    }
  }

  async function handleFinish() {
    setFinishing(true);
    setError("");
    try {
      await api.updateOnboardingProfile({
        digest_time: digestTime,
        digest_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await api.completeOnboarding();
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finish onboarding");
      setFinishing(false);
    }
  }

  const canContinueStep2 =
    status?.gmail_connected || (status?.sources_count ?? 0) > 0;

  if (loading) {
    return (
      <div className="onboard-shell">
        <div className="onboard-loading">
          <span className="btn-spinner" />
          <p>Setting up your briefing…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard-shell">
      <div className="onboard-glow" aria-hidden />

      <header className="onboard-header">
        <Link href="/" className="onboard-logo">Briefly</Link>
        <span className="onboard-step-counter">{step} / {STEPS.length}</span>
      </header>

      <div className="onboard-progress-bar" aria-label={`Step ${step} of ${STEPS.length}`}>
        {STEPS.map(({ n, label }) => (
          <button
            key={n}
            type="button"
            className={`onboard-progress-segment ${step >= n ? "done" : ""} ${step === n ? "current" : ""}`}
            onClick={() => n < step && setStep(n)}
            disabled={n > step}
            aria-label={label}
            aria-current={step === n ? "step" : undefined}
          />
        ))}
      </div>

      <main className="onboard-main">
        <div key={step} className="onboard-panel-wrap">
          {step === 1 && (
            <section className="onboard-panel">
              <header className="onboard-panel-head">
                <p className="onboard-eyebrow">Step 1 of 3</p>
                <h1 className="onboard-title">Tell us about yourself</h1>
                <p className="onboard-desc">
                  Briefly uses this to decide what&apos;s worth your attention each morning.
                </p>
              </header>

              <div className="onboard-fields">
                <div className="onboard-field">
                  <span className="onboard-field-label">What best describes you?</span>
                  <div className="onboard-role-grid">
                    {ROLES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`onboard-role-pill ${role === r ? "selected" : ""}`}
                        onClick={() => setRole(r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="onboard-field">
                  <span className="onboard-field-label">What are you trying to stay on top of?</span>
                  <textarea
                    className="onboard-input onboard-textarea"
                    placeholder="e.g. AI agents, startup funding, product design"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    rows={3}
                  />
                </label>
              </div>

              <div className="onboard-actions">
                <button type="button" className="btn-primary onboard-cta" onClick={handleSaveProfile}>
                  Continue
                </button>
                <button type="button" className="onboard-ghost" onClick={() => setStep(2)}>
                  Skip for now
                </button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="onboard-panel onboard-panel-wide">
              <header className="onboard-panel-head">
                <p className="onboard-eyebrow">Step 2 of 3</p>
                <h1 className="onboard-title">Connect your sources</h1>
                <p className="onboard-desc">
                  One click for Gmail. Paste a URL for anything else.
                </p>
              </header>

              {gmailBanner && (
                <div className="onboard-banner onboard-banner-success">{gmailBanner}</div>
              )}

              <article className={`onboard-gmail-feature ${status?.gmail_connected ? "connected" : ""}`}>
                <div className="onboard-gmail-top">
                  <div className="onboard-gmail-brand">
                    <span className="onboard-gmail-icon-wrap"><GmailIcon /></span>
                    <div>
                      <h2 className="onboard-gmail-title">Gmail</h2>
                      <p className="onboard-gmail-sub">Newsletters found automatically</p>
                    </div>
                  </div>
                  {status?.gmail_connected && (
                    <span className="onboard-badge-connected">
                      <CheckIcon /> Connected
                    </span>
                  )}
                </div>

                <p className="onboard-disclaimer">
                  We only read newsletter-like emails from Substack, Beehiiv, and similar
                  senders — never personal or work mail. Content is extracted, not stored.
                  Disconnect anytime.
                </p>

                {status?.gmail_connected ? (
                  <div className="onboard-gmail-result">
                    <span className="onboard-gmail-email">{status.gmail_email}</span>
                    {status.newsletter_count != null && (
                      <span className="onboard-gmail-stat">
                        {status.newsletter_count}+ newsletters found
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="onboard-gmail-connect"
                    onClick={handleConnectGmail}
                    disabled={gmailLoading}
                  >
                    {gmailLoading ? (
                      <>
                        <span className="btn-spinner btn-spinner-dark" />
                        Redirecting to Google…
                      </>
                    ) : (
                      <>
                        <GmailIcon />
                        Connect Gmail
                      </>
                    )}
                  </button>
                )}
              </article>

              <div className="onboard-secondary">
                <div className="onboard-secondary-card">
                  <div className="onboard-secondary-head">
                    <span className="onboard-secondary-icon">URL</span>
                    <div>
                      <h3>Paste a URL</h3>
                      <p>RSS, YouTube, Reddit, or any site</p>
                    </div>
                  </div>
                  <div className="onboard-add-form">
                    <AddSourceForm onAdded={() => api.getOnboardingStatus().then(setStatus)} />
                  </div>
                </div>

                <div className="onboard-secondary-card">
                  <div className="onboard-secondary-head">
                    <span className="onboard-secondary-icon">HN</span>
                    <div>
                      <h3>Quick add</h3>
                      <p>Popular sources, one tap</p>
                    </div>
                  </div>
                  <button type="button" className="onboard-chip-btn" onClick={handleAddHackerNews}>
                    Hacker News
                  </button>
                  {(status?.sources_count ?? 0) > 0 && (
                    <p className="onboard-source-count">
                      {status?.sources_count} source{(status?.sources_count ?? 0) === 1 ? "" : "s"} connected
                    </p>
                  )}
                </div>
              </div>

              <div className="onboard-actions">
                <button
                  type="button"
                  className="btn-primary onboard-cta"
                  onClick={() => setStep(3)}
                  disabled={!canContinueStep2}
                >
                  Continue
                </button>
                {!canContinueStep2 && (
                  <p className="onboard-hint">Connect Gmail or add at least one source.</p>
                )}
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="onboard-panel">
              <header className="onboard-panel-head">
                <p className="onboard-eyebrow">Step 3 of 3</p>
                <h1 className="onboard-title">When should we deliver?</h1>
                <p className="onboard-desc">
                  Your first briefing is ready to generate from the dashboard.
                  Automatic morning delivery comes with the nightly pipeline.
                </p>
              </header>

              <div className="onboard-time-card">
                <label className="onboard-field">
                  <span className="onboard-field-label">Local delivery time</span>
                  <input
                    type="time"
                    className="onboard-input onboard-time-input"
                    value={digestTime}
                    onChange={(e) => setDigestTime(e.target.value)}
                  />
                </label>
                <p className="onboard-time-note">
                  Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </p>
              </div>

              <div className="onboard-actions">
                <button
                  type="button"
                  className="btn-primary onboard-cta"
                  onClick={handleFinish}
                  disabled={finishing}
                >
                  {finishing ? "Finishing…" : "Go to dashboard"}
                </button>
              </div>
            </section>
          )}
        </div>

        {error && (
          <div className="onboard-banner onboard-banner-error" role="alert">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
