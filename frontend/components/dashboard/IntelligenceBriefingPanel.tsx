"use client";

import type { WrappedSnapshot } from "@/lib/api";
import { WeekInFocusCard } from "@/components/intelligence/WeekInFocusCard";
import { hasWrappedContent } from "@/lib/weekInFocus";

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

export type { WrappedSnapshot };

type Props = {
  calendar?: CalendarBriefing | null;
  wrapped?: WrappedSnapshot | null;
  blindSpots?: BlindSpot[];
  /** Strip card chrome when nested inside dashboard accordion */
  embedded?: boolean;
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

export function IntelligenceBriefingPanel({
  calendar,
  wrapped,
  blindSpots = [],
  embedded = false,
}: Props) {
  const meetings = calendar?.meetings ?? [];
  const hasCalendar = meetings.length > 0;
  const hasWrapped = Boolean(wrapped && hasWrappedContent(wrapped));
  const hasBlindSpots = blindSpots.length > 0;

  if (!hasCalendar && !hasWrapped && !hasBlindSpots) return null;

  const panelClass = embedded
    ? "intelligence-briefing-panel intelligence-briefing-panel--embedded"
    : "intelligence-briefing-panel";

  return (
    <section className={panelClass} aria-label="Intelligence layer">
      {hasCalendar && (
        <article className={`intel-card intel-card-calendar${embedded ? " intel-card--embedded" : ""}`}>
          {!embedded && (
          <header className="intel-card-head">
            <span className="intel-card-icon" aria-hidden>
              <CalendarIcon />
            </span>
            <div className="intel-card-head-text">
              <h3 className="intel-card-title">Today&apos;s meetings</h3>
              <p className="intel-card-desc">Stories in your brief matched to your calendar</p>
            </div>
          </header>
          )}
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
        <article className={`intel-card intel-card-wrapped${embedded ? " intel-card--embedded" : ""}`}>
          {!embedded && (
          <header className="intel-card-head">
            <span className="intel-card-icon" aria-hidden>
              <SparkIcon />
            </span>
            <div className="intel-card-head-text">
              <h3 className="intel-card-title">Your week in focus</h3>
              <p className="intel-card-desc">Where your attention went — and where it&apos;s shifting</p>
            </div>
          </header>
          )}
          <WeekInFocusCard wrapped={wrapped} variant={embedded ? "full" : "teaser"} />
        </article>
      )}

      {hasBlindSpots && (
        <article className={`intel-card intel-card-blind${embedded ? " intel-card--embedded" : ""}`}>
          {!embedded && (
          <header className="intel-card-head">
            <span className="intel-card-icon" aria-hidden>
              <LensIcon />
            </span>
            <div className="intel-card-head-text">
              <h3 className="intel-card-title">Blind spots</h3>
              <p className="intel-card-desc">Where your sources agree — and what you might be missing</p>
            </div>
          </header>
          )}
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
