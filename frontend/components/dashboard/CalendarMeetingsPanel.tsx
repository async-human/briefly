"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Meeting = {
  title: string;
  time: string;
  day_label?: string | null;
  attendees: string[];
};

export function CalendarConnectNudge() {
  const [connecting, setConnecting] = useState(false);

  async function connectCalendar() {
    setConnecting(true);
    try {
      const { url } = await api.startCalendarConnect("/dashboard");
      window.location.href = url;
    } catch {
      setConnecting(false);
    }
  }

  return (
    <div className="calendar-nudge" role="status">
      <div>
        <p className="calendar-nudge-label">Meeting prep</p>
        <p className="calendar-nudge-title">Connect Google Calendar</p>
        <p className="calendar-nudge-body">
          Gmail finds newsletters; Google Calendar is a separate connection. Link Calendar to see meeting prep and story matches before your calls.
        </p>
      </div>
      <button type="button" className="calendar-nudge-btn" onClick={() => void connectCalendar()} disabled={connecting}>
        {connecting ? "Opening Google…" : "Connect Calendar"}
      </button>
    </div>
  );
}

export function CalendarMeetingsPanel({ calendarConnected }: { calendarConnected: boolean }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!calendarConnected) {
      setMeetings([]);
      setLoaded(true);
      return;
    }
    void api
      .getCalendarUpcoming()
      .then((data) => setMeetings(data.connected ? data.meetings : []))
      .catch(() => setMeetings([]))
      .finally(() => setLoaded(true));
  }, [calendarConnected]);

  if (!calendarConnected || !loaded || meetings.length === 0) return null;

  return (
    <div className="calendar-meetings-panel" role="region" aria-label="Upcoming meetings">
      <div className="calendar-meetings-head">
        <p className="calendar-meetings-label">Upcoming meetings</p>
        <Link href="/settings" className="calendar-meetings-link">
          Calendar settings
        </Link>
      </div>
      <ul className="calendar-meetings-list">
        {meetings.slice(0, 4).map((m, i) => (
          <li key={`${m.title}-${i}`} className="calendar-meetings-item">
            <span className="calendar-meetings-time">
              {m.day_label ? `${m.day_label} · ` : ""}
              {m.time}
            </span>
            <span className="calendar-meetings-title">{m.title}</span>
            {m.attendees.length > 0 && (
              <span className="calendar-meetings-attendees">With {m.attendees.slice(0, 3).join(", ")}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="calendar-meetings-hint">
        Regenerate today&apos;s brief to weave calendar context into your briefing. Alerts also appear on the assistant orb.
      </p>
    </div>
  );
}
