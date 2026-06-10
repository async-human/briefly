"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ProfileIntelligence } from "@/lib/api";
import { AppPageHeader } from "@/components/dashboard/AppPageHeader";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AnimatedPageSkeleton } from "@/components/loading/AnimatedPageSkeleton";
import { PageContentTransition } from "@/components/loading/PageContentTransition";
import { useMinLoadTime } from "@/components/loading/useMinLoadTime";
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

// Known internal routing labels that should never surface as user interests
const INTERNAL_LABELS = new Set([
  "what's new", "whats new", "highly relevant to you", "highly relevant",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCleanLabel(s: string) {
  return s.length > 1 && !INTERNAL_LABELS.has(s.toLowerCase()) && !UUID_RE.test(s);
}

// ── Topic tile: animated fill from bottom ────────────────────────────────────

function formatSignalAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Last activity today";
  if (days === 1) return "Last activity yesterday";
  if (days < 14) return `Last activity ${days} days ago`;
  const weeks = Math.round(days / 7);
  return `Last activity ${weeks} weeks ago`;
}

function topicBreakdown(saves: number, engaged: number, skipped: number): string {
  if (saves > 0 && skipped > 0) return `${saves} saved · ${skipped} skipped`;
  if (saves > 0) return `${saves} saved`;
  if (engaged > 0 && skipped > 0) return `${engaged} kept · ${skipped} skipped`;
  if (engaged > 0) return `${engaged} kept`;
  if (skipped > 0) return `${skipped} skipped`;
  return "No actions yet";
}

function TopicTile({
  topic, storiesShown, saves, engaged, skipped, actions, isDiscovered, isEmpty,
}: {
  topic: string;
  storiesShown: number;
  saves: number;
  engaged: number;
  skipped: number;
  actions: number;
  isDiscovered?: boolean;
  isEmpty?: boolean;
}) {
  const variant = isEmpty ? "declared"
    : isDiscovered ? "discovered"
    : actions > 0 && saves >= skipped ? "above"
    : "engaged";
  const fill = storiesShown > 0 && actions > 0
    ? `${Math.round((engaged / actions) * 100)}%`
    : storiesShown > 0 ? "18%" : "0%";

  return (
    <div
      className={`bk-topic-tile bk-topic-tile--${variant}`}
      style={{ "--bk-fill": fill } as React.CSSProperties}
      title={
        isEmpty
          ? "No matching stories in your briefings yet"
          : actions > 0
            ? `${storiesShown} stories in briefings · ${topicBreakdown(saves, engaged, skipped)}`
            : `${storiesShown} stor${storiesShown === 1 ? "y" : "ies"} in your briefings`
      }
    >
      {isEmpty ? (
        <>
          <span className="bk-topic-metric bk-topic-metric--muted">0</span>
          <span className="bk-topic-detail">stories so far</span>
        </>
      ) : (
        <>
          <span className="bk-topic-metric">{storiesShown}</span>
          <span className="bk-topic-detail">
            {actions > 0
              ? topicBreakdown(saves, engaged, skipped)
              : storiesShown === 1 ? "story in briefings" : "stories in briefings"}
          </span>
        </>
      )}
      <span className="bk-topic-name">{topic}</span>
      {isEmpty && <span className="bk-topic-sub">Not in your briefings yet</span>}
      {!isEmpty && actions === 0 && (
        <span className="bk-topic-sub">Save or skip in read mode to track taste</span>
      )}
      {!isEmpty && isDiscovered && (
        <span className="bk-topic-sub">From your reading, not declared</span>
      )}
    </div>
  );
}

function formatIntelFreshness(updatedAt: Date | null): string | null {
  if (!updatedAt) return null;
  const mins = Math.round((Date.now() - updatedAt.getTime()) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `Updated ${hrs}h ago`;
}

function BrieflyKnowsCard({
  intel, streak, declared, updatedAt, onRefresh, refreshing,
}: {
  intel: ProfileIntelligence;
  streak: number;
  declared: { role: string; goal: string; interests: string[] };
  updatedAt: Date | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const freshness = formatIntelFreshness(updatedAt);
  const stats       = intel.reading_stats ?? { total_digests: 0, avg_open_rate: 0, avg_click_rate: 0 };
  const beh         = intel.behavioral    ?? {};
  const insights    = beh.insights        ?? [];
  const topicActual = beh.topic_actual ?? {};
  const srcEngage   = beh.source_engagement ?? {};
  const emerging    = (beh.emerging_topics ?? []).filter(isCleanLabel).slice(0, 6);

  const windowDays = beh.window_days ?? 45;
  const lastActivity = formatSignalAge(beh.latest_signal_at);

  const declaredKeys = new Set(declared.interests.map((t) => t.toLowerCase()));

  const comparisonRows = declared.interests
    .filter(isCleanLabel)
    .map((topic) => {
      const key = topic.toLowerCase();
      const data = topicActual[key];
      const storiesShown = data?.stories_shown ?? 0;
      return {
        topic,
        storiesShown,
        saves: data?.saves ?? 0,
        engaged: data?.engaged ?? 0,
        skipped: data?.skipped ?? 0,
        actions: data?.total ?? 0,
        isDiscovered: data?.source === "discovered" || !declaredKeys.has(key),
        isEmpty: storiesShown === 0,
      };
    })
    .sort((a, b) => b.storiesShown - a.storiesShown || b.saves - a.saves)
    .slice(0, 12);

  const hasTopicEngagement = comparisonRows.some((r) => r.storiesShown > 0);

  const cleanSources       = (intel.top_sources           ?? []).filter(isCleanLabel);
  const cleanDeprioritized = (intel.deprioritized_sources ?? []).filter(isCleanLabel);
  const cleanThreads       = intel.active_threads.slice(0, 4);

  const topSrcRows = Object.entries(srcEngage)
    .filter(([s, r]) => isCleanLabel(s) && r >= 0.55)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  if (intel.digest_day === 0 && !declared.role && declared.interests.length === 0) {
    return (
      <div className="bk-card bk-card-empty">
        <div className="bk-masthead">
          <div className="bk-masthead-left">
            <span className="bk-eyebrow">intelligence profile</span>
            <h2 className="bk-title">What Briefly knows about you</h2>
          </div>
        </div>
        <p className="bk-empty-hint">Your profile builds with every digest you read.</p>
      </div>
    );
  }

  return (
    <div className="bk-card">

      {/* ── Masthead ── */}
      <div className="bk-masthead">
        <div className="bk-masthead-left">
          <span className="bk-eyebrow">intelligence profile</span>
          <h2 className="bk-title">What Briefly knows about you</h2>
          <p className="bk-freshness">
            {freshness ?? `Based on your last ${windowDays} days`}
            {lastActivity ? ` · ${lastActivity}` : ""}
            <button
              type="button"
              className="bk-refresh-btn"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh intelligence profile"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </p>
        </div>
        <div className="bk-masthead-stats">
          {stats.total_digests > 0 && (
            <div className="bk-stat">
              <span className="bk-stat-n">{stats.total_digests}</span>
              <span className="bk-stat-l">digests</span>
            </div>
          )}
          {(beh.total_signals ?? 0) > 0 && (
            <div className="bk-stat">
              <span className="bk-stat-n">{beh.total_signals}</span>
              <span className="bk-stat-l">signals</span>
            </div>
          )}
          {streak > 0 && (
            <div className="bk-stat bk-stat--streak">
              <span className="bk-stat-n">{streak}</span>
              <span className="bk-stat-l">day streak</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Behavioral insight callouts ── */}
      {insights.length > 0 && (
        <div className="bk-section">
          <p className="bk-section-label">Reading insights</p>
          <div className="bk-insight-cards">
            {insights.map((ins, i) => (
              <div key={i} className={`bk-insight-card bk-insight-card--${ins.type}`}>
                <span className="bk-insight-label">{ins.label}</span>
                <p className="bk-insight-text">{ins.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Topic tiles ── */}
      {comparisonRows.length > 0 && (
        <div className="bk-section">
          <div className="bk-section-head-row">
            <p className="bk-section-label">
              {hasTopicEngagement ? "Topic engagement" : "Your tracked topics"}
            </p>
            <span className="bk-section-hint">
              Stories Briefly included in your briefings (last {windowDays} days)
            </span>
          </div>
          {!hasTopicEngagement && (
            <p className="bk-declared-hint">
              Topics appear here once Briefly surfaces matching stories in a briefing.
            </p>
          )}
          <div className="bk-topics-grid">
            {comparisonRows.map((row) => (
              <TopicTile
                key={row.topic}
                topic={row.topic}
                  storiesShown={row.storiesShown}
                  saves={row.saves}
                  engaged={row.engaged}
                  skipped={row.skipped}
                  actions={row.actions}
                  isDiscovered={row.isDiscovered}
                  isEmpty={row.isEmpty ?? false}
              />
            ))}
          </div>
          {emerging.length > 0 && (
            <div className="bk-emerging">
              <span className="bk-emerging-label">Emerging in your reads (not declared)</span>
              <div className="bk-emerging-chips">
                {emerging.map((t) => (
                  <span key={t} className="bk-chip bk-chip-emerging">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Source ranking ── */}
      {topSrcRows.length > 0 && (
        <div className="bk-section">
          <p className="bk-section-label">Sources you consistently engage with</p>
          <div className="bk-source-list">
            {topSrcRows.map(([src, rate], i) => (
              <div key={src} className="bk-source-item">
                <span className="bk-source-num">{String(i + 1).padStart(2, "0")}</span>
                <span className="bk-source-name-text">{src}</span>
                <span className="bk-source-signal" style={{ opacity: Math.max(0.25, rate) }}>
                  <span className="bk-source-dot" />
                </span>
                <span className="bk-source-pct-badge">{Math.round(rate * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Story threads timeline ── */}
      {cleanThreads.length > 0 && (
        <div className="bk-section">
          <p className="bk-section-label">Stories Briefly is tracking for you</p>
          <div className="bk-threads">
            {cleanThreads.map((t) => (
              <div key={t.topic} className="bk-thread">
                <span className="bk-thread-dot" />
                <div className="bk-thread-body">
                  <div className="bk-thread-header">
                    <span className="bk-thread-topic">{t.topic}</span>
                    <span className="bk-thread-meta">{t.weeks}w · {t.appearances} briefings</span>
                  </div>
                  {t.latest && <p className="bk-thread-latest">&ldquo;{t.latest}&rdquo;</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Fading / deprioritized ── */}
      {(cleanDeprioritized.length > 0 || (cleanSources.length > 0 && topSrcRows.length === 0)) && (
        <div className="bk-section bk-section-dim">
          {cleanSources.length > 0 && topSrcRows.length === 0 && (
            <>
              <p className="bk-section-label">Sources Briefly watches for you</p>
              <div className="bk-chips">
                {cleanSources.map((s) => <span key={s} className="bk-chip bk-chip-source">{s}</span>)}
              </div>
            </>
          )}
          {cleanDeprioritized.length > 0 && (
            <>
              <p className="bk-section-label" style={{ marginTop: cleanSources.length > 0 ? 12 : 0 }}>
                Sources with low engagement
              </p>
              <div className="bk-chips">
                {cleanDeprioritized.map((s) => <span key={s} className="bk-chip bk-chip-faded">{s}</span>)}
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
    <div className="dash-surface dash-surface-settings">
      <div className="dash-surface-head">
        <h2 className="dash-surface-title">{title}</h2>
        {description ? <p className="dash-surface-desc">{description}</p> : null}
      </div>
      <div className="dash-surface-body dash-surface-body-form">
        {children}
        <div className="dash-form-actions">
          <button
            type="button"
            className="dash-btn dash-btn-primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <span className="btn-spinner btn-spinner-light" aria-hidden /> Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
          {saved && <span className="dash-saved-badge">Saved</span>}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const showLoading = useMinLoadTime(loading);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);
  const [intel, setIntel] = useState<ProfileIntelligence | null>(null);
  const [streak, setStreak] = useState(0);
  const [declaredProfile, setDeclaredProfile] = useState<{
    role: string; goal: string; interests: string[];
  }>({ role: "", goal: "", interests: [] });

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
  const [intelUpdatedAt, setIntelUpdatedAt] = useState<Date | null>(null);
  const [intelRefreshing, setIntelRefreshing] = useState(false);

  // Auto-clear "Saved" badge after 2s
  const savedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  function flashSaved(setter: (v: boolean) => void) {
    setter(true);
    const t = setTimeout(() => setter(false), 2000);
    savedTimers.current.push(t);
  }

  async function refreshIntelligence() {
    setIntelRefreshing(true);
    try {
      const [meData, intelData] = await Promise.all([
        api.getMe(),
        api.getProfileIntelligence(),
      ]);
      setStreak(meData.reading_streak ?? 0);
      setIntel(intelData);
      setIntelUpdatedAt(new Date());
    } catch {
      /* non-blocking — card keeps last known data */
    } finally {
      setIntelRefreshing(false);
    }
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
          setDeclaredProfile({
            role: p.role ?? "",
            goal: p.goal ?? "",
            interests: p.interests?.map((i) => i.topic).filter(Boolean) ?? [],
          });
        }
        if (intelData) {
          setIntel(intelData);
          setIntelUpdatedAt(new Date());
        }
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
    const timers = savedTimers.current;
    return () => timers.forEach(clearTimeout);
  }, [router]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && !loading) {
        void refreshIntelligence();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loading]);

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
      setDeclaredProfile((prev) => ({ ...prev, interests: topics }));
      flashSaved(setInterestsSaved);
      void refreshIntelligence();
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
      <div className="dash-page dash-page-settings">
        <AppPageHeader
          eyebrow="Settings"
          title="Preferences"
          subtitle="Adjust how Briefly works for you"
          stats={
            streak > 0
              ? [{ value: streak, label: "Day streak", accent: true }]
              : undefined
          }
        />

        {showLoading ? (
          <AnimatedPageSkeleton variant="settings" />
        ) : (
          <PageContentTransition>
          <div className="dash-page-stack">
            {intel && (
              <div className="dash-surface dash-surface-knows">
                <div className="dash-surface-body dash-surface-body-knows">
                  <BrieflyKnowsCard
                    intel={intel}
                    streak={streak}
                    declared={declaredProfile}
                    updatedAt={intelUpdatedAt}
                    onRefresh={() => void refreshIntelligence()}
                    refreshing={intelRefreshing}
                  />
                </div>
              </div>
            )}

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
          </PageContentTransition>
        )}
      </div>
    </DashboardShell>
  );
}
