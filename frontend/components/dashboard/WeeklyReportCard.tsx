"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type ProfileIntelligence, type WeeklyReport, type WrappedSnapshot } from "@/lib/api";
import { WeekInFocusCard } from "@/components/intelligence/WeekInFocusCard";
import {
  buildWrappedFromIntel,
  hasWrappedContent,
  isGenericWeeklyCopy,
} from "@/lib/weekInFocus";

type WeeklyReportCardProps = {
  embedded?: boolean;
  wrapped?: WrappedSnapshot | null;
  intel?: ProfileIntelligence | null;
};

const GENERIC_OBSERVATIONS = new Set(["Consistently engaged", "Engaged recently"]);

function WeeklyReportFallback({ report }: { report: WeeklyReport }) {
  const lead =
    report.thinking_shift && !isGenericWeeklyCopy(report.thinking_shift)
      ? report.thinking_shift
      : null;

  const topics = (report.top_topics ?? []).filter(
    (t) => t.topic && !GENERIC_OBSERVATIONS.has(t.observation),
  );

  const hasStats = report.stories_read > 0 || Boolean(report.top_source);

  if (!lead && topics.length === 0 && !report.building_thread && !report.blind_spot && !hasStats) {
    return (
      <div className="weekly-report-empty">
        <p className="weekly-report-empty-title">Patterns still forming</p>
        <p className="weekly-report-empty-desc">
          Open a few more briefs this week — Briefly will surface topic shifts, skips, and coverage
          gaps here.
        </p>
      </div>
    );
  }

  return (
    <div className="weekly-report-body">
      {lead && <p className="weekly-report-lead">{lead}</p>}

      {hasStats && (
        <div className="weekly-report-stat-row">
          {report.stories_read > 0 && (
            <span className="weekly-report-stat-pill">{report.stories_read} stories read</span>
          )}
          {report.top_source && (
            <span className="weekly-report-stat-pill">Top source: {report.top_source}</span>
          )}
        </div>
      )}

      {topics.length > 0 && (
        <ul className="weekly-report-topics">
          {topics.slice(0, 4).map((t) => (
            <li key={t.topic} className="weekly-report-topic">
              <span className="weekly-report-topic-name">{t.topic}</span>
              <span className="weekly-report-topic-detail">{t.observation}</span>
            </li>
          ))}
        </ul>
      )}

      {report.building_thread && (
        <div className="weekly-report-callout weekly-report-callout--thread">
          <span className="weekly-report-label">Building thread</span>
          <p>{report.building_thread}</p>
        </div>
      )}

      {report.blind_spot && (
        <div className="weekly-report-callout weekly-report-callout--blind">
          <span className="weekly-report-label">Heads up</span>
          <p>{report.blind_spot}</p>
        </div>
      )}

      <p className="weekly-report-foot">
        <Link href="/intelligence#week-in-focus" className="weekly-report-foot-link">
          Full intelligence profile →
        </Link>
      </p>
    </div>
  );
}

export function WeeklyReportCard({
  embedded = false,
  wrapped: wrappedProp,
  intel,
}: WeeklyReportCardProps) {
  const [wrapped, setWrapped] = useState<WrappedSnapshot | null>(() =>
    wrappedProp && hasWrappedContent(wrappedProp) ? wrappedProp : null,
  );
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(() => !(wrappedProp && hasWrappedContent(wrappedProp)));
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (wrappedProp && hasWrappedContent(wrappedProp)) {
      setWrapped(wrappedProp);
      setReport(null);
      setEmpty(false);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setEmpty(false);
      setWrapped(null);
      setReport(null);

      try {
        const wif = await api.getWeekInFocus();
        if (!cancelled && hasWrappedContent(wif)) {
          setWrapped(wif);
          return;
        }
      } catch {
        /* fall through */
      }

      if (intel && !cancelled) {
        const built = buildWrappedFromIntel(intel);
        if (built && hasWrappedContent(built)) {
          setWrapped(built);
          return;
        }
      }

      try {
        const data = await api.getWeeklyReport();
        if (cancelled) return;
        setReport(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setEmpty(true);
        } else {
          setError(err instanceof Error ? err.message : "Could not load weekly patterns");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [wrappedProp, intel]);

  if (loading) {
    return <p className="weekly-report-placeholder">Loading your week in focus…</p>;
  }

  if (error) {
    return (
      <div className="weekly-report-empty">
        <p className="weekly-report-empty-title">Could not load patterns</p>
        <p className="weekly-report-empty-desc">{error}</p>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="weekly-report-empty">
        <p className="weekly-report-empty-title">Not enough history yet</p>
        <p className="weekly-report-empty-desc">
          Briefly builds this from your briefings and reading signals. After a few days of briefs,
          you&apos;ll see active topics, skips, and coverage gaps here.
        </p>
      </div>
    );
  }

  if (wrapped) {
    return (
      <section className={`weekly-report-card${embedded ? " weekly-report-card--embedded" : ""}`}>
        <WeekInFocusCard wrapped={wrapped} variant="teaser" />
      </section>
    );
  }

  if (report) {
    return (
      <section className={`weekly-report-card${embedded ? " weekly-report-card--embedded" : ""}`}>
        <WeeklyReportFallback report={report} />
      </section>
    );
  }

  return null;
}
