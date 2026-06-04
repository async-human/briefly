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

  return (
    <header className="dash-page-header">
      <div className="dash-page-header-main">
        <p className="dash-page-eyebrow">{greeting?.briefingLabel ?? "Today"}</p>
        <h1 className="dash-page-title">
          {greeting?.label ?? "Hello"}, {name}
        </h1>
        <p className="dash-page-subtitle">{dateLabel}</p>
        {generating && (
          <p className="dash-page-status">
            <span className="dash-page-status-dot" aria-hidden />
            Preparing your briefing
          </p>
        )}
      </div>

      <div className="dash-page-header-actions">
        {hasBrief && digestId && (
          <Link href={`/dashboard/read/${digestId}`} className="dash-btn dash-btn-primary">
            Open briefing
          </Link>
        )}
        {onRefresh && sourceCount > 0 && (
          <button
            type="button"
            className="dash-btn dash-btn-secondary"
            onClick={onRefresh}
            disabled={generating}
          >
            {generating ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      {!generating && (itemCount != null || sourceCount > 0 || streak > 0) && (
        <ul className="dash-stat-row" aria-label="Summary">
          {itemCount != null && (
            <li className="dash-stat-chip">
              <span className="dash-stat-value">{itemCount}</span>
              <span className="dash-stat-label">In brief</span>
            </li>
          )}
          {savedMinutes != null && savedMinutes > 0 && (
            <li className="dash-stat-chip">
              <span className="dash-stat-value">~{savedMinutes}m</span>
              <span className="dash-stat-label">Saved</span>
            </li>
          )}
          {sourceCount > 0 && (
            <li className="dash-stat-chip">
              <span className="dash-stat-value">{sourceCount}</span>
              <span className="dash-stat-label">Sources</span>
            </li>
          )}
          {streak > 0 && (
            <li className="dash-stat-chip dash-stat-chip-accent">
              <span className="dash-stat-value">{streak}</span>
              <span className="dash-stat-label">Day streak</span>
            </li>
          )}
        </ul>
      )}
    </header>
  );
}
