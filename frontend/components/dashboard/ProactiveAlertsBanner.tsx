"use client";

import { useEffect, useState } from "react";
import { api, type ProactiveEvent } from "@/lib/api";

const EVENT_LABEL: Record<string, string> = {
  meeting_prep: "Meeting prep",
  breaking_development: "Breaking",
  thread_update: "Thread update",
  relevant_content: "Worth a look",
  voice_note_connection: "Voice note",
  watched_entity: "Watchlist",
  coverage_gap_alert: "Coverage gap",
};

function labelFor(event: ProactiveEvent): string {
  return EVENT_LABEL[event.event_type] ?? "Update";
}

export function ProactiveAlertsBanner() {
  const [events, setEvents] = useState<ProactiveEvent[]>([]);

  useEffect(() => {
    api.getProactiveEvents().then(setEvents).catch(() => setEvents([]));
  }, []);

  const visible = events.filter((e) => e.event_type !== "watched_entity");
  if (!visible.length) return null;

  const top = visible[0];
  return (
    <div className="proactive-alert-banner" role="status">
      <span className="proactive-alert-dot" aria-hidden />
      <div>
        <p className="proactive-alert-label">{labelFor(top)}</p>
        <p className="proactive-alert-title">{top.title}</p>
        <p className="proactive-alert-body">{top.body}</p>
      </div>
    </div>
  );
}
