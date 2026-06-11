"use client";

import Link from "next/link";
import type { ProfileIntelligence } from "@/lib/api";
import {
  formatTopicSignal,
  getFeaturedThread,
  getTopSourceEngagement,
  getTopTopicEngagement,
  rankInsights,
} from "@/lib/brieflyKnows";

type Props = {
  intel: ProfileIntelligence;
  streak: number;
  declaredInterests: string[];
  variant?: "default" | "compact";
};

function pct(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value <= 1 ? value * 100 : value);
}

export function BrieflyKnowsSummary({
  intel,
  streak,
  declaredInterests,
  variant = "default",
}: Props) {
  const insights = rankInsights(intel.behavioral?.insights ?? []);
  const beh = intel.behavioral ?? {};
  const stats = intel.reading_stats ?? { total_digests: 0, avg_open_rate: 0, avg_click_rate: 0 };

  const topicBars = Object.entries(intel.topic_strengths ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const interests = intel.strongest_interests.slice(0, 6);
  const emerging = [
    ...(intel.emerging_interests ?? []),
    ...(beh.emerging_topics ?? []),
  ]
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 4);

  const topSources = (intel.top_sources ?? []).slice(0, 3);
  const engagement = pct(beh.overall_engagement);
  const openRate = pct(stats.avg_open_rate);
  const clickRate = pct(stats.avg_click_rate);

  if (intel.digest_day === 0 && declaredInterests.length === 0) {
    return (
      <div className="bk-summary bk-summary-empty">
        <p className="bk-summary-eyebrow">What Briefly knows</p>
        <p className="bk-summary-hint">Your intelligence profile builds with every briefing you read.</p>
      </div>
    );
  }

  if (variant === "compact") {
    const topInsights = insights.slice(0, 2);
    const topicRows = getTopTopicEngagement(intel, 3);
    const topSource = getTopSourceEngagement(intel);
    const featuredThread = getFeaturedThread(intel.active_threads);
    const emergingTopics = emerging.slice(0, 3);

    return (
      <div className="bk-summary bk-summary--compact">
        <div className="bk-summary-head">
          <div>
            <p className="bk-summary-eyebrow">What Briefly knows</p>
            <h3 className="bk-summary-title">
              Day {intel.digest_day || 1}
              {streak > 1 ? ` · ${streak}-day streak` : ""}
              {engagement > 0 ? ` · ${engagement}% engaged` : ""}
            </h3>
          </div>
          <Link href="/intelligence" className="bk-summary-link">
            Full profile →
          </Link>
        </div>

        {topInsights.length > 0 && (
          <div className="bk-summary-compact-insights">
            {topInsights.map((insight) => (
              <div
                key={`${insight.type}-${insight.label}`}
                className={`bk-summary-compact-insight-card bk-summary-compact-insight-card--${insight.type}`}
              >
                <span className="bk-summary-insight-label">{insight.label}</span>
                <p className="bk-summary-compact-insight">{insight.text}</p>
              </div>
            ))}
          </div>
        )}

        {topicRows.length > 0 && (
          <div className="bk-summary-compact-topics-block">
            <p className="bk-summary-section-label">Where your attention goes</p>
            <ul className="bk-summary-compact-topic-list">
              {topicRows.map((row) => (
                <li key={row.topic} className="bk-summary-compact-topic-row">
                  <div className="bk-summary-compact-topic-head">
                    <span className="bk-summary-compact-topic-name">{row.topic}</span>
                    <span className="bk-summary-compact-topic-rate">
                      {Math.round(row.rate * 100)}%
                    </span>
                  </div>
                  <span className="bk-summary-topic-track" aria-hidden>
                    <span
                      className="bk-summary-topic-fill"
                      style={{ width: `${Math.min(100, Math.round(row.rate * 100))}%` }}
                    />
                  </span>
                  <span className="bk-summary-compact-topic-meta">{formatTopicSignal(row)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {featuredThread && (
          <div className="bk-summary-compact-thread">
            <p className="bk-summary-section-label">Story Briefly is tracking</p>
            <p className="bk-summary-compact-thread-topic">{featuredThread.topic}</p>
            {featuredThread.latest && (
              <p className="bk-summary-compact-thread-latest">&ldquo;{featuredThread.latest}&rdquo;</p>
            )}
            <p className="bk-summary-compact-thread-meta">
              {featuredThread.appearances} briefing update
              {featuredThread.appearances === 1 ? "" : "s"}
              {featuredThread.weeks > 0 ? ` · ${featuredThread.weeks}w running` : ""}
            </p>
          </div>
        )}

        {(topSource || emergingTopics.length > 0) && (
          <div className="bk-summary-compact-foot">
            {topSource && (
              <p className="bk-summary-compact-foot-line">
                <span className="bk-summary-compact-foot-label">Trusted source</span>
                {topSource.name} — {Math.round(topSource.rate * 100)}% of items opened or saved
              </p>
            )}
            {emergingTopics.length > 0 && (
              <p className="bk-summary-compact-foot-line">
                <span className="bk-summary-compact-foot-label">Emerging</span>
                {emergingTopics.join(" · ")}
                <span className="bk-summary-compact-foot-note"> — not in your declared interests</span>
              </p>
            )}
          </div>
        )}

        {topInsights.length === 0 && topicRows.length === 0 && !featuredThread && (
          <p className="bk-summary-hint">
            Save, skip, or open stories in read mode — Briefly learns what to prioritize next.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="bk-summary">
      <div className="bk-summary-head">
        <div>
          <p className="bk-summary-eyebrow">What Briefly knows</p>
          <h3 className="bk-summary-title">
            Day {intel.digest_day || 1}
            {streak > 1 ? ` · ${streak}-day streak` : ""}
          </h3>
        </div>
        <Link href="/intelligence" className="bk-summary-link">
          Full profile →
        </Link>
      </div>

      <div className="bk-summary-stats" aria-label="Reading signals">
        {engagement > 0 && (
          <div className="bk-summary-stat">
            <span className="bk-summary-stat-n">{engagement}%</span>
            <span className="bk-summary-stat-l">engaged</span>
          </div>
        )}
        {openRate > 0 && (
          <div className="bk-summary-stat">
            <span className="bk-summary-stat-n">{openRate}%</span>
            <span className="bk-summary-stat-l">opens</span>
          </div>
        )}
        {clickRate > 0 && (
          <div className="bk-summary-stat">
            <span className="bk-summary-stat-n">{clickRate}%</span>
            <span className="bk-summary-stat-l">clicks</span>
          </div>
        )}
        {stats.total_digests > 0 && engagement === 0 && openRate === 0 && (
          <div className="bk-summary-stat">
            <span className="bk-summary-stat-n">{stats.total_digests}</span>
            <span className="bk-summary-stat-l">briefings</span>
          </div>
        )}
      </div>

      {insights.length > 0 && (
        <div className="bk-summary-insights">
          {insights.slice(0, 2).map((insight) => (
            <div key={`${insight.type}-${insight.label}`} className="bk-summary-insight-card">
              <span className="bk-summary-insight-label">{insight.label}</span>
              <p className="bk-summary-insight-text">{insight.text}</p>
            </div>
          ))}
        </div>
      )}

      {topicBars.length > 0 && (
        <div className="bk-summary-topics">
          <p className="bk-summary-section-label">Strongest topics</p>
          <ul className="bk-summary-topic-bars">
            {topicBars.map(([topic, strength]) => (
              <li key={topic} className="bk-summary-topic-row">
                <span className="bk-summary-topic-name">{topic}</span>
                <span className="bk-summary-topic-track" aria-hidden>
                  <span
                    className="bk-summary-topic-fill"
                    style={{ width: `${Math.min(100, Math.round(strength * 100))}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bk-summary-foot">
        {interests.length > 0 && (
          <div className="bk-summary-foot-block">
            <p className="bk-summary-section-label">Tracking</p>
            <div className="bk-summary-chips">
              {interests.map((t) => (
                <span key={t} className="bk-summary-chip">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {(emerging.length > 0 || topSources.length > 0) && (
          <div className="bk-summary-foot-block">
            {emerging.length > 0 && (
              <>
                <p className="bk-summary-section-label">Emerging</p>
                <p className="bk-summary-emerging">{emerging.join(" · ")}</p>
              </>
            )}
            {topSources.length > 0 && (
              <>
                <p className="bk-summary-section-label">Top sources</p>
                <p className="bk-summary-sources">{topSources.join(" · ")}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
