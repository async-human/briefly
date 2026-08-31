"use client";

import Link from "next/link";
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
  itemCount,
  savedMinutes,
  sourceCount,
  digestId,
  generating,
  onRefresh,
}: DashboardToolbarProps) {
  const hasBrief = Boolean(digestId && !generating && (itemCount ?? 0) > 0);

  const stats = !generating
    ? [
        ...(savedMinutes != null && savedMinutes > 0
          ? [{ value: `~${savedMinutes}m`, label: "reading distilled" }]
          : []),
      ]
    : [];

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
        <>
          {hasBrief && digestId && (
            <Link href={`/dashboard/read/${digestId}`} className="dash-btn dash-btn-primary">
              Open briefing
            </Link>
          )}
          {onRefresh && sourceCount > 0 && (
            <button
              type="button"
              className={`dash-btn dash-btn-secondary${generating ? " dash-btn-loading" : ""}`}
              onClick={onRefresh}
              disabled={generating}
            >
              {generating && <span className="dash-btn-spinner" aria-hidden />}
              {generating ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </>
      }
      stats={stats}
    />
  );
}
