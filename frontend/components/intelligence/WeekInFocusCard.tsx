"use client";

import Link from "next/link";
import type { WrappedAction, WrappedExample, WrappedShift, WrappedSnapshot, WrappedTopicRow } from "@/lib/api";
import { IntelSection } from "./IntelSection";

type Props = {
  wrapped: WrappedSnapshot;
  variant?: "teaser" | "full";
};

function depthTrendIcon(trend?: string) {
  if (trend === "deepening") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 19V5M7 10l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (trend === "shallowing") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 5v14M7 14l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function normalizeShifts(wrapped: WrappedSnapshot): WrappedShift[] {
  const raw = wrapped.shifts ?? wrapped.mind_shifts ?? [];
  return raw.map((s) => ({
    topic: s.topic,
    direction: s.direction,
    label: s.label ?? s.direction,
    detail: s.detail ?? s.evidence ?? "",
    examples: s.examples,
    action: s.action,
  }));
}

function normalizeTopics(
  primary: WrappedTopicRow[] | undefined,
  legacy: WrappedTopicRow[] | undefined,
): WrappedTopicRow[] {
  return primary ?? legacy ?? [];
}

function normalizeEmerging(wrapped: WrappedSnapshot): WrappedTopicRow[] {
  if (wrapped.emerging?.length) return wrapped.emerging;
  const raw = wrapped.emerging_threads ?? [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return { topic: entry, detail: "" };
      return {
        topic: entry.topic ?? "",
        detail: entry.detail ?? "",
        examples: entry.examples,
      };
    })
    .filter((e) => e.topic);
}

function normalizeUncovered(wrapped: WrappedSnapshot): WrappedTopicRow[] {
  if (wrapped.uncovered?.length) return wrapped.uncovered;
  return (wrapped.gaps ?? []).map((g) => ({
    topic: g.topic,
    detail: g.detail ?? "No matching stories in your brief lately",
    action: g.action ?? { label: "Add sources", href: "/settings" },
  }));
}

function ExampleStories({ examples }: { examples?: WrappedExample[] }) {
  if (!examples?.length) return null;
  return (
    <ul className="intel-doc-examples">
      {examples.map((ex) => (
        <li key={ex.headline} className="intel-doc-example">
          <span className="intel-doc-example-dot" aria-hidden />
          <span className="intel-doc-example-text">
            {ex.headline}
            {ex.source ? <span className="intel-doc-example-src"> · {ex.source}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TopicAction({ action }: { action?: WrappedAction }) {
  if (!action?.href) return null;
  return (
    <Link href={action.href} className="intel-doc-action">
      {action.label}
    </Link>
  );
}

function TopicSection({
  title,
  hint,
  items,
  rowClass,
  showExamples = true,
  showActions = true,
}: {
  title: string;
  hint?: string;
  items: WrappedTopicRow[] | WrappedShift[];
  rowClass: string;
  showExamples?: boolean;
  showActions?: boolean;
}) {
  if (!items.length) return null;
  return (
    <IntelSection title={title} hint={hint}>
      <ul className="intel-doc-rows">
        {items.map((item) => {
          const shift = item as WrappedShift;
          const isShift = Boolean(shift.direction);
          return (
            <li
              key={`${item.topic}-${shift.direction ?? "row"}`}
              className={`intel-doc-row ${rowClass}${isShift ? " intel-doc-row--shift" : ""}`}
            >
              <div className="intel-doc-row-top">
                <span className="intel-doc-row-name">{item.topic}</span>
                {isShift && (
                  <span className={`intel-doc-badge intel-doc-badge--${shift.direction || "stable"}`}>
                    {shift.label}
                  </span>
                )}
              </div>
              {item.detail && <p className="intel-doc-row-detail">{item.detail}</p>}
              {showExamples && <ExampleStories examples={item.examples} />}
              {showActions && <TopicAction action={item.action} />}
            </li>
          );
        })}
      </ul>
    </IntelSection>
  );
}

export function WeekInFocusCard({ wrapped, variant = "full" }: Props) {
  const isTeaser = variant === "teaser";
  const hints = wrapped.section_hints ?? {};

  const synthesis =
    wrapped.synthesis || wrapped.weekly_synthesis || wrapped.lead || "";
  const shifts = normalizeShifts(wrapped);
  const activeTopics = normalizeTopics(wrapped.active_topics, wrapped.high_engagement);
  const emerging = normalizeEmerging(wrapped);
  const uncovered = normalizeUncovered(wrapped);
  const ignored = wrapped.ignored ?? [];

  const visibleShifts = isTeaser ? shifts.slice(0, 1) : shifts;
  const visibleActive = isTeaser ? activeTopics.slice(0, 2) : activeTopics;
  const visibleIgnored = isTeaser ? ignored.slice(0, 1) : ignored;
  const visibleUncovered = isTeaser ? uncovered.slice(0, 2) : uncovered;
  const visibleEmerging = isTeaser ? emerging.slice(0, 1) : emerging;

  const hasMore =
    isTeaser &&
    (shifts.length > visibleShifts.length ||
      activeTopics.length > visibleActive.length ||
      ignored.length > visibleIgnored.length ||
      uncovered.length > visibleUncovered.length ||
      emerging.length > visibleEmerging.length);

  return (
    <div className={`intel-doc wif-card wif-card--${variant}`}>
      {(synthesis || wrapped.depth_label || wrapped.week_stats?.delta_label) && (
        <div className="intel-doc-lead">
          {synthesis && <p className="intel-doc-lead-text">{synthesis}</p>}
          <div className="intel-doc-lead-meta">
            {wrapped.week_stats?.delta_label && (
              <span className="intel-doc-pill">{wrapped.week_stats.delta_label}</span>
            )}
            {wrapped.depth_label && (
              <span className={`intel-doc-pill intel-doc-pill--${wrapped.depth_trend || "stable"}`}>
                <span className="intel-doc-pill-icon" aria-hidden>
                  {depthTrendIcon(wrapped.depth_trend)}
                </span>
                {wrapped.depth_label}
              </span>
            )}
          </div>
        </div>
      )}

      <TopicSection
        title="Active this week"
        hint={hints.active}
        items={visibleActive}
        rowClass="wif-topic-row--active"
        showExamples={!isTeaser}
        showActions={!isTeaser}
      />

      <TopicSection
        title="Shifting"
        hint={hints.shifting}
        items={visibleShifts}
        rowClass="wif-topic-row--shifting"
        showExamples={!isTeaser}
        showActions={!isTeaser}
      />

      <TopicSection
        title="Often skipped"
        hint={hints.ignored}
        items={visibleIgnored}
        rowClass="wif-topic-row--ignored"
        showExamples={!isTeaser}
        showActions
      />

      <TopicSection
        title="Thin coverage"
        hint={hints.uncovered}
        items={visibleUncovered}
        rowClass="wif-topic-row--uncovered"
        showExamples={false}
        showActions
      />

      {!isTeaser && (
        <TopicSection
          title="Worth watching"
          hint={hints.emerging}
          items={visibleEmerging}
          rowClass="wif-topic-row--emerging"
          showExamples
          showActions={false}
        />
      )}

      {isTeaser && hasMore && (
        <p className="intel-doc-teaser-more">
          <Link href="/intelligence#week-in-focus" className="intel-doc-teaser-link">
            See full week in focus →
          </Link>
        </p>
      )}
    </div>
  );
}
