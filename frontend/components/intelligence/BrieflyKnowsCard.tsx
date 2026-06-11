"use client";

import type { ProfileIntelligence } from "@/lib/api";
import { formatTopicSignal, rankInsights } from "@/lib/brieflyKnows";
import { IntelSection } from "./IntelSection";

const INTERNAL_LABELS = new Set([
  "what's new",
  "whats new",
  "highly relevant to you",
  "highly relevant",
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

function formatIntelFreshness(updatedAt: Date | null): string | null {
  if (!updatedAt) return null;
  const mins = Math.round((Date.now() - updatedAt.getTime()) / 60_000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `Updated ${hrs}h ago`;
}

function topicDetail(
  storiesShown: number,
  saves: number,
  engaged: number,
  skipped: number,
  actions: number,
): string {
  if (actions > 0) {
    return formatTopicSignal({
      topic: "",
      rate: actions > 0 ? engaged / actions : 0,
      storiesShown,
      saves,
      skipped,
      engaged,
    });
  }
  if (storiesShown > 0) {
    return `${storiesShown} ${storiesShown === 1 ? "story" : "stories"} in your briefings · save or skip to train taste`;
  }
  return "Not in your briefings yet";
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
};

export function BrieflyKnowsCard({
  intel,
  declared,
  updatedAt,
  onRefresh,
  refreshing,
}: Props) {
  const freshness = formatIntelFreshness(updatedAt);
  const beh = intel.behavioral ?? {};
  const insights = rankInsights(beh.insights ?? []);
  const topicActual = beh.topic_actual ?? {};
  const srcEngage = beh.source_engagement ?? {};
  const emerging = (beh.emerging_topics ?? []).filter(isCleanLabel).slice(0, 6);
  const windowDays = beh.window_days ?? 45;
  const lastActivity = formatSignalAge(beh.latest_signal_at);
  const declaredKeys = new Set(declared.interests.map((t) => t.toLowerCase()));

  const topicNames = Array.from(
    new Set([
      ...declared.interests.filter(isCleanLabel),
      ...Object.keys(topicActual).filter(isCleanLabel),
    ]),
  );

  const topicRows = topicNames
    .map((topic) => {
      const key = topic.toLowerCase();
      const data = topicActual[key];
      const storiesShown = data?.stories_shown ?? 0;
      const saves = data?.saves ?? 0;
      const engaged = data?.engaged ?? 0;
      const skipped = data?.skipped ?? 0;
      const actions = data?.total ?? 0;
      const rate = data?.rate ?? (actions > 0 ? engaged / actions : 0);
      return {
        topic,
        storiesShown,
        saves,
        engaged,
        skipped,
        actions,
        rate,
        isDiscovered: data?.source === "discovered" || !declaredKeys.has(key),
        isEmpty: storiesShown === 0 && actions === 0,
      };
    })
    .sort((a, b) => b.rate - a.rate || b.saves - a.saves || b.storiesShown - a.storiesShown)
    .slice(0, 12);

  const cleanSources = (intel.top_sources ?? []).filter(isCleanLabel);
  const cleanDeprioritized = (intel.deprioritized_sources ?? []).filter(isCleanLabel);
  const cleanThreads = intel.active_threads.slice(0, 4);

  const topSrcRows = Object.entries(srcEngage)
    .filter(([s, r]) => isCleanLabel(s) && r >= 0.45)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  if (intel.digest_day === 0 && !declared.role && declared.interests.length === 0) {
    return (
      <div className="intel-doc intel-doc-empty">
        <p className="intel-doc-empty-hint">Your profile builds with every briefing you read.</p>
      </div>
    );
  }

  return (
    <div className="intel-doc">
      <div className="intel-doc-meta">
        <p className="intel-doc-meta-text">
          {freshness ?? `Based on your last ${windowDays} days`}
          {lastActivity ? ` · ${lastActivity}` : ""}
        </p>
        <button
          type="button"
          className="intel-doc-refresh"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh intelligence profile"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {insights.length > 0 && (
        <IntelSection title="Reading insights">
          <ul className="intel-doc-insights">
            {insights.slice(0, 3).map((ins) => (
              <li key={`${ins.type}-${ins.label}`} className={`intel-doc-insight intel-doc-insight--${ins.type}`}>
                <p className="intel-doc-insight-label">{ins.label}</p>
                <p className="intel-doc-insight-text">{ins.text}</p>
              </li>
            ))}
          </ul>
        </IntelSection>
      )}

      {topicRows.length > 0 && (
        <IntelSection
          title="Topic engagement"
          hint={`Stories in your briefings · last ${windowDays} days`}
        >
          <ul className="intel-doc-rows">
            {topicRows.map((row) => (
              <li
                key={row.topic}
                className={`intel-doc-row${row.isEmpty ? " intel-doc-row--muted" : ""}${row.isDiscovered ? " intel-doc-row--discovered" : ""}`}
              >
                <div className="intel-doc-row-top">
                  <span className="intel-doc-row-name">{row.topic}</span>
                  {row.rate > 0 && row.actions > 0 && (
                    <span className="intel-doc-row-metric">{Math.round(row.rate * 100)}% engaged</span>
                  )}
                </div>
                <p className="intel-doc-row-detail">
                  {topicDetail(row.storiesShown, row.saves, row.engaged, row.skipped, row.actions)}
                </p>
                {row.isDiscovered && !row.isEmpty && (
                  <p className="intel-doc-row-note">Discovered from your reading</p>
                )}
              </li>
            ))}
          </ul>
          {emerging.length > 0 && (
            <div className="intel-doc-chips-block">
              <p className="intel-doc-chips-label">Emerging · not declared</p>
              <div className="intel-doc-chips">
                {emerging.map((t) => (
                  <span key={t} className="intel-doc-chip">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </IntelSection>
      )}

      {topSrcRows.length > 0 && (
        <IntelSection title="Sources you engage with">
          <ul className="intel-doc-rows intel-doc-rows--compact">
            {topSrcRows.map(([src, rate]) => (
              <li key={src} className="intel-doc-row intel-doc-row--source">
                <div className="intel-doc-row-top">
                  <span className="intel-doc-row-name">{src}</span>
                  <span className="intel-doc-row-metric">{Math.round(rate * 100)}%</span>
                </div>
                <p className="intel-doc-row-detail">Opened or saved from this source</p>
              </li>
            ))}
          </ul>
        </IntelSection>
      )}

      {cleanThreads.length > 0 && (
        <IntelSection title="Stories Briefly is tracking">
          <ul className="intel-doc-rows">
            {cleanThreads.map((t) => (
              <li key={t.topic} className="intel-doc-row intel-doc-row--thread">
                <div className="intel-doc-row-top">
                  <span className="intel-doc-row-name">{t.topic}</span>
                  <span className="intel-doc-row-metric">
                    {t.appearances} update{t.appearances === 1 ? "" : "s"}
                    {t.weeks > 0 ? ` · ${t.weeks}w` : ""}
                  </span>
                </div>
                {t.latest && <p className="intel-doc-row-quote">&ldquo;{t.latest}&rdquo;</p>}
              </li>
            ))}
          </ul>
        </IntelSection>
      )}

      {(cleanDeprioritized.length > 0 || (cleanSources.length > 0 && topSrcRows.length === 0)) && (
        <IntelSection title="Source signals">
          {cleanSources.length > 0 && topSrcRows.length === 0 && (
            <div className="intel-doc-chips-block">
              <p className="intel-doc-chips-label">Watching</p>
              <div className="intel-doc-chips">
                {cleanSources.map((s) => (
                  <span key={s} className="intel-doc-chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {cleanDeprioritized.length > 0 && (
            <div className="intel-doc-chips-block">
              <p className="intel-doc-chips-label">Low engagement</p>
              <div className="intel-doc-chips">
                {cleanDeprioritized.map((s) => (
                  <span key={s} className="intel-doc-chip intel-doc-chip--muted">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </IntelSection>
      )}
    </div>
  );
}
