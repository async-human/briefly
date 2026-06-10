"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { api, type OnboardingStatus, type MeResponse } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { BrieflyLogo } from "@/components/BrieflyLogo";
import { AddSourceForm } from "@/components/dashboard/AddSourceForm";

const ROLES = ["Founder", "Product manager", "Engineer", "Investor", "Researcher", "Other"];

// Three visible steps — time picker is merged into the Done screen
const STEPS = [
  { n: 1, label: "About you" },
  { n: 2, label: "Sources" },
  { n: 3, label: "Done" },
];

const TOPIC_SUGGESTIONS: Record<string, string[]> = {
  Founder:           ["product-market fit", "startup funding", "hiring", "growth metrics", "AI tools"],
  "Product manager": ["product strategy", "user research", "roadmapping", "AI/ML", "growth"],
  Engineer:          ["system design", "AI/ML", "developer tools", "open source", "security"],
  Investor:          ["deal flow", "market trends", "valuations", "exits", "emerging tech"],
  Researcher:        ["academic papers", "methodology", "data science", "policy", "emerging tech"],
  Other:             ["technology", "business", "science", "design", "policy"],
};
const DEFAULT_TOPICS = ["AI agents", "startups", "technology", "design", "science"];

function TagInput({
  label,
  hint,
  placeholder,
  tags,
  onChange,
  suggestions = [],
}: {
  label: string;
  hint?: string;
  placeholder: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}) {
  const [inputValue, setInputValue] = useState("");

  function add(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/,+$/, "");
    if (tag && !tags.includes(tag) && tags.length < 12) onChange([...tags, tag]);
    setInputValue("");
  }

  function remove(tag: string) { onChange(tags.filter((t) => t !== tag)); }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (inputValue) add(inputValue); }
    if (e.key === "Backspace" && !inputValue && tags.length > 0) remove(tags[tags.length - 1]);
  }

  const unused = suggestions.filter((s) => !tags.includes(s)).slice(0, 5);

  return (
    <div className="onboard-field">
      <span className="onboard-field-label">{label}</span>
      {hint && <p className="onboard-field-hint">{hint}</p>}
      <div className="tag-input-wrap">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            <button type="button" onClick={() => remove(tag)} aria-label={`Remove ${tag}`}>×</button>
          </span>
        ))}
        <input
          type="text"
          className="tag-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (inputValue) add(inputValue); }}
          placeholder={tags.length === 0 ? placeholder : ""}
        />
      </div>
      {unused.length > 0 && (
        <div className="tag-suggestions">
          {unused.map((s) => (
            <button key={s} type="button" className="tag-suggestion" onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [topics, setTopics] = useState<string[]>([]);
  const [digestTime, setDigestTime] = useState("07:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [redditLoading, setRedditLoading] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => {
    Promise.all([api.getOnboardingStatus(), api.getMe()])
      .then(([s, meData]) => {
        // Completed users should be on the dashboard, not onboarding
        if (s.onboarding_completed) {
          router.replace("/dashboard");
          return;
        }
        setStatus(s);
        setMe(meData);
        // Pre-fill saved values so returning mid-flow users don't start blank
        if (meData.profile) {
          if (meData.profile.role) setRole(meData.profile.role);
          if (meData.profile.goal) setGoal(meData.profile.goal);
          if (meData.profile.interests?.length)
            setTopics(meData.profile.interests.map((i) => i.topic).filter(Boolean));
          if (meData.profile.digest_time) setDigestTime(meData.profile.digest_time);
        }
        // Always start at step 1 — never skip ahead
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load onboarding"))
      .finally(() => setLoading(false));
  }, [router]);

  function handleSignOut() { clearToken(); router.replace("/login"); }

  useEffect(() => {
    const gmail = searchParams.get("gmail");
    const youtube = searchParams.get("youtube");
    const reddit = searchParams.get("reddit");

    if (gmail === "connected") {
      setBanner("Gmail connected — your newsletters are now in the pipeline.");
      api.getOnboardingStatus().then(setStatus);
    } else if (gmail === "denied") {
      setError("Google blocked Gmail access. Add your email as a test user in Google Cloud Console, then try again.");
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

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 6000);
    return () => clearTimeout(t);
  }, [error]);

  async function handleConnectGmail() {
    setGmailLoading(true); setError("");
    try { const { url } = await api.startGmailConnect("/onboarding"); window.location.href = url; }
    catch (err) { setError(err instanceof Error ? err.message : "Could not start Gmail connection"); setGmailLoading(false); }
  }
  async function handleDisconnectGmail() {
    setError("");
    try { await api.disconnectGmail(); setStatus(await api.getOnboardingStatus()); setBanner(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not disconnect Gmail"); }
  }
  async function handleConnectYouTube() {
    setYoutubeLoading(true); setError("");
    try { const { url } = await api.startYouTubeConnect("/onboarding"); window.location.href = url; }
    catch (err) { setError(err instanceof Error ? err.message : "Could not start YouTube connection"); setYoutubeLoading(false); }
  }
  async function handleDisconnectYouTube() {
    setError("");
    try { await api.disconnectYouTube(); setStatus(await api.getOnboardingStatus()); setBanner(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not disconnect YouTube"); }
  }
  async function handleConnectReddit() {
    setRedditLoading(true); setError("");
    try { const { url } = await api.startRedditConnect("/onboarding"); window.location.href = url; }
    catch (err) { setError(err instanceof Error ? err.message : "Could not start Reddit connection"); setRedditLoading(false); }
  }
  async function handleDisconnectReddit() {
    setError("");
    try { await api.disconnectReddit(); setStatus(await api.getOnboardingStatus()); setBanner(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not disconnect Reddit"); }
  }

  async function handleSaveProfile() {
    setSaving(true); setError("");
    try {
      await api.updateOnboardingProfile({
        role: role || undefined,
        goal: goal.trim() || undefined,
        interests: topics.length ? topics : undefined,
      });
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddHackerNews() {
    setError("");
    try {
      await api.addSource({ identifier: "https://hnrss.org/frontpage", name: "Hacker News" });
      setStatus(await api.getOnboardingStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add Hacker News");
    }
  }

  // Merges the old "Step 3" (time save) + "Step 4" (complete) into one action.
  // Called directly when the user clicks "Open my dashboard" on Step 3.
  async function handleFinish() {
    setFinishing(true); setError("");
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
        <div className="onboard-loading"><span className="btn-spinner" /><p>Setting up…</p></div>
      </div>
    );
  }

  // Map internal step (1-3) to progress bar segment (same here, since we have 3 steps)
  const progressStep = Math.min(step, 3);

  return (
    <div className="onboard-shell">
      <div className="onboard-glow" aria-hidden />

      {error && (
        <div className="onboard-error-toast" role="alert" onClick={() => setError("")}>
          <span>{error}</span>
          <button type="button" aria-label="Dismiss">×</button>
        </div>
      )}

      <header className="onboard-header">
        <Link href="/" className="onboard-logo">
          <BrieflyLogo variant="full" size="md" />
        </Link>
        <div className="onboard-header-right">
          <span className="onboard-step-counter">{progressStep} / {STEPS.length}</span>
          <div className="onboard-profile-wrap">
            <button type="button" className="onboard-avatar-btn" onClick={() => setProfileMenuOpen((o) => !o)} aria-label="Account menu">
              {me?.user.avatar_url ? (
                <Image src={me.user.avatar_url} alt="" width={34} height={34} className="onboard-avatar-img" />
              ) : (
                <span className="onboard-avatar-initials">
                  {(me?.user.name ?? me?.user.email ?? "U").charAt(0).toUpperCase()}
                </span>
              )}
            </button>
            {profileMenuOpen && (
              <>
                <div className="onboard-profile-backdrop" onClick={() => setProfileMenuOpen(false)} />
                <div className="onboard-profile-menu">
                  <div className="onboard-profile-info">
                    <p className="onboard-profile-name">{me?.user.name ?? "Account"}</p>
                    <p className="onboard-profile-email">{me?.user.email}</p>
                  </div>
                  <button type="button" className="onboard-signout-btn" onClick={handleSignOut}>Sign out</button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="onboard-progress-bar" aria-label={`Step ${progressStep} of ${STEPS.length}`}>
        {STEPS.map(({ n, label }) => (
          <button
            key={n}
            type="button"
            className={`onboard-progress-segment ${progressStep >= n ? "done" : ""} ${progressStep === n ? "current" : ""}`}
            onClick={() => n < step && setStep(n)}
            disabled={n > step}
            aria-label={label}
            aria-current={progressStep === n ? "step" : undefined}
          />
        ))}
      </div>

      <main className="onboard-main">
        <div key={step} className="onboard-panel-wrap">

          {/* ── Step 1: About you (3 questions) ─────────────────────────────── */}
          {step === 1 && (
            <section className="onboard-panel">
              <header className="onboard-panel-head">
                <p className="onboard-eyebrow">Step 1 of 3</p>
                <h1 className="onboard-title">Tell us about yourself</h1>
                <p className="onboard-desc">Three quick questions — this is what makes your first digest feel personal.</p>
              </header>

              <div className="onboard-fields">
                {/* Q1 — Role */}
                <div className="onboard-field">
                  <span className="onboard-field-label">What best describes you?</span>
                  <div className="onboard-role-grid">
                    {ROLES.map((r) => (
                      <button key={r} type="button" className={`onboard-role-pill ${role === r ? "selected" : ""}`} onClick={() => setRole(r)}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Q2 — Goal (single line) */}
                <label className="onboard-field">
                  <span className="onboard-field-label">What&apos;s your main focus right now?</span>
                  <input
                    type="text"
                    className="onboard-input"
                    placeholder="e.g. Building an AI product and staying ahead of the space"
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                  />
                </label>

                {/* Q3 — Topics */}
                <TagInput
                  label="What topics should always be on your radar?"
                  hint="These become your relevance filter — Briefly scores every article against them."
                  placeholder="e.g. AI agents, startup funding, product design"
                  tags={topics}
                  onChange={setTopics}
                  suggestions={TOPIC_SUGGESTIONS[role] ?? DEFAULT_TOPICS}
                />
              </div>

              <div className="onboard-actions">
                <button type="button" className="btn-primary onboard-cta" onClick={handleSaveProfile} disabled={saving}>
                  {saving ? <><span className="btn-spinner btn-spinner-light" /> Saving…</> : "Continue"}
                </button>
                <button type="button" className="onboard-ghost" onClick={() => setStep(2)}>Skip for now</button>
              </div>
            </section>
          )}

          {/* ── Step 2: Connect accounts ─────────────────────────────────────── */}
          {step === 2 && (
            <section className="onboard-panel onboard-panel-wide">
              <header className="onboard-panel-head">
                <p className="onboard-eyebrow">Step 2 of 3</p>
                <h1 className="onboard-title">Connect your accounts</h1>
                <p className="onboard-desc">
                  Connect once — Briefly reads everything you already follow so you don&apos;t have to rebuild your reading list.
                </p>
              </header>

              {banner && <div className="onboard-banner onboard-banner-success">{banner}</div>}

              {/* Gmail */}
              <article className={`onboard-account-card ${status?.gmail_connected ? "connected" : ""}`}>
                <div className="onboard-account-left">
                  <span className="onboard-account-icon"><GmailIcon /></span>
                  <div className="onboard-account-info">
                    <p className="onboard-account-title">Gmail</p>
                    <p className="onboard-account-sub">Newsletters found automatically</p>
                    {status?.gmail_connected ? (
                      <div className="onboard-account-meta">
                        {status.gmail_email && <span className="onboard-account-meta-email">{status.gmail_email}</span>}
                        {status.newsletter_count != null && <span className="onboard-account-meta-stat">{status.newsletter_count}+ newsletters</span>}
                      </div>
                    ) : (
                      <p className="onboard-account-hint">Only newsletter-like emails — never personal mail.</p>
                    )}
                  </div>
                </div>
                <div className="onboard-account-action">
                  {status?.gmail_connected ? (
                    <div className="onboard-connected-actions">
                      <span className="onboard-badge-connected"><CheckIcon /> Connected</span>
                      <button type="button" className="onboard-disconnect-btn" onClick={handleDisconnectGmail}>Disconnect</button>
                    </div>
                  ) : (
                    <button type="button" className="onboard-connect-sm" onClick={handleConnectGmail} disabled={gmailLoading}>
                      {gmailLoading ? <><span className="btn-spinner btn-spinner-dark" />Redirecting…</> : <><GmailIcon />Connect Gmail</>}
                    </button>
                  )}
                </div>
              </article>

              {/* YouTube */}
              <article className={`onboard-account-card ${status?.youtube_connected ? "connected" : ""}`}>
                <div className="onboard-account-left">
                  <span className="onboard-account-icon"><YouTubeIcon /></span>
                  <div className="onboard-account-info">
                    <p className="onboard-account-title">YouTube</p>
                    <p className="onboard-account-sub">All channels you subscribe to</p>
                    {status?.youtube_connected ? (
                      <div className="onboard-account-meta">
                        {status.youtube_channel_count != null && status.youtube_channel_count > 0 ? (
                          <span className="onboard-account-meta-stat">{status.youtube_channel_count} channels</span>
                        ) : (
                          <span className="onboard-account-meta-warn">
                            No channels found — your YouTube subscriptions may be private.{" "}
                            <a href="https://www.youtube.com/account_privacy" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>Check settings ↗</a>
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="onboard-account-hint">Recent videos from your subscriptions, ranked by relevance.</p>
                    )}
                  </div>
                </div>
                <div className="onboard-account-action">
                  {status?.youtube_connected ? (
                    <div className="onboard-connected-actions">
                      <span className="onboard-badge-connected"><CheckIcon /> Connected</span>
                      <button type="button" className="onboard-disconnect-btn" onClick={handleDisconnectYouTube}>Disconnect</button>
                    </div>
                  ) : (
                    <button type="button" className="onboard-connect-sm" onClick={handleConnectYouTube} disabled={youtubeLoading}>
                      {youtubeLoading ? <><span className="btn-spinner btn-spinner-dark" />Redirecting…</> : <><YouTubeIcon />Connect YouTube</>}
                    </button>
                  )}
                </div>
              </article>

              {/* Reddit */}
              <article className={`onboard-account-card ${status?.reddit_connected ? "connected" : ""}`}>
                <div className="onboard-account-left">
                  <span className="onboard-account-icon"><RedditIcon /></span>
                  <div className="onboard-account-info">
                    <p className="onboard-account-title">Reddit</p>
                    <p className="onboard-account-sub">All subreddits you subscribe to</p>
                    {status?.reddit_connected ? (
                      <div className="onboard-account-meta">
                        {status.reddit_subreddit_count != null && <span className="onboard-account-meta-stat">{status.reddit_subreddit_count} subreddits</span>}
                      </div>
                    ) : (
                      <p className="onboard-account-hint">Hot posts from your subscriptions — no manual entry needed.</p>
                    )}
                  </div>
                </div>
                <div className="onboard-account-action">
                  {status?.reddit_connected ? (
                    <div className="onboard-connected-actions">
                      <span className="onboard-badge-connected"><CheckIcon /> Connected</span>
                      <button type="button" className="onboard-disconnect-btn" onClick={handleDisconnectReddit}>Disconnect</button>
                    </div>
                  ) : (
                    <button type="button" className="onboard-connect-sm" onClick={handleConnectReddit} disabled={redditLoading}>
                      {redditLoading ? <><span className="btn-spinner btn-spinner-dark" />Redirecting…</> : <><RedditIcon />Connect Reddit</>}
                    </button>
                  )}
                </div>
              </article>

              {/* RSS / URL fallback */}
              <div className="onboard-secondary" style={{ marginTop: 24 }}>
                <div className="onboard-secondary-card">
                  <div className="onboard-secondary-head">
                    <span className="onboard-secondary-icon">RSS</span>
                    <div><h3>Add any URL</h3><p>Blogs, news sites, RSS feeds, or any website</p></div>
                  </div>
                  <div className="onboard-add-form">
                    <AddSourceForm onAdded={() => api.getOnboardingStatus().then(setStatus)} />
                  </div>
                </div>

                <div className="onboard-secondary-card">
                  <div className="onboard-secondary-head">
                    <span className="onboard-secondary-icon">HN</span>
                    <div><h3>Quick add</h3><p>Popular sources, one tap</p></div>
                  </div>
                  <button type="button" className="onboard-chip-btn" onClick={handleAddHackerNews}>Hacker News</button>
                  {(status?.sources_count ?? 0) > 0 && (
                    <p className="onboard-source-count">{status?.sources_count} source{(status?.sources_count ?? 0) === 1 ? "" : "s"} connected</p>
                  )}
                </div>
              </div>

              <div className="onboard-actions">
                {/* Proactive hint — visible always, changes tone once connected */}
                <p className={`onboard-hint ${canContinueStep2 ? "onboard-hint--success" : ""}`}>
                  {canContinueStep2
                    ? "✓ You're connected — ready to continue."
                    : "Connect at least one account or add a URL above to continue."}
                </p>
                <button
                  type="button"
                  className="btn-primary onboard-cta"
                  onClick={() => setStep(3)}
                  disabled={!canContinueStep2}
                >
                  Continue
                </button>
              </div>
            </section>
          )}

          {/* ── Step 3: Done — time picker + stats + CTA ─────────────────────── */}
          {step === 3 && (() => {
            const newsletterCount = status?.newsletter_count ?? 0;
            const ytCount = status?.youtube_channel_count ?? 0;
            const redditCount = status?.reddit_subreddit_count ?? 0;
            const rssCount = Math.max(0,
              (status?.sources_count ?? 0)
              - (newsletterCount > 0 ? 1 : 0)
              - (ytCount > 0 ? 1 : 0)
              - (redditCount > 0 ? 1 : 0)
            );
            const stats = [
              newsletterCount > 0 && { n: newsletterCount, label: "newsletters" },
              ytCount > 0 && { n: ytCount, label: "YouTube channels" },
              redditCount > 0 && { n: redditCount, label: "subreddits" },
              rssCount > 0 && { n: rssCount, label: "RSS feeds" },
            ].filter(Boolean) as { n: number; label: string }[];

            return (
              <section className="onboard-panel onboard-confirm">
                <div className="onboard-confirm-icon" aria-hidden>✓</div>
                <h1 className="onboard-confirm-title">You&apos;re all set</h1>

                {stats.length > 0 && (
                  <div className="onboard-confirm-stats">
                    {stats.map(({ n, label }) => (
                      <div key={label} className="onboard-confirm-stat">
                        <span className="onboard-confirm-stat-num">{n}</span>
                        <span className="onboard-confirm-stat-label">{label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Time picker — merged here from old step 3 */}
                <div className="onboard-time-card" style={{ marginTop: 28, marginBottom: 8 }}>
                  <label className="onboard-field" style={{ textAlign: "left" }}>
                    <span className="onboard-field-label">Deliver my briefing at</span>
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

                <p className="onboard-confirm-note">
                  Briefly will read everything above, pick the most relevant stories for you, and deliver them every morning — nothing to do, just show up.
                </p>

                <button
                  type="button"
                  className="btn-primary onboard-cta"
                  onClick={handleFinish}
                  disabled={finishing}
                >
                  {finishing ? <><span className="btn-spinner btn-spinner-light" /> Opening dashboard…</> : "Open my dashboard →"}
                </button>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
                  We&apos;ll start generating your first briefing as soon as you land.
                </p>
              </section>
            );
          })()}

        </div>
      </main>
    </div>
  );
}
