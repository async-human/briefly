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

function lookupTopicStrength(strengths: Record<string, number>, topic: string): number {
  if (strengths[topic] !== undefined) return strengths[topic];
  const lower = topic.toLowerCase();
  const match = Object.entries(strengths).find(([k]) => k.toLowerCase() === lower);
  return match ? match[1] : 0.5;
}

function TopicTile({
  topic, pct, isActual, aboveExpectation, sampleTotal, isDiscovered,
}: {
  topic: string;
  pct: number | null;
  isActual: boolean;
  aboveExpectation: boolean | null;
  sampleTotal?: number;
  isDiscovered?: boolean;
}) {
  const variant = !isActual ? "declared"
    : isDiscovered ? "discovered"
    : aboveExpectation === true ? "above"
    : "engaged";
  const fill = pct !== null ? `${pct}%` : "0%";
  return (
    <div
      className={`bk-topic-tile bk-topic-tile--${variant}`}
      style={{ "--bk-fill": fill } as React.CSSProperties}
      title={
        isActual && sampleTotal
          ? `${pct}% engaged across ${sampleTotal} signals on this topic`
          : "Open or save stories on this topic to measure engagement"
      }
    >
      {isActual && pct !== null ? (
        <span className="bk-topic-pct">{pct}%</span>
      ) : (
        <span className="bk-topic-pct bk-topic-pct--muted">—</span>
      )}
      <span className="bk-topic-name">{topic}</span>
      {!isActual && (
        <span className="bk-topic-sub">Need more signals</span>
      )}
      {isActual && isDiscovered && (
        <span className="bk-topic-sub">Discovered from your reads</span>
      )}
    </div>
  );
}

function BrieflyKnowsCard({
  intel, streak, declared,
}: {
  intel: ProfileIntelligence;
  streak: number;
  declared: { role: string; goal: string; interests: string[] };
}) {
  const stats       = intel.reading_stats ?? { total_digests: 0, avg_open_rate: 0, avg_click_rate: 0 };
  const beh         = intel.behavioral    ?? {};
  const insights    = beh.insights        ?? [];
  const topicActual = beh.topic_actual ?? {};
  const srcEngage   = beh.source_engagement ?? {};
  const emerging    = (beh.emerging_topics ?? []).filter(isCleanLabel).slice(0, 6);

  const topicsWithEngagement = Object.values(topicActual).filter((t) => (t.total ?? 0) >= 2).length;
  const hasTopicEngagement = topicsWithEngagement > 0;

  const declaredKeys = new Set(declared.interests.map((t) => t.toLowerCase()));

  const engagedRows = Object.entries(topicActual)
    .filter(([, data]) => (data.total ?? 0) >= 2)
    .map(([key, data]) => ({
      topic: key,
      declared: lookupTopicStrength(intel.topic_strengths ?? {}, key),
      actual: data.rate,
      sampleTotal: data.total,
      isDiscovered: data.source === "discovered" || !declaredKeys.has(key),
    }))
    .sort((a, b) => b.actual - a.actual);

  const declaredPendingRows = declared.interests
    .filter(isCleanLabel)
    .filter((t) => {
      const data = topicActual[t.toLowerCase()];
      return !data || (data.total ?? 0) < 2;
    })
    .map((t) => ({
      topic: t,
      declared: lookupTopicStrength(intel.topic_strengths ?? {}, t),
      actual: null as number | null,
      sampleTotal: 0,
      isDiscovered: false,
    }));

  const comparisonRows = [...engagedRows, ...declaredPendingRows].slice(0, 12);

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
            {hasTopicEngagement && (
              <span className="bk-section-hint">% = open/save rate on matching stories</span>
            )}
          </div>
          {!hasTopicEngagement && (
            <p className="bk-declared-hint">
              Open and save stories to see your actual engagement per topic.
            </p>
          )}
          <div className="bk-topics-grid">
            {comparisonRows.map(({ topic, declared: d, actual: a, sampleTotal, isDiscovered }) => {
              const hasActual = a !== null;
              const pct = hasActual ? Math.round(a * 100) : null;
              const diff = hasActual ? Math.round(a * 100) - Math.round(d * 100) : null;
              return (
                <TopicTile
                  key={topic}
                  topic={topic}
                  pct={pct}
                  isActual={hasActual}
                  aboveExpectation={diff !== null && !isDiscovered ? diff > 10 : null}
                  sampleTotal={sampleTotal}
                  isDiscovered={isDiscovered}
                />
              );
            })}
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
                    <span className="bk-thread-meta">{t.weeks}w · {t.appearances} items</span>
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
          setDeclaredProfile({
            role: p.role ?? "",
            goal: p.goal ?? "",
            interests: p.interests?.map((i) => i.topic).filter(Boolean) ?? [],
          });
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
                  <BrieflyKnowsCard intel={intel} streak={streak} declared={declaredProfile} />
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
