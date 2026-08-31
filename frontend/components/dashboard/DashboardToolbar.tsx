"use client";

import { AppPageHeader } from "./AppPageHeader";

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
  sourceCount,
  generating,
  onRefresh,
}: DashboardToolbarProps) {
  const hasRefresh = Boolean(onRefresh && sourceCount > 0);

  if (!hasRefresh && !generating) {
    return <h1 className="sr-only">Dashboard</h1>;
  }

  return (
    <AppPageHeader
      compact
      title="Dashboard"
      status={
        generating ? (
          <p className="dash-page-status">
            <span className="dash-page-status-dot" aria-hidden />
            Preparing your briefing
          </p>
        ) : undefined
      }
      actions={
        hasRefresh ? (
          <button
            type="button"
            className={`dash-btn dash-btn-secondary${generating ? " dash-btn-loading" : ""}`}
            onClick={onRefresh}
            disabled={generating}
          >
            {generating && <span className="dash-btn-spinner" aria-hidden />}
            {generating ? "Refreshing…" : "Refresh"}
          </button>
        ) : undefined
      }
    />
  );
}
