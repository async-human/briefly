"use client";

import Link from "next/link";
import type { ProfileIntelligence } from "@/lib/api";

type Props = {
  intel: ProfileIntelligence;
  streak: number;
  declaredInterests: string[];
};

function pct(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value <= 1 ? value * 100 : value);
}

export function BrieflyKnowsSummary({ intel, streak, declaredInterests }: Props) {
  const insights = intel.behavioral?.insights ?? [];
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
        <Link href="/settings" className="bk-summary-link">
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
