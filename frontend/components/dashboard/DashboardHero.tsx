"use client";

import Link from "next/link";
import { TimeGreetingHero } from "@/components/TimeGreeting";

type DashboardHeroProps = {
  name: string;
  dateLabel: string;
  itemCount: number | null;
  sourceCount: number;
  streak: number;
  digestId: string | null;
  generating: boolean;
};

export function DashboardHero({
  name,
  dateLabel,
  itemCount,
  sourceCount,
  streak,
  digestId,
  generating,
}: DashboardHeroProps) {
  const hasBrief = digestId && !generating && (itemCount ?? 0) > 0;

  return (
    <header className="dash-hero dash-hero-v2">
      <div className="dash-hero-main">
        <TimeGreetingHero name={name} />
        <p className="dash-hero-date">{dateLabel}</p>

        {generating && (
          <p className="dash-hero-status">
            <span className="briefing-generating-dot" />
            Preparing your briefing…
          </p>
        )}

        {hasBrief && (
          <Link href={`/dashboard/read/${digestId}`} className="dash-hero-cta">
            Read today&apos;s brief
            <span className="dash-hero-cta-arrow" aria-hidden>→</span>
          </Link>
        )}

        {!generating && !hasBrief && sourceCount === 0 && (
          <p className="dash-hero-hint">Add a source below to get your first briefing.</p>
        )}
      </div>

      {(itemCount != null || sourceCount > 0) && (
        <ul className="dash-hero-stats" aria-label="Summary">
          {itemCount != null && (
            <li>
              <span className="dash-hero-stat-value">{itemCount}</span>
              <span className="dash-hero-stat-label">items today</span>
            </li>
          )}
          <li>
            <span className="dash-hero-stat-value">{sourceCount}</span>
            <span className="dash-hero-stat-label">sources</span>
          </li>
          {streak > 0 && (
            <li>
              <span className="dash-hero-stat-value">{streak}</span>
              <span className="dash-hero-stat-label">day streak</span>
            </li>
          )}
        </ul>
      )}
    </header>
  );
}
