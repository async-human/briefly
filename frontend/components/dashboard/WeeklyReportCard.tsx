"use client";

import { useEffect, useState } from "react";
import { api, type WeeklyReport } from "@/lib/api";

export function WeeklyReportCard() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.getWeeklyReport()
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !report) return null;

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

      {open && (
        <div className="weekly-report-body">
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
        </div>
      )}
    </section>
  );
}
