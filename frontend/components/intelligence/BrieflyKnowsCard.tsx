"use client";

import type { ProfileIntelligence } from "@/lib/api";

const INTERNAL_LABELS = new Set([
  "what's new", "whats new", "highly relevant to you", "highly relevant",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCleanLabel(s: string) {
  return s.length > 1 && !INTERNAL_LABELS.has(s.toLowerCase()) && !UUID_RE.test(s);
}

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

export type DeclaredProfile = {
  role: string;
  goal: string;
  interests: string[];
};

type Props = {
  intel: ProfileIntelligence;
  streak: number;
  declared: DeclaredProfile;
  updatedAt: Date | null;
  onRefresh: () => void;
  refreshing: boolean;
  /** On /intelligence — skip duplicate page-level masthead */
  variant?: "full" | "embedded";
};

export function BrieflyKnowsCard({
  intel,
  streak,
  declared,
  updatedAt,
  onRefresh,
  refreshing,
  variant = "full",
}: Props) {
  const embedded = variant === "embedded";
  const freshness = formatIntelFreshness(updatedAt);
  const stats = intel.reading_stats ?? { total_digests: 0, avg_open_rate: 0, avg_click_rate: 0 };
  const beh = intel.behavioral ?? {};
  const insights = beh.insights ?? [];
  const topicActual = beh.topic_actual ?? {};
  const srcEngage = beh.source_engagement ?? {};
  const emerging = (beh.emerging_topics ?? []).filter(isCleanLabel).slice(0, 6);

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

  const cleanSources = (intel.top_sources ?? []).filter(isCleanLabel);
  const cleanDeprioritized = (intel.deprioritized_sources ?? []).filter(isCleanLabel);
  const cleanThreads = intel.active_threads.slice(0, 4);

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
    <div className={`bk-card${embedded ? " bk-card--embedded" : ""}`}>
      {embedded ? (
        <div className="bk-embedded-bar">
          <p className="bk-freshness">
            {freshness ?? `Based on your last ${windowDays} days`}
            {lastActivity ? ` · ${lastActivity}` : ""}
          </p>
          <button
            type="button"
            className="bk-refresh-btn"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh intelligence profile"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      ) : (
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
      )}

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
