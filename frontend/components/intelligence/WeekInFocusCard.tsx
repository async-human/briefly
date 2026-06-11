"use client";

import Link from "next/link";
import type { WrappedAction, WrappedExample, WrappedShift, WrappedSnapshot, WrappedTopicRow } from "@/lib/api";

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
    <ul className="wif-examples">
      {examples.map((ex) => (
        <li key={ex.headline} className="wif-example">
          <span className="wif-example-dot" aria-hidden />
          <span className="wif-example-text">
            {ex.headline}
            {ex.source ? <span className="wif-example-src"> · {ex.source}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TopicAction({ action }: { action?: WrappedAction }) {
  if (!action?.href) return null;
  return (
    <Link href={action.href} className="wif-action-link">
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
    <section className="intel-wrapped-section">
      <div className="wif-section-head">
        <h4 className="intel-wrapped-section-title">{title}</h4>
        {hint && <p className="wif-section-hint">{hint}</p>}
      </div>
      <ul className="wif-topic-list">
        {items.map((item) => {
          const shift = item as WrappedShift;
          const isShift = Boolean(shift.direction);
          return (
            <li
              key={`${item.topic}-${shift.direction ?? "row"}`}
              className={`wif-topic-row ${rowClass}${isShift ? " wif-topic-row--shift" : ""}`}
            >
              <div className="wif-topic-main">
                <div className="wif-topic-top">
                  <span className="wif-topic-name">{item.topic}</span>
                  {isShift && (
                    <span className={`intel-shift-badge intel-shift-badge--${shift.direction || "stable"}`}>
                      {shift.label}
                    </span>
                  )}
                  {!isShift && item.detail && (
                    <span className="wif-topic-meta">{item.detail}</span>
                  )}
                </div>
                {isShift && item.detail && <p className="wif-topic-detail">{item.detail}</p>}
                {showExamples && <ExampleStories examples={item.examples} />}
                {showActions && <TopicAction action={item.action} />}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
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
    <div className={`wif-card wif-card--${variant}`}>
      {(synthesis || wrapped.depth_label || wrapped.week_stats?.delta_label) && (
        <div className="wif-hero">
          {synthesis && <p className="wif-synthesis">{synthesis}</p>}
          <div className="wif-hero-meta">
            {wrapped.week_stats?.delta_label && (
              <span className="wif-week-stat">{wrapped.week_stats.delta_label}</span>
            )}
            {wrapped.depth_label && (
              <span className={`intel-depth-pill intel-depth-pill--${wrapped.depth_trend || "stable"}`}>
                <span className="intel-depth-pill-icon" aria-hidden>
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
        <p className="wif-teaser-more">
          <Link href="/intelligence#week-in-focus" className="wif-teaser-link">
            See full week in focus →
          </Link>
        </p>
      )}
    </div>
  );
}
