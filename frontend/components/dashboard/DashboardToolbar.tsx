"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getTimeGreeting, type TimeGreeting } from "@/lib/greeting";

type DashboardToolbarProps = {
  name: string;
  dateLabel: string;
  itemCount: number | null;
  savedMinutes?: number | null;
  sourceCount: number;
  streak: number;
  digestId: string | null;
  generating: boolean;
  onRefresh?: () => void;
};

export function DashboardToolbar({
  name,
  dateLabel,
  itemCount,
  savedMinutes,
  sourceCount,
  streak,
  digestId,
  generating,
  onRefresh,
}: DashboardToolbarProps) {
  const [greeting, setGreeting] = useState<TimeGreeting | null>(null);

  useEffect(() => {
    setGreeting(getTimeGreeting());
  }, []);

  const hasBrief = Boolean(digestId && !generating && (itemCount ?? 0) > 0);
  const showStats = itemCount != null || sourceCount > 0;

  return (
    <header className="dash-toolbar">
      <div className="dash-toolbar-intro">
        <p className="dash-toolbar-eyebrow">{greeting?.briefingLabel ?? "Your outcome"}</p>
        <div className="dash-toolbar-heading-row">
          <h1 className="dash-toolbar-title">
            {greeting?.label ?? "Hello"}, {name}
          </h1>
          <span className="dash-toolbar-date">{dateLabel}</span>
        </div>
        {generating && (
          <p className="dash-toolbar-status">
            <span className="briefing-generating-dot" aria-hidden />
            Delivering your brief in the background…
          </p>
        )}
      </div>

      <div className="dash-toolbar-end">
        {showStats && (
          <ul className="dash-toolbar-stats" aria-label="Summary">
            {itemCount != null && (
              <li>
                <span className="dash-toolbar-stat-value">{itemCount}</span>
                <span className="dash-toolbar-stat-label">curated</span>
              </li>
            )}
            {savedMinutes != null && savedMinutes > 0 && (
              <li>
                <span className="dash-toolbar-stat-value">~{savedMinutes}m</span>
                <span className="dash-toolbar-stat-label">saved</span>
              </li>
            )}
            <li className="dash-toolbar-stat-hidden-mobile">
              <span className="dash-toolbar-stat-value">{sourceCount}</span>
              <span className="dash-toolbar-stat-label">sources</span>
            </li>
            {streak > 0 && (
              <li>
                <span className="dash-toolbar-stat-value">{streak}</span>
                <span className="dash-toolbar-stat-label">day streak</span>
              </li>
            )}
          </ul>
        )}

        <div className="dash-toolbar-actions">
          {hasBrief && digestId && (
            <Link href={`/dashboard/read/${digestId}`} className="dash-toolbar-primary">
              Read briefing
              <span className="dash-toolbar-primary-arrow" aria-hidden>→</span>
            </Link>
          )}
          {onRefresh && sourceCount > 0 && (
            <button
              type="button"
              className="dash-toolbar-secondary"
              onClick={onRefresh}
              disabled={generating}
            >
              {generating ? "Refreshing…" : "Refresh brief"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
