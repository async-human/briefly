"use client";

import { useEffect, useState } from "react";
import { api, type ProactiveEvent } from "@/lib/api";

export function ProactiveAlertsBanner() {
  const [events, setEvents] = useState<ProactiveEvent[]>([]);

  useEffect(() => {
    api.getProactiveEvents().then(setEvents).catch(() => setEvents([]));
  }, []);

  if (!events.length) return null;

  const top = events[0];
  return (
    <div className="proactive-alert-banner" role="status">
      <span className="proactive-alert-dot" aria-hidden />
      <div>
        <p className="proactive-alert-label">Breaking in your threads</p>
        <p className="proactive-alert-title">{top.title}</p>
        <p className="proactive-alert-body">{top.body}</p>
      </div>
    </div>
  );
}
