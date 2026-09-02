"use client";

import { useEffect, useState } from "react";
import { api, type DecisionTimelineEvent } from "@/lib/api";

function fmtWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function eventLabel(event: DecisionTimelineEvent): string {
  if (event.type === "outcome") {
    if (event.outcome === "changed") return "Changed the decision";
    if (event.outcome === "confirmed") return "Confirmed the direction";
    if (event.outcome === "action_planned") return "Action planned";
    if (event.outcome === "acted") return "Action completed";
    return "No decision impact";
  }
  if (event.type === "belief_edit") return "Belief updated";
  if (event.type === "signal") {
    if (event.stance === "contradicting") return "May challenge your belief";
    if (event.stance === "supporting") return "Supports your belief";
    return "Related signal";
  }
  if (
    event.previous_confidence != null
    && event.confidence != null
    && event.previous_confidence !== event.confidence
  ) {
    return "Confidence shifted";
  }
  return "Timeline update";
}

function confidenceLine(event: DecisionTimelineEvent): string | null {
  if (event.previous_confidence == null || event.confidence == null) return null;
  if (event.previous_confidence === event.confidence) return null;
  const prev = Math.round(event.previous_confidence * 100);
  const next = Math.round(event.confidence * 100);
  return `${prev}% → ${next}%`;
}

type Props = {
  threadId: string;
  expanded: boolean;
};

export function DecisionThreadTimeline({ threadId, expanded }: Props) {
  const [events, setEvents] = useState<DecisionTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!expanded || loaded) return;
    setLoading(true);
    void api
      .getDecisionThreadTimeline(threadId)
      .then((rows) => {
        setEvents(rows);
        setLoaded(true);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [expanded, loaded, threadId]);

  if (!expanded) return null;

  if (loading) {
    return <p className="settings-thread-timeline-loading">Loading history…</p>;
  }

  if (events.length === 0) {
    return (
      <p className="settings-thread-timeline-empty">
        No timeline yet — add a belief and Briefly will connect incoming signals here.
      </p>
    );
  }

  return (
    <ol className="settings-thread-timeline" aria-label="Decision timeline">
      {events.map((event, i) => {
        const conf = confidenceLine(event);
        return (
          <li
            key={`${event.at}-${event.type}-${i}`}
            className={[
              "settings-timeline-item",
              `is-${event.type}`,
              event.stance === "contradicting" ? "is-contradicting" : "",
            ].filter(Boolean).join(" ")}
          >
            <div className="settings-timeline-meta">
              <span className="settings-timeline-date">{fmtWhen(event.at)}</span>
              <span className="settings-timeline-kind">{eventLabel(event)}</span>
            </div>
            {event.headline ? (
              <p className="settings-timeline-headline">{event.headline}</p>
            ) : null}
            {event.belief && event.type === "belief_edit" ? (
              <p className="settings-timeline-belief">{event.belief}</p>
            ) : null}
            {event.rationale ? (
              <p className="settings-timeline-rationale">{event.rationale}</p>
            ) : null}
            {event.type === "outcome" && (event.action || event.note) ? (
              <p className="settings-timeline-outcome">{event.action || event.note}</p>
            ) : null}
            {conf ? <p className="settings-timeline-conf">{conf}</p> : null}
            {event.evidence && event.evidence.length > 0 ? (
              <ul className="settings-timeline-evidence">
                {event.evidence.slice(0, 2).map((ev) => (
                  <li key={ev.url}>
                    <a href={ev.url} target="_blank" rel="noreferrer">
                      {ev.source_name || "Source"}
                    </a>
                    {ev.passage ? `: ${ev.passage.slice(0, 120)}${ev.passage.length > 120 ? "…" : ""}` : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
