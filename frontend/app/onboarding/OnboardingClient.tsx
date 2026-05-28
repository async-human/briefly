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

function YouTubeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden fill="none">
      <rect width="24" height="24" rx="5" fill="#FF0000" />
      <polygon points="9.5,7.5 16.5,12 9.5,16.5" fill="#fff" />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#FF4500" />
      <path fill="#fff" d="M20 12a2 2 0 0 0-2-2 2 2 0 0 0-1.3.5C15.4 9.7 14 9.2 12.4 9l.8-3.6 2.4.5a1.4 1.4 0 1 0 .1-.7l-2.7-.6L12 8.9c-1.7.1-3.2.6-4.4 1.5A2 2 0 0 0 4 12a2 2 0 0 0 1 1.7 3.5 3.5 0 0 0 0 .5c0 2.5 2.7 4.5 6 4.5s6-2 6-4.5a3.5 3.5 0 0 0 0-.5A2 2 0 0 0 20 12zm-10 2a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm4.5 2.5c-.7.7-2 .7-2.5.7s-1.8 0-2.5-.7a.3.3 0 0 1 .4-.4c.5.5 1.5.6 2.1.6s1.6-.1 2.1-.6a.3.3 0 0 1 .4.4zm-.5-1.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
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
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [redditLoading, setRedditLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");

  useEffect(() => {
    api.getOnboardingStatus()
      .then((s) => {
        setStatus(s);
        // Returning users land on step 2 (connection management) so they
        // can review/update connected accounts before heading to dashboard.
        if (s.onboarding_completed || s.profile_started) setStep(2);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load onboarding"))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    const gmail = searchParams.get("gmail");
    const youtube = searchParams.get("youtube");
    const reddit = searchParams.get("reddit");

    if (gmail === "connected") {
      setBanner("Gmail connected — your newsletters are now in the pipeline.");
      api.getOnboardingStatus().then(setStatus);
    } else if (gmail === "denied") {
      setError("Google blocked Gmail access. Add your email as a test user in Google Cloud Console (OAuth consent screen → Test users), then try again.");
    } else if (gmail === "error") {
      setError("Gmail connection was cancelled or failed. Please try again.");
    }

    if (youtube === "connected") {
      const channels = searchParams.get("channels");
      setBanner(channels ? `YouTube connected — found ${channels} subscribed channels.` : "YouTube connected.");
      api.getOnboardingStatus().then(setStatus);
    } else if (youtube === "denied") {
      setError("YouTube access was denied. Please try again.");
    } else if (youtube === "error") {
      setError("YouTube connection failed. Please try again.");
    }

    if (reddit === "connected") {
      const subs = searchParams.get("subreddits");
      setBanner(subs ? `Reddit connected — found ${subs} subscribed subreddits.` : "Reddit connected.");
      api.getOnboardingStatus().then(setStatus);
    } else if (reddit === "denied") {
      setError("Reddit access was denied. Please try again.");
    } else if (reddit === "error") {
      setError("Reddit connection failed. Please try again.");
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

  async function handleDisconnectGmail() {
    setError("");
    try {
      await api.disconnectGmail();
      const updated = await api.getOnboardingStatus();
      setStatus(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect Gmail");
    }
  }

  async function handleConnectYouTube() {
    setYoutubeLoading(true);
    setError("");
    try {
      const { url } = await api.startYouTubeConnect("/onboarding");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start YouTube connection");
      setYoutubeLoading(false);
    }
  }

  async function handleDisconnectYouTube() {
    setError("");
    try {
      await api.disconnectYouTube();
      const updated = await api.getOnboardingStatus();
      setStatus(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect YouTube");
    }
  }

  async function handleConnectReddit() {
    setRedditLoading(true);
    setError("");
    try {
      const { url } = await api.startRedditConnect("/onboarding");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Reddit connection");
      setRedditLoading(false);
    }
  }

  async function handleDisconnectReddit() {
    setError("");
    try {
      await api.disconnectReddit();
      const updated = await api.getOnboardingStatus();
      setStatus(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect Reddit");
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
    status?.gmail_connected ||
    status?.youtube_connected ||
    status?.reddit_connected ||
    (status?.sources_count ?? 0) > 0;

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
                <h1 className="onboard-title">Connect your accounts</h1>
                <p className="onboard-desc">
                  Connect once — Briefly reads everything you already follow so you don&apos;t have to rebuild your reading list.
                </p>
              </header>

              {banner && (
                <div className="onboard-banner onboard-banner-success">{banner}</div>
              )}

              {/* Gmail */}
              <article className={`onboard-gmail-feature ${status?.gmail_connected ? "connected" : ""}`}>
                <div className="onboard-gmail-top">
                  <div className="onboard-gmail-brand">
                    <span className="onboard-gmail-icon-wrap"><GmailIcon /></span>
                    <div>
                      <h2 className="onboard-gmail-title">Gmail</h2>
                      <p className="onboard-gmail-sub">All your newsletters, automatically</p>
                    </div>
                  </div>
                  {status?.gmail_connected && (
                    <span className="onboard-badge-connected"><CheckIcon /> Connected</span>
                  )}
                </div>
                <p className="onboard-disclaimer">
                  We only read newsletter-like emails — never personal or work mail. Disconnect anytime.
                </p>
                {status?.gmail_connected ? (
                  <div className="onboard-gmail-result">
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                      <span className="onboard-gmail-email">{status.gmail_email}</span>
                      {status.newsletter_count != null && (
                        <span className="onboard-gmail-stat">{status.newsletter_count}+ newsletters found</span>
                      )}
                    </div>
                    <button type="button" className="onboard-disconnect-btn" onClick={handleDisconnectGmail}>
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button type="button" className="onboard-gmail-connect" onClick={handleConnectGmail} disabled={gmailLoading}>
                    {gmailLoading ? <><span className="btn-spinner btn-spinner-dark" />Redirecting…</> : <><GmailIcon />Connect Gmail</>}
                  </button>
                )}
              </article>

              {/* YouTube */}
              <article className={`onboard-gmail-feature ${status?.youtube_connected ? "connected" : ""}`} style={{ marginTop: "16px" }}>
                <div className="onboard-gmail-top">
                  <div className="onboard-gmail-brand">
                    <span className="onboard-gmail-icon-wrap"><YouTubeIcon /></span>
                    <div>
                      <h2 className="onboard-gmail-title">YouTube</h2>
                      <p className="onboard-gmail-sub">
                        {status?.youtube_connected && status.youtube_channel_count
                          ? `${status.youtube_channel_count} subscribed channels`
                          : "All channels you subscribe to"}
                      </p>
                    </div>
                  </div>
                  {status?.youtube_connected && (
                    <span className="onboard-badge-connected"><CheckIcon /> Connected</span>
                  )}
                </div>
                <p className="onboard-disclaimer">
                  We fetch recent videos from your subscriptions and surface the most relevant ones in your digest.
                </p>
                {status?.youtube_connected ? (
                  <div className="onboard-gmail-result">
                    {status.youtube_channel_count != null && (
                      <span className="onboard-gmail-stat">{status.youtube_channel_count} channels tracked</span>
                    )}
                    <button type="button" className="onboard-disconnect-btn" onClick={handleDisconnectYouTube}>
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button type="button" className="onboard-gmail-connect" onClick={handleConnectYouTube} disabled={youtubeLoading}>
                    {youtubeLoading ? <><span className="btn-spinner btn-spinner-dark" />Redirecting…</> : <><YouTubeIcon />Connect YouTube</>}
                  </button>
                )}
              </article>

              {/* Reddit */}
              <article className={`onboard-gmail-feature ${status?.reddit_connected ? "connected" : ""}`} style={{ marginTop: "16px" }}>
                <div className="onboard-gmail-top">
                  <div className="onboard-gmail-brand">
                    <span className="onboard-gmail-icon-wrap"><RedditIcon /></span>
                    <div>
                      <h2 className="onboard-gmail-title">Reddit</h2>
                      <p className="onboard-gmail-sub">
                        {status?.reddit_connected && status.reddit_subreddit_count
                          ? `${status.reddit_subreddit_count} subscribed subreddits`
                          : "All subreddits you subscribe to"}
                      </p>
                    </div>
                  </div>
                  {status?.reddit_connected && (
                    <span className="onboard-badge-connected"><CheckIcon /> Connected</span>
                  )}
                </div>
                <p className="onboard-disclaimer">
                  We pull hot posts from your subscribed subreddits — no manual subreddit entry needed.
                </p>
                {status?.reddit_connected ? (
                  <div className="onboard-gmail-result">
                    {status.reddit_subreddit_count != null && (
                      <span className="onboard-gmail-stat">{status.reddit_subreddit_count} subreddits tracked</span>
                    )}
                    <button type="button" className="onboard-disconnect-btn" onClick={handleDisconnectReddit}>
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button type="button" className="onboard-gmail-connect" onClick={handleConnectReddit} disabled={redditLoading}>
                    {redditLoading ? <><span className="btn-spinner btn-spinner-dark" />Redirecting…</> : <><RedditIcon />Connect Reddit</>}
                  </button>
                )}
              </article>

              {/* RSS / URL fallback */}
              <div className="onboard-secondary" style={{ marginTop: "24px" }}>
                <div className="onboard-secondary-card">
                  <div className="onboard-secondary-head">
                    <span className="onboard-secondary-icon">RSS</span>
                    <div>
                      <h3>Add any URL</h3>
                      <p>Blogs, news sites, RSS feeds, or any website</p>
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
                  onClick={() => status?.onboarding_completed ? router.replace("/dashboard") : setStep(3)}
                  disabled={!canContinueStep2}
                >
                  {status?.onboarding_completed ? "Go to dashboard" : "Continue"}
                </button>
                {!canContinueStep2 && (
                  <p className="onboard-hint">Connect at least one account or add a source.</p>
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
