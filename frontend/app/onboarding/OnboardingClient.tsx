"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { api, type OnboardingStatus, type MeResponse } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { BrieflyLogo } from "@/components/BrieflyLogo";
import { AddSourceForm } from "@/components/dashboard/AddSourceForm";
import "@/styles/onboarding.css";

const ROLES = ["Founder", "Product manager", "Engineer", "Investor", "Researcher", "Other"] as const;

const ROLE_META: Record<(typeof ROLES)[number], { sub: string; icon: ReactNode }> = {
  Founder: {
    sub: "building a company, raising, hiring",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M12 3L3 9v12h6v-7h6v7h6V9L12 3z" strokeLinejoin="round" />
      </svg>
    ),
  },
  "Product manager": {
    sub: "roadmaps, specs, tracking work",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 10h8M8 14h5" strokeLinecap="round" />
      </svg>
    ),
  },
  Engineer: {
    sub: "code, apps, tools",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  Investor: {
    sub: "deal flow, market trends",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M4 18V8l8-4 8 4v10" strokeLinejoin="round" />
        <path d="M9 18v-5h6v5" strokeLinejoin="round" />
      </svg>
    ),
  },
  Researcher: {
    sub: "digging into stuff, analysis",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <circle cx="11" cy="11" r="6" />
        <path d="M16 16l5 5" strokeLinecap="round" />
      </svg>
    ),
  },
  Other: {
    sub: "a bit of everything",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <circle cx="6" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="18" cy="12" r="2" />
      </svg>
    ),
  },
};

const STEPS = [
  { n: 1, label: "About you" },
  { n: 2, label: "Topics" },
  { n: 3, label: "Sources" },
  { n: 4, label: "Briefing" },
];

const STEP_KEY = "briefly-onboard-step";

const TOPIC_SUGGESTIONS: Record<string, string[]> = {
  Founder: ["product-market fit", "startup funding", "hiring", "growth metrics", "AI tools"],
  "Product manager": ["product strategy", "user research", "roadmapping", "AI/ML", "growth"],
  Engineer: ["system design", "AI/ML", "developer tools", "open source", "security"],
  Investor: ["deal flow", "market trends", "valuations", "exits", "emerging tech"],
  Researcher: ["academic papers", "methodology", "data science", "policy", "emerging tech"],
  Other: ["technology", "business", "science", "design", "policy"],
};
const DEFAULT_TOPICS = ["AI agents", "startups", "technology", "design", "science"];

type SourceKey = "gmail" | "youtube" | "reddit" | "url" | "hn";

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

  function remove(tag: string) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (inputValue) add(inputValue);
    }
    if (e.key === "Backspace" && !inputValue && tags.length > 0) remove(tags[tags.length - 1]);
  }

  const unused = suggestions.filter((s) => !tags.includes(s)).slice(0, 6);

  return (
    <div className="onboard-field">
      <span className="onboard-field-label">{label}</span>
      {hint && <p className="onboard-field-hint">{hint}</p>}
      <div className="tag-input-wrap">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            <button type="button" onClick={() => remove(tag)} aria-label={`Remove ${tag}`}>
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="tag-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (inputValue) add(inputValue);
          }}
          placeholder={tags.length === 0 ? placeholder : ""}
        />
      </div>
      {unused.length > 0 && (
        <>
          <p className="onboard-suggest-label">A few to try</p>
          <div className="tag-suggestions">
            {unused.map((s) => (
              <button key={s} type="button" className="tag-suggestion" onClick={() => add(s)}>
                {s}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function GmailIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
      <path fill="#EA4335" d="M24 5.5v13c0 .85-.65 1.5-1.5 1.5H1.5C.65 20 0 19.35 0 18.5v-13C0 4.65.65 4 1.5 4h21c.85 0 1.5.65 1.5 1.5z" />
      <path fill="#FBBC05" d="M0 4l12 9.5L24 4" />
      <path fill="#34A853" d="M0 18.5V4l12 9.5L0 18.5z" opacity="0.8" />
      <path fill="#4285F4" d="M24 4v14.5L12 13.5 24 4z" opacity="0.9" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden fill="none">
      <rect width="24" height="24" rx="5" fill="#FF0000" />
      <polygon points="9.5,7.5 16.5,12 9.5,16.5" fill="#fff" />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#FF4500" />
      <path
        fill="#fff"
        d="M20 12a2 2 0 0 0-2-2 2 2 0 0 0-1.3.5C15.4 9.7 14 9.2 12.4 9l.8-3.6 2.4.5a1.4 1.4 0 1 0 .1-.7l-2.7-.6L12 8.9c-1.7.1-3.2.6-4.4 1.5A2 2 0 0 0 4 12a2 2 0 0 0 1 1.7 3.5 3.5 0 0 0 0 .5c0 2.5 2.7 4.5 6 4.5s6-2 6-4.5a3.5 3.5 0 0 0 0-.5A2 2 0 0 0 20 12zm-10 2a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm4.5 2.5c-.7.7-2 .7-2.5.7s-1.8 0-2.5-.7a.3.3 0 0 1 .4-.4c.5.5 1.5.6 2.1.6s1.6-.1 2.1-.6a.3.3 0 0 1 .4.4zm-.5-1.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"
      />
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
  const [sourceDetail, setSourceDetail] = useState<SourceKey | null>(null);

  function goToStep(n: number) {
    setStep(n);
    if (typeof window !== "undefined") sessionStorage.setItem(STEP_KEY, String(n));
  }

  function goBack() {
    if (step > 1) goToStep(step - 1);
  }

  useEffect(() => {
    const saved = sessionStorage.getItem(STEP_KEY);
    if (saved) {
      const n = Number(saved);
      if (n >= 1 && n <= STEPS.length) setStep(n);
    }
  }, []);

  useEffect(() => {
    Promise.all([api.getOnboardingStatus(), api.getMe()])
      .then(([s, meData]) => {
        if (s.onboarding_completed) {
          router.replace("/dashboard");
          return;
        }
        setStatus(s);
        setMe(meData);
        if (meData.profile) {
          if (meData.profile.role) setRole(meData.profile.role);
          if (meData.profile.goal) setGoal(meData.profile.goal);
          if (meData.profile.interests?.length)
            setTopics(meData.profile.interests.map((i) => i.topic).filter(Boolean));
          if (meData.profile.digest_time) setDigestTime(meData.profile.digest_time);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load onboarding"))
      .finally(() => setLoading(false));
  }, [router]);

  function handleSignOut() {
    sessionStorage.removeItem(STEP_KEY);
    clearToken();
    router.replace("/login");
  }

  useEffect(() => {
    const gmail = searchParams.get("gmail");
    const youtube = searchParams.get("youtube");
    const reddit = searchParams.get("reddit");
    const oauthReturn = gmail || youtube || reddit;

    if (oauthReturn) goToStep(3);

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
      setStatus(await api.getOnboardingStatus());
      setBanner("");
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
      setStatus(await api.getOnboardingStatus());
      setBanner("");
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
      setStatus(await api.getOnboardingStatus());
      setBanner("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect Reddit");
    }
  }

  async function handleSaveProfile() {
    setSaving(true);
    setError("");
    try {
      await api.updateOnboardingProfile({
        role: role || undefined,
        goal: goal.trim() || undefined,
      });
      goToStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTopics() {
    setSaving(true);
    setError("");
    try {
      await api.updateOnboardingProfile({
        interests: topics.length ? topics : undefined,
      });
      goToStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save topics");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddHackerNews() {
    setError("");
    try {
      await api.addSource({ identifier: "https://hnrss.org/frontpage", name: "Hacker News" });
      setStatus(await api.getOnboardingStatus());
      setBanner("Hacker News added to your sources.");
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
      sessionStorage.removeItem(STEP_KEY);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finish onboarding");
      setFinishing(false);
    }
  }

  function handleSourceTileClick(key: SourceKey) {
    if (key === "gmail") {
      if (status?.gmail_connected) setSourceDetail(sourceDetail === "gmail" ? null : "gmail");
      else handleConnectGmail();
      return;
    }
    if (key === "youtube") {
      if (status?.youtube_connected) setSourceDetail(sourceDetail === "youtube" ? null : "youtube");
      else handleConnectYouTube();
      return;
    }
    if (key === "reddit") {
      if (status?.reddit_connected) setSourceDetail(sourceDetail === "reddit" ? null : "reddit");
      else handleConnectReddit();
      return;
    }
    if (key === "hn") {
      handleAddHackerNews();
      return;
    }
    setSourceDetail(sourceDetail === "url" ? null : "url");
  }

  const canContinueSources =
    status?.gmail_connected ||
    status?.youtube_connected ||
    status?.reddit_connected ||
    (status?.sources_count ?? 0) > 0;

  const firstName = me?.user.name?.split(" ")[0] ?? "there";
  const progressStep = Math.min(step, STEPS.length);

  if (loading) {
    return (
      <div className="onboard-shell">
        <div className="onboard-loading">
          <span className="btn-spinner" />
          <p>Setting up…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard-shell">
      <div className="onboard-glow" aria-hidden />

      {error && (
        <div className="onboard-error-toast" role="alert" onClick={() => setError("")}>
          <span>{error}</span>
          <button type="button" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <header className="onboard-header">
        <Link href="/" className="onboard-logo">
          <BrieflyLogo variant="full" size="md" />
        </Link>
        <div className="onboard-header-right">
          <div className="onboard-profile-wrap">
            <button
              type="button"
              className="onboard-avatar-btn"
              onClick={() => setProfileMenuOpen((o) => !o)}
              aria-label="Account menu"
            >
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
                  <button type="button" className="onboard-signout-btn" onClick={handleSignOut}>
                    Sign out
                  </button>
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
            onClick={() => n < step && goToStep(n)}
            disabled={n > step}
            aria-label={label}
            aria-current={progressStep === n ? "step" : undefined}
          />
        ))}
      </div>

      <main className="onboard-main">
        <div key={step} className="onboard-panel-wrap">
          <div className="onboard-nav-row">
            {step > 1 ? (
              <button type="button" className="onboard-back" onClick={goBack} aria-label="Go back">
                <BackIcon />
              </button>
            ) : (
              <span className="onboard-nav-spacer" aria-hidden />
            )}
          </div>

          {/* Step 1 — About you */}
          {step === 1 && (
            <section className="onboard-panel">
              <header className="onboard-panel-head">
                <h1 className="onboard-title">Let&apos;s get to know each other, {firstName}.</h1>
                <p className="onboard-desc">Pick what fits best — this shapes how Briefly prioritizes your digest.</p>
                <p className="onboard-editable-note">
                  You can change these anytime in <Link href="/settings">Settings</Link>.
                </p>
              </header>

              <div className="onboard-fields">
                <div className="onboard-field">
                  <span className="onboard-field-label">What best describes you?</span>
                  <div className="onboard-role-list">
                    {ROLES.map((r) => {
                      const meta = ROLE_META[r];
                      return (
                        <button
                          key={r}
                          type="button"
                          className={`onboard-role-card ${role === r ? "selected" : ""}`}
                          onClick={() => setRole(r)}
                        >
                          <span className="onboard-role-card-icon">{meta.icon}</span>
                          <span className="onboard-role-card-body">
                            <p className="onboard-role-card-title">{r}</p>
                            <p className="onboard-role-card-sub">{meta.sub}</p>
                          </span>
                          <span className="onboard-role-radio" aria-hidden>
                            <span className="onboard-role-radio-dot" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

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
              </div>

              <div className="onboard-actions">
                <button type="button" className="btn-primary onboard-cta" onClick={handleSaveProfile} disabled={saving}>
                  {saving ? (
                    <>
                      <span className="btn-spinner btn-spinner-light" /> Saving…
                    </>
                  ) : (
                    "Continue"
                  )}
                </button>
                <button type="button" className="onboard-ghost" onClick={() => goToStep(2)}>
                  Skip for now
                </button>
              </div>
            </section>
          )}

          {/* Step 2 — Topics */}
          {step === 2 && (
            <section className="onboard-panel">
              <header className="onboard-panel-head">
                <h1 className="onboard-title">What should always be on your radar?</h1>
                <p className="onboard-desc">
                  Pick one or two you care about most — Briefly scores every story against these.
                </p>
                <p className="onboard-editable-note">
                  You can change these anytime in <Link href="/settings">Settings</Link>.
                </p>
              </header>

              <TagInput
                label="Topics"
                hint="Press Enter or tap a suggestion to add."
                placeholder="e.g. AI agents, startup funding, product design"
                tags={topics}
                onChange={setTopics}
                suggestions={TOPIC_SUGGESTIONS[role] ?? DEFAULT_TOPICS}
              />

              <div className="onboard-actions" style={{ marginTop: 32 }}>
                <button type="button" className="btn-primary onboard-cta" onClick={handleSaveTopics} disabled={saving}>
                  {saving ? (
                    <>
                      <span className="btn-spinner btn-spinner-light" /> Saving…
                    </>
                  ) : (
                    "Continue"
                  )}
                </button>
                <button type="button" className="onboard-ghost" onClick={() => goToStep(3)}>
                  I&apos;ll set this up later
                </button>
              </div>
            </section>
          )}

          {/* Step 3 — Sources */}
          {step === 3 && (
            <section className="onboard-panel">
              <header className="onboard-panel-head">
                <h1 className="onboard-title">What do you read?</h1>
                <p className="onboard-desc">
                  No connections needed yet — tap a source to link it. Briefly pulls from what you already follow.
                </p>
                <p className="onboard-editable-note">
                  You can add or remove sources later in <Link href="/settings">Settings</Link>.
                </p>
              </header>

              {banner && <div className="onboard-banner onboard-banner-success">{banner}</div>}

              {(status?.sources_count ?? 0) > 0 && (
                <p className="onboard-source-count-pill">
                  {status?.sources_count} source{(status?.sources_count ?? 0) === 1 ? "" : "s"} connected
                </p>
              )}

              <div className="onboard-source-grid">
                <button
                  type="button"
                  className={`onboard-source-tile ${status?.gmail_connected ? "connected" : ""}`}
                  onClick={() => handleSourceTileClick("gmail")}
                  disabled={gmailLoading}
                >
                  {status?.gmail_connected && <span className="onboard-source-tile-check">✓</span>}
                  <span className="onboard-source-tile-icon">
                    <GmailIcon />
                  </span>
                  <span className="onboard-source-tile-label">Gmail</span>
                </button>

                <button
                  type="button"
                  className={`onboard-source-tile ${status?.youtube_connected ? "connected" : ""}`}
                  onClick={() => handleSourceTileClick("youtube")}
                  disabled={youtubeLoading}
                >
                  {status?.youtube_connected && <span className="onboard-source-tile-check">✓</span>}
                  <span className="onboard-source-tile-icon">
                    <YouTubeIcon />
                  </span>
                  <span className="onboard-source-tile-label">YouTube</span>
                </button>

                <button
                  type="button"
                  className={`onboard-source-tile ${status?.reddit_connected ? "connected" : ""}`}
                  onClick={() => handleSourceTileClick("reddit")}
                  disabled={redditLoading}
                >
                  {status?.reddit_connected && <span className="onboard-source-tile-check">✓</span>}
                  <span className="onboard-source-tile-icon">
                    <RedditIcon />
                  </span>
                  <span className="onboard-source-tile-label">Reddit</span>
                </button>

                <button
                  type="button"
                  className={`onboard-source-tile ${sourceDetail === "url" ? "connected" : ""}`}
                  onClick={() => handleSourceTileClick("url")}
                >
                  <span className="onboard-source-tile-icon onboard-source-tile-icon--text">RSS</span>
                  <span className="onboard-source-tile-label">Any URL</span>
                </button>

                <button type="button" className="onboard-source-tile" onClick={() => handleSourceTileClick("hn")}>
                  <span className="onboard-source-tile-icon onboard-source-tile-icon--text">HN</span>
                  <span className="onboard-source-tile-label">Hacker News</span>
                </button>

                <button
                  type="button"
                  className="onboard-source-tile"
                  onClick={() => setSourceDetail(sourceDetail === "url" ? null : "url")}
                >
                  <span className="onboard-source-tile-icon onboard-source-tile-icon--text">···</span>
                  <span className="onboard-source-tile-label">Something else</span>
                </button>
              </div>

              {sourceDetail === "gmail" && status?.gmail_connected && (
                <div className="onboard-source-detail">
                  <div className="onboard-source-detail-head">
                    <div>
                      <p className="onboard-source-detail-title">Gmail connected</p>
                      <p className="onboard-source-detail-sub">
                        {status.gmail_email && <>{status.gmail_email} · </>}
                        {status.newsletter_count != null && <>{status.newsletter_count}+ newsletters found</>}
                      </p>
                    </div>
                    <CheckIcon />
                  </div>
                  <div className="onboard-source-detail-actions">
                    <button type="button" className="onboard-disconnect-btn" onClick={handleDisconnectGmail}>
                      Disconnect
                    </button>
                  </div>
                </div>
              )}

              {sourceDetail === "youtube" && status?.youtube_connected && (
                <div className="onboard-source-detail">
                  <div className="onboard-source-detail-head">
                    <div>
                      <p className="onboard-source-detail-title">YouTube connected</p>
                      <p className="onboard-source-detail-sub">
                        {status.youtube_channel_count != null && status.youtube_channel_count > 0
                          ? `${status.youtube_channel_count} channels subscribed`
                          : "No channels found — your subscriptions may be private."}
                      </p>
                    </div>
                    <CheckIcon />
                  </div>
                  <div className="onboard-source-detail-actions">
                    <button type="button" className="onboard-disconnect-btn" onClick={handleDisconnectYouTube}>
                      Disconnect
                    </button>
                  </div>
                </div>
              )}

              {sourceDetail === "reddit" && status?.reddit_connected && (
                <div className="onboard-source-detail">
                  <div className="onboard-source-detail-head">
                    <div>
                      <p className="onboard-source-detail-title">Reddit connected</p>
                      <p className="onboard-source-detail-sub">
                        {status.reddit_subreddit_count != null &&
                          `${status.reddit_subreddit_count} subreddits subscribed`}
                      </p>
                    </div>
                    <CheckIcon />
                  </div>
                  <div className="onboard-source-detail-actions">
                    <button type="button" className="onboard-disconnect-btn" onClick={handleDisconnectReddit}>
                      Disconnect
                    </button>
                  </div>
                </div>
              )}

              {sourceDetail === "url" && (
                <div className="onboard-source-detail onboard-source-url-panel">
                  <p className="onboard-source-detail-title">Add any URL</p>
                  <p className="onboard-source-detail-sub">Blogs, news sites, RSS feeds, or any website.</p>
                  <div className="onboard-add-form">
                    <AddSourceForm onAdded={() => api.getOnboardingStatus().then(setStatus)} />
                  </div>
                </div>
              )}

              <div className="onboard-actions">
                <p className={`onboard-hint ${canContinueSources ? "onboard-hint--success" : ""}`}>
                  {canContinueSources
                    ? "You're connected — ready to continue."
                    : "Connect at least one source to continue, or skip for now."}
                </p>
                <button
                  type="button"
                  className="btn-primary onboard-cta"
                  onClick={() => goToStep(4)}
                  disabled={!canContinueSources}
                >
                  Continue
                </button>
                <button type="button" className="onboard-ghost" onClick={() => goToStep(4)}>
                  I&apos;ll set this up later
                </button>
              </div>
            </section>
          )}

          {/* Step 4 — Briefing time + finish */}
          {step === 4 &&
            (() => {
              const newsletterCount = status?.newsletter_count ?? 0;
              const ytCount = status?.youtube_channel_count ?? 0;
              const redditCount = status?.reddit_subreddit_count ?? 0;
              const rssCount = Math.max(
                0,
                (status?.sources_count ?? 0) -
                  (newsletterCount > 0 ? 1 : 0) -
                  (ytCount > 0 ? 1 : 0) -
                  (redditCount > 0 ? 1 : 0),
              );
              const stats = [
                newsletterCount > 0 && { n: newsletterCount, label: "newsletters" },
                ytCount > 0 && { n: ytCount, label: "YouTube channels" },
                redditCount > 0 && { n: redditCount, label: "subreddits" },
                rssCount > 0 && { n: rssCount, label: "RSS feeds" },
              ].filter(Boolean) as { n: number; label: string }[];

              return (
                <section className="onboard-panel onboard-confirm">
                  <div className="onboard-confirm-icon" aria-hidden>
                    ✓
                  </div>
                  <h1 className="onboard-confirm-title">You&apos;re all set</h1>
                  <p className="onboard-desc" style={{ textAlign: "center", marginBottom: 20 }}>
                    Briefly will read your sources, pick what matters, and deliver a morning briefing — nothing to do,
                    just show up.
                  </p>

                  {stats.length > 0 && (
                    <div className="onboard-ready-stats">
                      {stats.map(({ n, label }) => (
                        <span key={label} className="onboard-ready-stat">
                          <strong>{n}</strong> {label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="onboard-schedule-card">
                    <label className="onboard-field">
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

                  <p className="onboard-editable-note" style={{ textAlign: "center", marginBottom: 20 }}>
                    Change your profile, topics, or sources anytime in{" "}
                    <Link href="/settings">Settings</Link>.
                  </p>

                  <div className="onboard-actions">
                    <button
                      type="button"
                      className="btn-primary onboard-cta"
                      onClick={handleFinish}
                      disabled={finishing}
                    >
                      {finishing ? (
                        <>
                          <span className="btn-spinner btn-spinner-light" /> Opening dashboard…
                        </>
                      ) : (
                        "Let's go"
                      )}
                    </button>
                  </div>
                </section>
              );
            })()}
        </div>
      </main>
    </div>
  );
}
