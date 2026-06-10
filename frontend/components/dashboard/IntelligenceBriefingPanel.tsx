"use client";

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

export type WrappedSnapshot = {
  current_focus?: string;
  depth_trend?: string;
  weekly_synthesis?: string;
  mind_shifts?: { topic: string; direction: string; evidence: string }[];
  high_engagement?: { topic: string; detail: string }[];
  emerging_threads?: string[] | { topic?: string }[];
  coverage_gaps?: string[];
};

type Props = {
  calendar?: CalendarBriefing | null;
  wrapped?: WrappedSnapshot | null;
  blindSpots?: BlindSpot[];
};

export function IntelligenceBriefingPanel({ calendar, wrapped, blindSpots = [] }: Props) {
  const meetings = calendar?.meetings ?? [];
  const hasCalendar = meetings.length > 0;
  const hasWrapped = Boolean(
    wrapped &&
      (wrapped.current_focus ||
        (wrapped.mind_shifts && wrapped.mind_shifts.length > 0) ||
        wrapped.weekly_synthesis),
  );
  const hasBlindSpots = blindSpots.length > 0;

  if (!hasCalendar && !hasWrapped && !hasBlindSpots) return null;

  return (
    <section className="intelligence-briefing-panel" aria-label="Intelligence layer">
      {hasCalendar && (
        <div className="intel-block intel-block-calendar">
          <header className="intel-block-head">
            <p className="intel-eyebrow">Today&apos;s meetings</p>
            <p className="intel-sub">Stories in your brief matched to your calendar</p>
          </header>
          <ul className="intel-meeting-list">
            {meetings.map((m) => (
              <li key={`${m.time}-${m.title}`} className="intel-meeting-item">
                <div className="intel-meeting-time">{m.time}</div>
                <div className="intel-meeting-body">
                  <p className="intel-meeting-title">{m.title}</p>
                  {m.attendees && m.attendees.length > 0 && (
                    <p className="intel-meeting-attendees">with {m.attendees.slice(0, 3).join(", ")}</p>
                  )}
                  {m.relevant_stories && m.relevant_stories.length > 0 && (
                    <ul className="intel-meeting-stories">
                      {m.relevant_stories.map((s) => (
                        <li key={s.headline}>{s.headline}</li>
                      ))}
                    </ul>
                  )}
                  {m.active_threads && m.active_threads.length > 0 && (
                    <p className="intel-meeting-threads">
                      Threads: {m.active_threads.join(" · ")}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasWrapped && wrapped && (
        <div className="intel-block intel-block-wrapped">
          <header className="intel-block-head">
            <p className="intel-eyebrow">Your week in focus</p>
            <p className="intel-sub">How your attention shifted — the memory loop at work</p>
          </header>
          {wrapped.current_focus && (
            <p className="intel-wrapped-focus">{wrapped.current_focus}</p>
          )}
          {wrapped.mind_shifts && wrapped.mind_shifts.length > 0 && (
            <ul className="intel-shift-list">
              {wrapped.mind_shifts.map((s) => (
                <li key={`${s.topic}-${s.direction}`}>
                  <strong>{s.topic}</strong>
                  <span className={`intel-shift-dir intel-shift-dir--${s.direction}`}>
                    {s.direction}
                  </span>
                  {s.evidence && <span className="intel-shift-evidence">{s.evidence}</span>}
                </li>
              ))}
            </ul>
          )}
          {wrapped.high_engagement && wrapped.high_engagement.length > 0 && (
            <div className="intel-wrapped-chips">
              {wrapped.high_engagement.map((h) => (
                <span key={h.topic} className="intel-wrapped-chip">
                  {h.topic}
                  <span className="intel-wrapped-chip-sub">{h.detail}</span>
                </span>
              ))}
            </div>
          )}
          {wrapped.weekly_synthesis && (
            <p className="intel-wrapped-synthesis">{wrapped.weekly_synthesis}</p>
          )}
        </div>
      )}

      {hasBlindSpots && (
        <div className="intel-block intel-block-blind">
          <header className="intel-block-head">
            <p className="intel-eyebrow">Blind spots</p>
            <p className="intel-sub">Where your sources agree — and what you might be missing</p>
          </header>
          <ul className="intel-blind-list">
            {blindSpots.map((spot) => (
              <li key={spot.topic} className="intel-blind-item">
                <p className="intel-blind-topic">{spot.topic}</p>
                <p className="intel-blind-consensus">{spot.consensus}</p>
                {spot.counter_argument && (
                  <p className="intel-blind-counter">
                    {spot.counter_headline && (
                      <span className="intel-blind-counter-src">
                        {spot.counter_headline}
                        {spot.counter_source ? ` · ${spot.counter_source}` : ""}
                      </span>
                    )}
                    {spot.counter_argument}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
