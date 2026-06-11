"use client";

import type { WrappedShift, WrappedSnapshot, WrappedTopic } from "@/lib/api";

export type CalendarMeeting = {
  title: string;
  time: string;
  attendees?: string[];
  relevant_stories?: { headline: string; source?: string }[];
  active_threads?: string[];
};

export type CalendarBriefing = {
  meetings: CalendarMeeting[];
  meeting_count?: number;
};

export type BlindSpot = {
  type: string;
  topic: string;
  consensus: string;
  counter_headline?: string | null;
  counter_source?: string | null;
  counter_argument?: string | null;
};

export type { WrappedShift, WrappedSnapshot, WrappedTopic };

type Props = {
  calendar?: CalendarBriefing | null;
  wrapped?: WrappedSnapshot | null;
  blindSpots?: BlindSpot[];
};

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 3l1.8 5.5L19 10l-5.2 1.5L12 17l-1.8-5.5L5 10l5.2-1.5L12 3z" strokeLinejoin="round" />
    </svg>
  );
}

function LensIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l5 5" strokeLinecap="round" />
      <path d="M8 11h6M11 8v6" strokeLinecap="round" opacity="0.5" />
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
  }));
}

function normalizeTopics(
  primary: WrappedTopic[] | undefined,
  legacy: WrappedTopic[] | undefined,
): WrappedTopic[] {
  return primary ?? legacy ?? [];
}

function normalizeEmerging(wrapped: WrappedSnapshot): WrappedTopic[] {
  if (wrapped.emerging?.length) return wrapped.emerging;
  const raw = wrapped.emerging_threads ?? [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return { topic: entry, detail: "" };
      return { topic: entry.topic ?? "", detail: entry.detail ?? "" };
    })
    .filter((e) => e.topic);
}

function normalizeGaps(wrapped: WrappedSnapshot): WrappedTopic[] {
  if (wrapped.gaps?.length) return wrapped.gaps;
  return (wrapped.coverage_gaps ?? []).map((topic) => ({
    topic,
    detail: "No matching stories in your brief lately",
  }));
}

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

export function IntelligenceBriefingPanel({ calendar, wrapped, blindSpots = [] }: Props) {
  const meetings = calendar?.meetings ?? [];
  const hasCalendar = meetings.length > 0;

  const shifts = wrapped ? normalizeShifts(wrapped) : [];
  const activeTopics = wrapped ? normalizeTopics(wrapped.active_topics, wrapped.high_engagement) : [];
  const emerging = wrapped ? normalizeEmerging(wrapped) : [];
  const gaps = wrapped ? normalizeGaps(wrapped) : [];

  const lead =
    wrapped?.lead ||
    (wrapped?.current_focus ? `This week: ${wrapped.current_focus}` : "");

  const hasWrapped = Boolean(
    wrapped &&
      (lead ||
        shifts.length > 0 ||
        activeTopics.length > 0 ||
        emerging.length > 0 ||
        gaps.length > 0 ||
        wrapped.weekly_synthesis ||
        wrapped.depth_label),
  );
  const hasBlindSpots = blindSpots.length > 0;

  if (!hasCalendar && !hasWrapped && !hasBlindSpots) return null;

  return (
    <section className="intelligence-briefing-panel" aria-label="Intelligence layer">
      {hasCalendar && (
        <article className="intel-card intel-card-calendar">
          <header className="intel-card-head">
            <span className="intel-card-icon" aria-hidden>
              <CalendarIcon />
            </span>
            <div className="intel-card-head-text">
              <h3 className="intel-card-title">Today&apos;s meetings</h3>
              <p className="intel-card-desc">Stories in your brief matched to your calendar</p>
            </div>
          </header>
          <ul className="intel-meeting-list">
            {meetings.map((m) => (
              <li key={`${m.time}-${m.title}`} className="intel-meeting-card">
                <div className="intel-meeting-time-pill">{m.time}</div>
                <div className="intel-meeting-body">
                  <p className="intel-meeting-title">{m.title}</p>
                  {m.attendees && m.attendees.length > 0 && (
                    <p className="intel-meeting-attendees">with {m.attendees.slice(0, 3).join(", ")}</p>
                  )}
                  {m.relevant_stories && m.relevant_stories.length > 0 && (
                    <ul className="intel-meeting-stories">
                      {m.relevant_stories.map((s) => (
                        <li key={s.headline}>
                          <span className="intel-meeting-story-dot" aria-hidden />
                          {s.headline}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.active_threads && m.active_threads.length > 0 && (
                    <p className="intel-meeting-threads">
                      <span className="intel-meeting-threads-label">Threads</span>
                      {m.active_threads.join(" · ")}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </article>
      )}

      {hasWrapped && wrapped && (
        <article className="intel-card intel-card-wrapped">
          <header className="intel-card-head">
            <span className="intel-card-icon" aria-hidden>
              <SparkIcon />
            </span>
            <div className="intel-card-head-text">
              <h3 className="intel-card-title">Your week in focus</h3>
              <p className="intel-card-desc">Where your attention went — and where it&apos;s shifting</p>
            </div>
          </header>

          {(lead || wrapped.depth_label) && (
            <div className="intel-wrapped-hero">
              {lead && <p className="intel-wrapped-lead">{lead}</p>}
              {wrapped.depth_label && (
                <span className={`intel-depth-pill intel-depth-pill--${wrapped.depth_trend || "stable"}`}>
                  <span className="intel-depth-pill-icon" aria-hidden>
                    {depthTrendIcon(wrapped.depth_trend)}
                  </span>
                  {wrapped.depth_label}
                </span>
              )}
            </div>
          )}

          {activeTopics.length > 0 && (
            <section className="intel-wrapped-section">
              <h4 className="intel-wrapped-section-title">Active this week</h4>
              <ul className="intel-topic-list">
                {activeTopics.map((t) => (
                  <li key={t.topic} className="intel-topic-row intel-topic-row--active">
                    <span className="intel-topic-name">{t.topic}</span>
                    {t.detail && <span className="intel-topic-meta">{t.detail}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {shifts.length > 0 && (
            <section className="intel-wrapped-section">
              <h4 className="intel-wrapped-section-title">Shifting</h4>
              <ul className="intel-shift-list">
                {shifts.map((s) => (
                  <li key={`${s.topic}-${s.direction}`} className="intel-shift-card">
                    <div className="intel-shift-top">
                      <span className="intel-shift-topic">{s.topic}</span>
                      <span className={`intel-shift-badge intel-shift-badge--${s.direction || "stable"}`}>
                        {s.label}
                      </span>
                    </div>
                    {s.detail && <p className="intel-shift-evidence">{s.detail}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {emerging.length > 0 && (
            <section className="intel-wrapped-section">
              <h4 className="intel-wrapped-section-title">Worth watching</h4>
              <ul className="intel-topic-list">
                {emerging.map((t) => (
                  <li key={t.topic} className="intel-topic-row intel-topic-row--emerging">
                    <span className="intel-topic-name">{t.topic}</span>
                    {t.detail && <span className="intel-topic-meta">{t.detail}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {gaps.length > 0 && (
            <section className="intel-wrapped-section">
              <h4 className="intel-wrapped-section-title">Thin coverage</h4>
              <ul className="intel-topic-list">
                {gaps.map((g) => (
                  <li key={g.topic} className="intel-topic-row intel-topic-row--gap">
                    <span className="intel-topic-name">{g.topic}</span>
                    {g.detail && <span className="intel-topic-meta">{g.detail}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {wrapped.weekly_synthesis && (
            <p className="intel-wrapped-synthesis">{wrapped.weekly_synthesis}</p>
          )}
        </article>
      )}

      {hasBlindSpots && (
        <article className="intel-card intel-card-blind">
          <header className="intel-card-head">
            <span className="intel-card-icon" aria-hidden>
              <LensIcon />
            </span>
            <div className="intel-card-head-text">
              <h3 className="intel-card-title">Blind spots</h3>
              <p className="intel-card-desc">Where your sources agree — and what you might be missing</p>
            </div>
          </header>
          <ul className="intel-blind-list">
            {blindSpots.map((spot) => (
              <li key={spot.topic} className="intel-blind-item">
                <p className="intel-blind-topic">{spot.topic}</p>
                <p className="intel-blind-consensus">{spot.consensus}</p>
                {spot.counter_argument && (
                  <div className="intel-blind-counter">
                    {spot.counter_headline && (
                      <p className="intel-blind-counter-src">
                        {spot.counter_headline}
                        {spot.counter_source ? ` · ${spot.counter_source}` : ""}
                      </p>
                    )}
                    <p className="intel-blind-counter-text">{spot.counter_argument}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </article>
      )}
    </section>
  );
}
