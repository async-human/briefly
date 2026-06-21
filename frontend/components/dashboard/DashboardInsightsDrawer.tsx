"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Digest, ProfileIntelligence } from "@/lib/api";
import { BrieflyKnowsSummary } from "@/components/dashboard/BrieflyKnowsSummary";
import { StoryThreadsRail } from "@/components/dashboard/StoryThreadsRail";
import { SerendipityPanel } from "@/components/dashboard/SerendipityPanel";
import { IntelligenceBriefingPanel } from "@/components/dashboard/IntelligenceBriefingPanel";
import { WeeklyReportCard } from "@/components/dashboard/WeeklyReportCard";
import { DashboardAccordion } from "@/components/dashboard/DashboardAccordion";
import { getBrieflyKnowsTeaser } from "@/lib/brieflyKnows";

const STORAGE_KEY = "briefly:dash-insights-open";

type Props = {
  intel: ProfileIntelligence | null;
  digest: Digest | null;
  streak: number;
  declaredInterests: string[];
};

function buildSummaryChips(intel: ProfileIntelligence | null, digest: Digest | null): string[] {
  const chips: string[] = [];
  const wrapped = digest?.meta?.wrapped;
  if (wrapped?.synthesis || wrapped?.weekly_synthesis || wrapped?.shifts?.length) {
    chips.push("Week in focus");
  }
  if ((intel?.active_threads?.length ?? 0) > 0) {
    chips.push(`${intel!.active_threads!.length} thread${intel!.active_threads!.length === 1 ? "" : "s"}`);
  }
  if ((digest?.meta?.serendipity?.length ?? 0) > 0) {
    chips.push(`${digest!.meta!.serendipity!.length} connection${digest!.meta!.serendipity!.length === 1 ? "" : "s"}`);
  }
  if ((digest?.meta?.calendar?.meetings?.length ?? 0) > 0) {
    chips.push("Meetings");
  }
  if ((digest?.meta?.blind_spots?.length ?? 0) > 0) {
    chips.push("Blind spots");
  }
  if (intel && intel.digest_day > 0) {
    chips.push("Your patterns");
  }
  return chips.slice(0, 4);
}

export function DashboardInsightsDrawer({
  intel,
  digest,
  streak,
  declaredInterests,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const chips = useMemo(() => buildSummaryChips(intel, digest), [intel, digest]);

  const hasWeekFocus = Boolean(
    digest?.meta?.wrapped &&
      (digest.meta.wrapped.synthesis ||
        digest.meta.wrapped.weekly_synthesis ||
        digest.meta.wrapped.shifts?.length ||
        digest.meta.wrapped.active_topics?.length),
  );
  const hasThreads = (intel?.active_threads?.length ?? 0) > 0;
  const hasConnections = (digest?.meta?.serendipity?.length ?? 0) > 0;
  const hasMeetings = (digest?.meta?.calendar?.meetings?.length ?? 0) > 0;
  const hasBlindSpots = (digest?.meta?.blind_spots?.length ?? 0) > 0;
  const hasIntel = Boolean(intel && intel.digest_day > 0);

  const hasContent =
    hasWeekFocus || hasThreads || hasConnections || hasMeetings || hasBlindSpots || hasIntel;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setExpanded(true);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  function toggle() {
    setExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  if (!hasContent) return null;

  const inBriefContentIds = new Set(
    (digest?.items ?? [])
      .map((item) => item.content_id)
      .filter((id): id is string => Boolean(id)),
  );

  const defaultFirst = hasWeekFocus || hasIntel;

  return (
    <section className="dash-insights-drawer" aria-label="Intelligence and connections">
      <button
        type="button"
        className="dash-insights-drawer-trigger"
        aria-expanded={expanded}
        onClick={toggle}
      >
        <div className="dash-insights-drawer-trigger-main">
          <span className="dash-insights-drawer-eyebrow">Beyond today&apos;s brief</span>
          <span className="dash-insights-drawer-title">
            {expanded ? "Intelligence & connections" : "Explore patterns, threads, and connections"}
          </span>
          {!expanded && chips.length > 0 && (
            <span className="dash-insights-drawer-chips">
              {chips.map((chip) => (
                <span key={chip} className="dash-insights-drawer-chip">
                  {chip}
                </span>
              ))}
            </span>
          )}
        </div>
        <span className="dash-insights-drawer-chevron" aria-hidden>
          {expanded ? "−" : "+"}
        </span>
      </button>

      {hydrated && expanded && (
        <div className="dash-insights-drawer-body">
          <p className="dash-insights-drawer-intro">
            Optional depth — your briefing above is complete. Expand a section when you want more context.
          </p>

          {hasWeekFocus && digest?.meta?.wrapped && (
            <DashboardAccordion
              id="week-in-focus"
              title="Your week in focus"
              description={digest.meta.wrapped.synthesis?.slice(0, 72) ?? "Attention patterns this week"}
              defaultOpen={defaultFirst}
            >
              <IntelligenceBriefingPanel wrapped={digest.meta.wrapped} embedded />
            </DashboardAccordion>
          )}

          {hasIntel && intel && (
            <DashboardAccordion
              id="knows"
              title="What Briefly knows"
              description={getBrieflyKnowsTeaser(intel, streak)}
              defaultOpen={!hasWeekFocus}
            >
              <BrieflyKnowsSummary
                intel={intel}
                streak={streak}
                declaredInterests={declaredInterests}
                variant="compact"
              />
            </DashboardAccordion>
          )}

          {hasThreads && intel && (
            <DashboardAccordion
              id="threads"
              title="Story threads"
              description={`${intel.active_threads!.length} active`}
            >
              <StoryThreadsRail threads={intel.active_threads ?? []} />
            </DashboardAccordion>
          )}

          {hasConnections && digest && (
            <DashboardAccordion
              id="connections"
              title="Connections"
              description="How stories link across your reading"
            >
              <SerendipityPanel
                connections={digest.meta!.serendipity!}
                digestId={digest.id}
                inBriefContentIds={inBriefContentIds}
              />
            </DashboardAccordion>
          )}

          {hasMeetings && digest?.meta?.calendar && (
            <DashboardAccordion id="meetings" title="Today's meetings" description="Matched to your calendar">
              <IntelligenceBriefingPanel calendar={digest.meta.calendar} embedded />
            </DashboardAccordion>
          )}

          {hasBlindSpots && digest?.meta?.blind_spots && (
            <DashboardAccordion id="blind-spots" title="Blind spots" description="Perspectives you might miss">
              <IntelligenceBriefingPanel blindSpots={digest.meta.blind_spots} embedded />
            </DashboardAccordion>
          )}

          {!hasWeekFocus && (
            <DashboardAccordion
              id="week-patterns"
              title="Your week in focus"
              description="Topics, skips, and shifts from your reading"
              defaultOpen={defaultFirst}
            >
              <WeeklyReportCard embedded intel={intel} wrapped={digest?.meta?.wrapped} />
            </DashboardAccordion>
          )}

          <p className="dash-insights-drawer-foot">
            <Link href="/intelligence" className="dash-insights-drawer-link">
              Open full intelligence profile →
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}
