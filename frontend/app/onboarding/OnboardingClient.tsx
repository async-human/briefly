"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, type OnboardingStatus } from "@/lib/api";
import { AddSourceForm } from "@/components/dashboard/AddSourceForm";

const ROLES = ["Founder", "Product manager", "Engineer", "Investor", "Researcher", "Other"];

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

  if (loading) {
    return (
      <div className="onboard-shell">
        <p className="auth-loading">Loading…</p>
      </div>
    );
  }

  return (
    <div className="onboard-shell">
      <header className="onboard-header">
        <Link href="/" className="onboard-logo">Briefly</Link>
        <div className="onboard-steps">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`onboard-step-dot ${step >= n ? "active" : ""}`} />
          ))}
        </div>
      </header>

      <main className="onboard-main">
        {step === 1 && (
          <section className="onboard-panel">
            <p className="onboard-label">Step 1 of 3</p>
            <h1 className="onboard-title">Tell us about yourself</h1>
            <p className="onboard-desc">This helps Briefly personalize what matters to you.</p>

            <label className="field-label">
              What best describes you?
              <select className="field-input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Select one</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>

            <label className="field-label">
              What are you trying to stay on top of?
              <textarea
                className="field-input onboard-textarea"
                placeholder="e.g. AI agents, startup funding, product design"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
              />
            </label>

            <button type="button" className="btn-primary onboard-cta" onClick={handleSaveProfile}>
              Continue
            </button>
            <button type="button" className="onboard-skip" onClick={() => setStep(2)}>
              Skip for now
            </button>
          </section>
        )}

        {step === 2 && (
          <section className="onboard-panel onboard-panel-wide">
            <p className="onboard-label">Step 2 of 3</p>
            <h1 className="onboard-title">Connect your sources</h1>
            <p className="onboard-desc">One click for Gmail. Paste anything else.</p>

            {gmailBanner && <p className="onboard-success">{gmailBanner}</p>}

            <div className="onboard-gmail-card">
              <div className="onboard-gmail-head">
                <span className="onboard-gmail-icon">📧</span>
                <div>
                  <h2 className="onboard-gmail-title">Gmail</h2>
                  <p className="onboard-gmail-sub">Find newsletters automatically — no forwarding setup</p>
                </div>
              </div>

              <blockquote className="onboard-disclaimer">
                Briefly connects to Gmail to find your newsletters — emails from Substack,
                Beehiiv, and similar platforms. We only read newsletter-like emails, never
                personal messages or work mail. We extract content and don&apos;t store raw
                emails. Disconnect anytime to delete access.
              </blockquote>

              {status?.gmail_connected ? (
                <div className="onboard-gmail-connected">
                  <span>Connected as {status.gmail_email}</span>
                  {status.newsletter_count != null && (
                    <strong>Found {status.newsletter_count}+ newsletters</strong>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-primary onboard-gmail-btn"
                  onClick={handleConnectGmail}
                  disabled={gmailLoading}
                >
                  {gmailLoading ? "Redirecting to Google…" : "Connect Gmail"}
                </button>
              )}
            </div>

            <div className="onboard-source-grid">
              <div className="onboard-source-card">
                <h3>RSS / Blogs / Substack</h3>
                <p>Paste any feed or site URL</p>
                <AddSourceForm onAdded={() => api.getOnboardingStatus().then(setStatus)} />
              </div>
              <div className="onboard-source-card">
                <h3>Quick adds</h3>
                <p>Popular sources in one click</p>
                <button type="button" className="onboard-quick-btn" onClick={handleAddHackerNews}>
                  + Hacker News
                </button>
              </div>
            </div>

            <button
              type="button"
              className="btn-primary onboard-cta"
              onClick={() => setStep(3)}
              disabled={!status?.gmail_connected && (status?.sources_count ?? 0) === 0}
            >
              Continue
            </button>
            {(status?.sources_count ?? 0) === 0 && !status?.gmail_connected && (
              <p className="field-hint">Connect Gmail or add at least one source to continue.</p>
            )}
          </section>
        )}

        {step === 3 && (
          <section className="onboard-panel">
            <p className="onboard-label">Step 3 of 3</p>
            <h1 className="onboard-title">When should we deliver?</h1>
            <p className="onboard-desc">
              Your first briefing is ready — generate it from the dashboard, or we&apos;ll
              deliver automatically once the nightly pipeline is live.
            </p>

            <label className="field-label">
              Delivery time
              <input
                type="time"
                className="field-input"
                value={digestTime}
                onChange={(e) => setDigestTime(e.target.value)}
              />
            </label>

            <button
              type="button"
              className="btn-primary onboard-cta"
              onClick={handleFinish}
              disabled={finishing}
            >
              {finishing ? "Finishing…" : "Go to dashboard"}
            </button>
          </section>
        )}

        {error && <p className="form-error onboard-error">{error}</p>}
      </main>
    </div>
  );
}
