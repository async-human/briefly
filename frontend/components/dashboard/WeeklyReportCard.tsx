"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type WeeklyReport } from "@/lib/api";

type WeeklyReportCardProps = {
  embedded?: boolean;
};

export function WeeklyReportCard({ embedded = false }: WeeklyReportCardProps) {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(embedded);

  useEffect(() => {
    api.getWeeklyReport()
      .then((data) => {
        setReport(data);
        setEmpty(false);
      })
      .catch((err) => {
        setReport(null);
        if (err instanceof ApiError && err.status === 404) {
          setEmpty(true);
          setError("");
        } else {
          setEmpty(false);
          setError(err instanceof Error ? err.message : "Could not load weekly report");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="weekly-report-placeholder">Preparing your weekly intelligence…</p>;
  }

  if (empty) {
    return (
      <div className="weekly-report-empty">
        <p className="weekly-report-empty-title">Not enough history yet</p>
        <p className="weekly-report-empty-desc">
          Briefly builds this recap from your briefings and reading patterns. Open a few
          more daily briefs — usually after 3–5 stories — and check back here.
        </p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="weekly-report-empty">
        <p className="weekly-report-empty-title">Could not load report</p>
        <p className="weekly-report-empty-desc">{error || "Try refreshing the page."}</p>
      </div>
    );
  }

  const body = (
    <div className="weekly-report-body">
      {report.thinking_shift && (
        <p className="weekly-report-lead">{report.thinking_shift}</p>
      )}
      {report.top_topics?.slice(0, 3).map((t) => (
        <div key={t.topic} className="weekly-report-topic">
          <strong>{t.topic}</strong>
          <p>{t.observation}</p>
        </div>
      ))}
      {report.building_thread && (
        <p className="weekly-report-thread">
          <span className="weekly-report-label">Building thread</span>
          {report.building_thread}
        </p>
      )}
      {report.blind_spot && (
        <p className="weekly-report-blind">
          <span className="weekly-report-label">Heads up</span>
          {report.blind_spot}
        </p>
      )}
      {(report.stories_read > 0 || report.top_source) && (
        <p className="weekly-report-stats">
          {report.stories_read > 0 && (
            <span>{report.stories_read} stories this period</span>
          )}
          {report.stories_read > 0 && report.top_source && <span aria-hidden> · </span>}
          {report.top_source && <span>Top source: {report.top_source}</span>}
        </p>
      )}
    </div>
  );

  if (embedded) {
    return (
      <section className="weekly-report-card weekly-report-card--embedded">
        <p className="weekly-report-eyebrow">Week {report.week_number} intelligence</p>
        {body}
      </section>
    );
  }

  return (
    <section className="weekly-report-card">
      <button
        type="button"
        className="weekly-report-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div>
          <p className="weekly-report-eyebrow">Week {report.week_number} intelligence</p>
          <p className="weekly-report-title">{report.thinking_shift}</p>
        </div>
        <span className="weekly-report-chevron" aria-hidden>{open ? "−" : "+"}</span>
      </button>
      {open && body}
    </section>
  );
}
