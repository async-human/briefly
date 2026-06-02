"use client";

import { useState } from "react";
import type { BonusItem, DigestOutcome, SkippedItem } from "@/lib/api";

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
              <span className="outcome-stat-label">also matched</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type SafeToIgnoreProps = {
  skippedNote?: string;
  skippedItems: SkippedItem[];   // backward compat — truly blocked items
  blockedItems?: SkippedItem[];  // explicitly rejected: never_show, low_relevance
  moreToday?: BonusItem[];       // good fit, cut for daily length cap
  filteredCount: number;
};

export function SafeToIgnorePanel({
  skippedNote,
  skippedItems,
  blockedItems,
  moreToday,
  filteredCount,
}: SafeToIgnoreProps) {
  const [moreTodayOpen, setMoreTodayOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);

  // Prefer explicit blocked list; fall back to the old merged skipped list
  const blocked = blockedItems ?? skippedItems;
  const bonus = moreToday ?? [];

  const hasBonus = bonus.length > 0;
  const hasBlocked = blocked.length > 0 || !!skippedNote;

  if (!hasBonus && !hasBlocked && filteredCount <= 0) return null;

  return (
    <div className="outcome-safe-ignore">

      {/* ── More from today — good-fit articles that didn't make the cut ── */}
      {hasBonus && (
        <div className="outcome-more-today">
          <button
            type="button"
            className="outcome-more-today-toggle"
            onClick={() => setMoreTodayOpen((v) => !v)}
            aria-expanded={moreTodayOpen}
          >
            <span className="outcome-more-today-heading">
              More from today
              <span className="outcome-more-today-sub">
                {bonus.length} articles that also scored well — didn&apos;t make today&apos;s {
                  /* show item cap dynamically */
                  filteredCount > 0
                    ? `top ${filteredCount > 0 ? bonus.length + filteredCount : bonus.length} cut`
                    : "cut"
                }
              </span>
            </span>
            <span className="outcome-more-today-chevron" aria-hidden>
              {moreTodayOpen ? "▴" : "▾"}
            </span>
          </button>

          {moreTodayOpen && (
            <div className="outcome-more-today-list">
              {bonus.map((item, i) => (
                <div key={i} className="outcome-more-today-item">
                  <div className="outcome-more-today-body">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="outcome-more-today-title"
                      >
                        {item.title}
                      </a>
                    ) : (
                      <span className="outcome-more-today-title outcome-more-today-title-plain">
                        {item.title}
                      </span>
                    )}
                    {item.source && (
                      <span className="outcome-more-today-source">{item.source}</span>
                    )}
                  </div>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="outcome-more-today-link"
                      aria-label={`Read ${item.title}`}
                    >
                      →
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── What Briefly actually filtered — low relevance, blocked topics ── */}
      {hasBlocked && (
        <details
          className="outcome-blocked"
          onToggle={(e) => setBlockedOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="outcome-blocked-summary">
            What Briefly filtered
            {blocked.length > 0 && (
              <span className="outcome-safe-ignore-count">{blocked.length} items</span>
            )}
          </summary>
          <div className="outcome-safe-ignore-body">
            {skippedNote && <p className="outcome-safe-ignore-note">{skippedNote}</p>}
            {blocked.length > 0 && (
              <ul className="outcome-safe-ignore-list outcome-safe-ignore-scroll">
                {blocked.map((item) => (
                  <li key={`${item.title}-${item.source}`}>
                    <span className="outcome-safe-ignore-item-title">{item.title}</span>
                    <span className="outcome-safe-ignore-item-reason">{item.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
