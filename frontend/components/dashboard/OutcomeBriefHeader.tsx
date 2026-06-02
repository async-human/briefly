"use client";

import type { DigestOutcome } from "@/lib/api";

type OutcomeBriefHeaderProps = {
  outcome: DigestOutcome | null;
  generating: boolean;
  itemCount: number;
  digestDate: string;
};

export function OutcomeBriefHeader({
  outcome,
  generating,
  itemCount,
  digestDate,
}: OutcomeBriefHeaderProps) {
  const saved = outcome?.saved_minutes;
  const filtered = outcome?.filtered_count ?? 0;
  const topics = outcome?.catch_up_topics ?? [];

  return (
    <div className="outcome-brief-header">
      <div className="outcome-brief-header-main">
        <p className="outcome-brief-eyebrow">Your intelligence outcome</p>
        <h2 className="outcome-brief-title">
          {generating ? "Updating your brief…" : "You're caught up for today"}
        </h2>
        <p className="outcome-brief-sub">
          {itemCount} curated {itemCount === 1 ? "item" : "items"} · {digestDate}
          {topics.length > 0 && !generating && (
            <> · tracking {topics.slice(0, 2).join(", ")}{topics.length > 2 ? "…" : ""}</>
          )}
        </p>
      </div>
      {saved != null && saved > 0 && (
        <div className="outcome-brief-stats" aria-label="Briefing value">
          <div className="outcome-stat-card outcome-stat-card-primary">
            <span className="outcome-stat-value">~{saved}</span>
            <span className="outcome-stat-label">min saved</span>
          </div>
          {filtered > 0 && (
            <div className="outcome-stat-card">
              <span className="outcome-stat-value">{filtered}</span>
              <span className="outcome-stat-label">filtered for you</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type SafeToIgnoreProps = {
  skippedNote?: string;
  skippedItems: Array<{ title: string; source: string; reason: string }>;
  filteredCount: number;
};

export function SafeToIgnorePanel({
  skippedNote,
  skippedItems,
  filteredCount,
}: SafeToIgnoreProps) {
  if (!skippedNote && skippedItems.length === 0 && filteredCount <= 0) return null;

  return (
    <details className="outcome-safe-ignore">
      <summary>
        Safe to ignore
        {filteredCount > 0 && (
          <span className="outcome-safe-ignore-count">{filteredCount} items</span>
        )}
      </summary>
      <div className="outcome-safe-ignore-body">
        {skippedNote && <p className="outcome-safe-ignore-note">{skippedNote}</p>}
        {skippedItems.length > 0 && (
          <ul className="outcome-safe-ignore-list">
            {skippedItems.slice(0, 8).map((item) => (
              <li key={`${item.title}-${item.source}`}>
                <span className="outcome-safe-ignore-item-title">{item.title}</span>
                <span className="outcome-safe-ignore-item-reason">{item.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
