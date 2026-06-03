"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ProfileIntelligence } from "@/lib/api";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getToken } from "@/lib/auth";

const ROLES = ["Founder", "Product manager", "Engineer", "Investor", "Researcher", "Other"];

const TOPIC_SUGGESTIONS: Record<string, string[]> = {
  Founder:           ["product-market fit", "startup funding", "hiring", "growth metrics", "AI tools"],
  "Product manager": ["product strategy", "user research", "roadmapping", "AI/ML", "growth"],
  Engineer:          ["system design", "AI/ML", "developer tools", "open source", "security"],
  Investor:          ["deal flow", "market trends", "valuations", "exits", "emerging tech"],
  Researcher:        ["academic papers", "methodology", "data science", "policy", "emerging tech"],
  Other:             ["technology", "business", "science", "design", "policy"],
};
const NEVER_SHOW_SUGGESTIONS = ["crypto prices", "celebrity news", "sports", "stock tips", "politics"];

// ── Reusable tag editor ───────────────────────────────────────────────────────

function TagEditor({
  tags,
  onChange,
  placeholder,
  suggestions = [],
  variant = "default",
}: {
  tags: string[];
  onChange: (t: string[]) => void;
  placeholder: string;
  suggestions?: string[];
  variant?: "default" | "danger";
}) {
  const [val, setVal] = useState("");

  function add(raw: string) {
    const t = raw.trim().toLowerCase().replace(/,+$/, "");
    if (t && !tags.includes(t) && tags.length < 15) onChange([...tags, t]);
    setVal("");
  }
  function remove(t: string) { onChange(tags.filter((x) => x !== t)); }
  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (val) add(val); }
    if (e.key === "Backspace" && !val && tags.length) remove(tags[tags.length - 1]);
  }

  return (
    <div>
      <div className={`tag-input-wrap ${variant === "danger" ? "tag-input-wrap--danger" : ""}`}>
        {tags.map((t) => (
          <span key={t} className={`tag-chip ${variant === "danger" ? "tag-chip--danger" : ""}`}>
            {t}
            <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t}`}>×</button>
          </span>
        ))}
        <input
          type="text"
          className="tag-input"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => { if (val) add(val); }}
          placeholder={tags.length === 0 ? placeholder : ""}
        />
      </div>
      {suggestions.filter((s) => !tags.includes(s)).slice(0, 5).length > 0 && (
        <div className="tag-suggestions" style={{ marginTop: 8 }}>
          {suggestions.filter((s) => !tags.includes(s)).slice(0, 5).map((s) => (
            <button key={s} type="button" className="tag-suggestion" onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Briefly Knows card ────────────────────────────────────────────────────────

function InterestBar({ topic, strength }: { topic: string; strength: number }) {
  const pct = Math.round(strength * 100);
  const label = strength >= 0.6 ? "strong" : strength >= 0.35 ? "building" : "early signal";
  const cls = strength >= 0.6 ? "bk-signal-strong" : strength >= 0.35 ? "bk-signal-mid" : "bk-signal-low";
  return (
    <div className="bk-interest-row">
      <span className="bk-interest-name">{topic}</span>
      <div className="bk-interest-track">
        <div className="bk-interest-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className={`bk-signal ${cls}`}>{label}</span>
    </div>
  );
}

function BrieflyKnowsCard({ intel, streak }: { intel: ProfileIntelligence; streak: number }) {
  const hasSomething = intel.digest_day > 0;

  if (!hasSomething) {
    return (
      <div className="settings-section bk-card bk-card-empty">
        <div className="settings-section-head">
          <h2 className="settings-section-title">What Briefly knows about you</h2>
          <p className="settings-section-desc">
            Briefly learns from every digest you read. Your intelligence profile will appear here after your first briefing.
          </p>
        </div>
      </div>
    );
  }

  const topicEntries = Object.entries(intel.topic_strengths ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  const hasInterests = topicEntries.length > 0 || intel.strongest_interests.length > 0;
  const stats = intel.reading_stats ?? { total_digests: 0, avg_open_rate: 0, avg_click_rate: 0 };

  return (
    <div className="settings-section bk-card">
      {/* ── Header ── */}
      <div className="bk-header">
        <h2 className="bk-title">What Briefly knows about you</h2>
        <p className="bk-subtitle">
          {intel.digest_day} day{intel.digest_day !== 1 ? "s" : ""} of learning — updates with every digest
        </p>
      </div>

      {/* ── Stats row ── */}
      <div className="bk-stats-row">
        <div className="bk-stat-box">
          <span className="bk-stat-num">{stats.total_digests}</span>
          <span className="bk-stat-label">digests read</span>
        </div>
        {stats.avg_open_rate > 0 && (
          <div className="bk-stat-box">
            <span className="bk-stat-num">{stats.avg_open_rate}%</span>
            <span className="bk-stat-label">avg open rate</span>
          </div>
        )}
        {stats.avg_click_rate > 0 && (
          <div className="bk-stat-box">
            <span className="bk-stat-num">{stats.avg_click_rate}%</span>
            <span className="bk-stat-label">avg click rate</span>
          </div>
        )}
        {streak > 0 && (
          <div className="bk-stat-box">
            <span className="bk-stat-num">{streak}</span>
            <span className="bk-stat-label">day streak 🔥</span>
          </div>
        )}
      </div>

      {/* ── Inferred interests with strength bars ── */}
      {hasInterests && (
        <div className="bk-section">
          <p className="bk-section-label">Interests Briefly has inferred</p>
          <div className="bk-interest-list">
            {topicEntries.length > 0
              ? topicEntries.map(([topic, strength]) => (
                  <InterestBar key={topic} topic={topic} strength={strength} />
                ))
              : intel.strongest_interests.map((t) => (
                  <InterestBar key={t} topic={t} strength={0.65} />
                ))}
          </div>
          {intel.emerging_interests?.length > 0 && (
            <div className="bk-emerging">
              <span className="bk-emerging-label">Also noticing:</span>
              {intel.emerging_interests.map((t) => (
                <span key={t} className="bk-chip bk-chip-emerging">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Active story threads ── */}
      {intel.active_threads.length > 0 && (
        <div className="bk-section">
          <p className="bk-section-label">Stories Briefly is tracking for you</p>
          <div className="bk-threads-list">
            {intel.active_threads.slice(0, 4).map((t) => (
              <div key={t.topic} className="bk-thread-card">
                <div className="bk-thread-card-header">
                  <span className="bk-thread-card-topic">{t.topic}</span>
                  <span className="bk-thread-card-meta">
                    {t.weeks}w · {t.appearances} items
                  </span>
                </div>
                {t.latest && (
                  <p className="bk-thread-card-latest">&ldquo;{t.latest}&rdquo;</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Source preferences ── */}
      {intel.top_sources.length > 0 && (
        <div className="bk-section">
          <p className="bk-section-label">Sources Briefly prioritises for you</p>
          <div className="bk-chips">
            {intel.top_sources.map((s) => (
              <span key={s} className="bk-chip bk-chip-source">{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* ── Fading signals ── */}
      {(intel.moved_away_from.length > 0 || intel.deprioritized_sources.length > 0) && (
        <div className="bk-section bk-section-dim">
          {intel.moved_away_from.length > 0 && (
            <>
              <p className="bk-section-label">Topics you&apos;ve moved away from</p>
              <div className="bk-chips" style={{ marginBottom: intel.deprioritized_sources.length > 0 ? 12 : 0 }}>
                {intel.moved_away_from.map((t) => (
                  <span key={t} className="bk-chip bk-chip-faded">{t}</span>
                ))}
              </div>
            </>
          )}
          {intel.deprioritized_sources.length > 0 && (
            <>
              <p className="bk-section-label">Sources with low engagement</p>
              <div className="bk-chips">
                {intel.deprioritized_sources.map((s) => (
                  <span key={s} className="bk-chip bk-chip-faded">{s}</span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  title,
  description,
  onSave,
  saving,
  saved,
  children,
}: {
  title: string;
  description?: string;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">{title}</h2>
        {description && <p className="settings-section-desc">{description}</p>}
      </div>
      <div className="settings-section-body">
        {children}
        <div className="settings-save-row">
          <button
            type="button"
            className="btn-primary settings-save-btn"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? <><span className="btn-spinner btn-spinner-light" /> Saving…</> : "Save"}
          </button>
          {saved && <span className="settings-saved-badge">✓ Saved</span>}
        </div>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SettingsSkeleton() {
  return (
    <div className="settings-page">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="settings-section">
          <div className="settings-section-head">
            <span className="skeleton-block" style={{ width: 120, height: 18, marginBottom: 8 }} />
            <span className="skeleton-block" style={{ width: "70%", height: 13 }} />
          </div>
          <div className="settings-section-body">
            <span className="skeleton-block" style={{ width: "100%", height: 44, marginBottom: 12 }} />
            <span className="skeleton-block" style={{ width: 64, height: 36 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);
  const [intel, setIntel] = useState<ProfileIntelligence | null>(null);
  const [streak, setStreak] = useState(0);

  // Local editable state
  const [role, setRole] = useState("");
  const [goal, setGoal] = useState("");
  const [insight, setInsight] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [neverShow, setNeverShow] = useState<string[]>([]);
  const [deliveryTime, setDeliveryTime] = useState("07:00");

  // Per-section save state
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [interestsSaving, setInterestsSaving] = useState(false);
  const [interestsSaved, setInterestsSaved] = useState(false);
  const [filtersSaving, setFiltersSaving] = useState(false);
  const [filtersSaved, setFiltersSaved] = useState(false);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [deliverySaved, setDeliverySaved] = useState(false);

  // Auto-clear "Saved" badge after 2s
  const savedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  function flashSaved(setter: (v: boolean) => void) {
    setter(true);
    const t = setTimeout(() => setter(false), 2000);
    savedTimers.current.push(t);
  }

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    Promise.all([api.getMe(), api.getProfileIntelligence().catch(() => null)])
      .then(([meData, intelData]) => {
        if (!meData.onboarding_completed) { router.replace("/onboarding"); return; }
        setMe({ name: meData.user.name, avatar_url: meData.user.avatar_url });
        setStreak(meData.reading_streak ?? 0);
        const p = meData.profile;
        if (p) {
          setRole(p.role ?? "");
          setGoal(p.goal ?? "");
          setInsight(p.recent_insight ?? "");
          setTopics(p.interests?.map((i) => i.topic).filter(Boolean) ?? []);
          setNeverShow(p.never_show ?? []);
          setDeliveryTime(p.digest_time ?? "07:00");
        }
        if (intelData) setIntel(intelData);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
    const timers = savedTimers.current;
    return () => timers.forEach(clearTimeout);
  }, [router]);

  async function saveProfile() {
    setProfileSaving(true);
    try {
      await api.updateOnboardingProfile({
        role: role || undefined,
        goal: goal.trim() || undefined,
        recent_insight: insight.trim() || undefined,
      });
      flashSaved(setProfileSaved);
    } finally { setProfileSaving(false); }
  }

  async function saveInterests() {
    setInterestsSaving(true);
    try {
      await api.updateOnboardingProfile({ interests: topics.length ? topics : [] });
      flashSaved(setInterestsSaved);
    } finally { setInterestsSaving(false); }
  }

  async function saveFilters() {
    setFiltersSaving(true);
    try {
      await api.updateOnboardingProfile({ never_show: neverShow });
      flashSaved(setFiltersSaved);
    } finally { setFiltersSaving(false); }
  }

  async function saveDelivery() {
    setDeliverySaving(true);
    try {
      await api.updateOnboardingProfile({
        digest_time: deliveryTime,
        digest_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      flashSaved(setDeliverySaved);
    } finally { setDeliverySaving(false); }
  }

  return (
    <DashboardShell userName={me?.name ?? null} avatarUrl={me?.avatar_url}>
        <header className="dash-hero dash-hero-v2">
          <div className="dash-hero-main">
            <p className="dash-hero-label">Account</p>
            <h1 className="dash-hero-title">Preferences</h1>
            <p className="dash-hero-date">Adjust how Briefly works for you</p>
          </div>
        </header>

        {loading ? (
          <SettingsSkeleton />
        ) : (
          <div className="settings-page">

            {/* ── What Briefly knows ── */}
            {intel && <BrieflyKnowsCard intel={intel} streak={streak} />}

            {/* ── Profile ── */}
            <Section
              title="Your profile"
              description="Briefly uses this to personalise the tone and angle of every briefing."
              onSave={saveProfile}
              saving={profileSaving}
              saved={profileSaved}
            >
              <div className="settings-field">
                <label className="settings-field-label">What best describes you?</label>
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

              <div className="settings-field">
                <label className="settings-field-label">What&apos;s your main focus right now?</label>
                <input
                  type="text"
                  className="onboard-input"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. Building an AI product and staying ahead of the space"
                />
              </div>

              <div className="settings-field">
                <label className="settings-field-label">
                  Something you read recently that changed how you think
                  <span className="settings-optional"> — optional</span>
                </label>
                <p className="settings-field-hint">Helps Briefly understand the depth of thinking you find valuable.</p>
                <textarea
                  className="onboard-input onboard-textarea"
                  value={insight}
                  onChange={(e) => setInsight(e.target.value)}
                  placeholder='e.g. "The Andreessen essay on software eating the world made me rethink infrastructure"'
                  rows={2}
                />
              </div>
            </Section>

            {/* ── Interests ── */}
            <Section
              title="Topics to track"
              description="Every article is scored against these. The more specific, the better the signal."
              onSave={saveInterests}
              saving={interestsSaving}
              saved={interestsSaved}
            >
              <div className="settings-field">
                <TagEditor
                  tags={topics}
                  onChange={setTopics}
                  placeholder="e.g. AI agents, startup funding, product design"
                  suggestions={TOPIC_SUGGESTIONS[role] ?? ["AI agents", "startups", "technology"]}
                />
              </div>
            </Section>

            {/* ── Filters ── */}
            <Section
              title="Topics to skip"
              description="These are hard-filtered from every briefing, regardless of source."
              onSave={saveFilters}
              saving={filtersSaving}
              saved={filtersSaved}
            >
              <div className="settings-field">
                <TagEditor
                  tags={neverShow}
                  onChange={setNeverShow}
                  placeholder="e.g. crypto prices, celebrity news, sports"
                  suggestions={NEVER_SHOW_SUGGESTIONS}
                  variant="danger"
                />
              </div>
            </Section>

            {/* ── Delivery ── */}
            <Section
              title="Delivery"
              description="What time should your briefing land each morning?"
              onSave={saveDelivery}
              saving={deliverySaving}
              saved={deliverySaved}
            >
              <div className="settings-field">
                <label className="settings-field-label">Delivery time</label>
                <input
                  type="time"
                  className="onboard-input onboard-time-input"
                  value={deliveryTime}
                  onChange={(e) => setDeliveryTime(e.target.value)}
                  style={{ maxWidth: 180 }}
                />
                <p className="settings-field-hint" style={{ marginTop: 8 }}>
                  Timezone detected: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </p>
              </div>
            </Section>

          </div>
        )}
    </DashboardShell>
  );
}
