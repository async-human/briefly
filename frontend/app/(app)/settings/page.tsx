"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { AppPageHeader } from "@/components/dashboard/AppPageHeader";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AccountConnections } from "@/components/settings/AccountConnections";
import { DataControls } from "@/components/settings/DataControls";
import { PlanBillingCard } from "@/components/settings/PlanBillingCard";
import { AnimatedPageSkeleton } from "@/components/loading/AnimatedPageSkeleton";
import { PageContentTransition } from "@/components/loading/PageContentTransition";
import { useMinLoadTime } from "@/components/loading/useMinLoadTime";
import { getToken } from "@/lib/auth";
import { TopicsToTrackEditor } from "@/components/settings/TopicsToTrackEditor";

const ROLES = ["Founder", "Product manager", "Engineer", "Investor", "Researcher", "Other"];

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
  const [me, setMe] = useState<{
    name: string | null;
    avatar_url?: string | null;
    ingestion_email?: string;
  } | null>(null);
  // Local editable state
  const [role, setRole] = useState("");
  const [goal, setGoal] = useState("");
  const [insight, setInsight] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [neverShow, setNeverShow] = useState<string[]>([]);
  const [deliveryTime, setDeliveryTime] = useState("07:00");
  const [briefStyle, setBriefStyle] = useState<"analyst" | "scan" | "plain">("analyst");
  const [briefLanguage, setBriefLanguage] = useState<"en" | "hi">("en");
  const [readingTopicSuggestions, setReadingTopicSuggestions] = useState<string[]>([]);

  // Per-section save state
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [interestsSaving, setInterestsSaving] = useState(false);
  const [interestsSaved, setInterestsSaved] = useState(false);
  const [filtersSaving, setFiltersSaving] = useState(false);
  const [filtersSaved, setFiltersSaved] = useState(false);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [deliverySaved, setDeliverySaved] = useState(false);
  const [styleSaving, setStyleSaving] = useState(false);
  const [styleSaved, setStyleSaved] = useState(false);
  // Auto-clear "Saved" badge after 2s
  const savedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  function flashSaved(setter: (v: boolean) => void) {
    setter(true);
    const t = setTimeout(() => setter(false), 2000);
    savedTimers.current.push(t);
  }

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    Promise.all([
      api.getMe(),
      api.getProfileIntelligence().catch(() => null),
    ])
      .then(([meData, intel]) => {
        if (!meData.onboarding_completed) { router.replace("/onboarding"); return; }
        setMe({
          name: meData.user.name,
          avatar_url: meData.user.avatar_url,
          ingestion_email: meData.ingestion_email,
        });
        const p = meData.profile;
        if (p) {
          setRole(p.role ?? "");
          setGoal(p.goal ?? "");
          setInsight(p.recent_insight ?? "");
          setTopics(p.interests?.map((i) => i.topic).filter(Boolean) ?? []);
          setNeverShow(p.never_show ?? []);
          setDeliveryTime(p.digest_time ?? "07:00");
          setBriefStyle(p.brief_style ?? "analyst");
          setBriefLanguage(p.brief_language ?? "en");
        }
        if (intel) {
          const fromReading = [
            ...intel.emerging_interests,
            ...intel.strongest_interests,
            ...Object.entries(intel.topic_strengths ?? {})
              .filter(([, strength]) => strength >= 0.45)
              .map(([topic]) => topic),
          ];
          setReadingTopicSuggestions(
            Array.from(new Set(fromReading.map((t) => t.trim().toLowerCase()).filter(Boolean))),
          );
        }
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

  async function saveStyle() {
    setStyleSaving(true);
    try {
      await api.updateOnboardingProfile({
        brief_style: briefStyle,
        brief_language: briefLanguage,
      });
      flashSaved(setStyleSaved);
    } finally { setStyleSaving(false); }
  }

  return (
    <DashboardShell userName={me?.name ?? null} avatarUrl={me?.avatar_url}>
      <div className="dash-page dash-page-settings">
        <AppPageHeader
          eyebrow="Settings"
          title="Preferences"
          subtitle="Adjust how Briefly works for you"
        />

        {showLoading ? (
          <AnimatedPageSkeleton variant="settings" />
        ) : (
          <PageContentTransition>
          <div className="dash-page-stack">
            {/* ── Plan & billing ── */}
            <div className="dash-surface dash-surface-settings dash-surface-billing">
              <div className="dash-surface-head">
                <h2 className="dash-surface-title">Plan & billing</h2>
                <p className="dash-surface-desc">
                  Manage your Briefly Pro subscription.
                </p>
              </div>
              <div className="dash-surface-body dash-surface-body-form">
                <PlanBillingCard
                  onUpgraded={() => {
                    void api.getMe().then((meData) => {
                      setMe({
                        name: meData.user.name,
                        avatar_url: meData.user.avatar_url,
                        ingestion_email: meData.ingestion_email,
                      });
                    });
                  }}
                />
              </div>
            </div>

            {/* ── Data & privacy ── */}
            <div className="dash-surface dash-surface-settings dash-surface-privacy">
              <div className="dash-surface-head">
                <h2 className="dash-surface-title">Data & privacy</h2>
                <p className="dash-surface-desc">
                  See what Briefly accessed, disconnect integrations, or delete your account.
                </p>
              </div>
              <div className="dash-surface-body dash-surface-body-form">
                <DataControls ingestionEmail={me?.ingestion_email} />
              </div>
            </div>

            {/* ── Connections ── */}
            <div className="dash-surface dash-surface-settings dash-surface-connections">
              <div className="dash-surface-head">
                <h2 className="dash-surface-title">Connected accounts</h2>
                <p className="dash-surface-desc">
                  Link the services Briefly reads from. Connect or disconnect anytime.
                </p>
              </div>
              <div className="dash-surface-body dash-surface-body-form">
                <AccountConnections ingestionEmail={me?.ingestion_email} />
              </div>
            </div>

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
              description="Every article is scored against these. Pick from suggestions or browse — specific topics give sharper briefs."
              onSave={saveInterests}
              saving={interestsSaving}
              saved={interestsSaved}
            >
              <div className="settings-field">
                <TopicsToTrackEditor
                  topics={topics}
                  onChange={setTopics}
                  role={role}
                  suggestedFromReading={readingTopicSuggestions}
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

            {/* ── Brief style ── */}
            <Section
              title="Brief style"
              description="How summaries and “why it matters” are written. Headlines stay unchanged for link integrity."
              onSave={saveStyle}
              saving={styleSaving}
              saved={styleSaved}
            >
              <div className="settings-field">
                <label className="settings-field-label">Voice</label>
                <div className="read-mode-toggle" role="group" aria-label="Brief style">
                  {(["analyst", "scan", "plain"] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      className={`read-mode-opt${briefStyle === style ? " active" : ""}`}
                      onClick={() => setBriefStyle(style)}
                    >
                      {style === "analyst" ? "Analyst" : style === "scan" ? "Scan" : "Plain"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-field">
                <label className="settings-field-label">Language</label>
                <div className="read-mode-toggle" role="group" aria-label="Brief language">
                  {(["en", "hi"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      className={`read-mode-opt${briefLanguage === lang ? " active" : ""}`}
                      onClick={() => setBriefLanguage(lang)}
                    >
                      {lang === "en" ? "English" : "Hindi"}
                    </button>
                  ))}
                </div>
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
