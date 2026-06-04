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
    <header className="dash-toolbar">
      <div className="dash-toolbar-intro">
        <div className="dash-toolbar-heading-row">
          <h1 className="dash-toolbar-title">
            {greeting?.label ?? "Hello"}, {name}
          </h1>
          <span className="dash-toolbar-date">{dateLabel}</span>
        </div>
        {generating && (
          <p className="dash-toolbar-status">
            <span className="briefing-generating-dot" aria-hidden />
            Your brief is being prepared
          </p>
        )}
      </div>

      <div className="dash-toolbar-end">
        {!generating && (itemCount != null || sourceCount > 0 || streak > 0) && (
          <p className="dash-toolbar-meta">
            {itemCount != null && (
              <span>
                <strong>{itemCount}</strong>
                {itemCount === 1 ? " item" : " items"}
              </span>
            )}
            {savedMinutes != null && savedMinutes > 0 && (
              <span>
                {itemCount != null ? " · " : ""}
                ~<strong>{savedMinutes}</strong> min saved
              </span>
            )}
            {sourceCount > 0 && (
              <span>
                {(itemCount != null || (savedMinutes != null && savedMinutes > 0)) ? " · " : ""}
                <strong>{sourceCount}</strong>
                {sourceCount === 1 ? " source" : " sources"}
              </span>
            )}
            {streak > 0 && (
              <span>
                {" · "}
                <strong>{streak}</strong>-day streak
                {streak >= 7 ? " 🔥" : ""}
              </span>
            )}
          </p>
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
              {generating ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
