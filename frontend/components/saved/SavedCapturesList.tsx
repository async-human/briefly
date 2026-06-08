"use client";

import type { BrowserCapture } from "@/lib/api";
import { formatCaptureTitle } from "@/lib/formatCaptureTitle";

function formatCaptureDate(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) {
    return `Today · ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function hostname(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

type SavedCapturesListProps = {
  captures: BrowserCapture[];
};

export function SavedCapturesList({ captures }: SavedCapturesListProps) {
  return (
    <ul className="saved-capture-list">
      {captures.map((item) => {
        const host = hostname(item.url);
        const connection =
          item.connection_sentence ||
          (item.thread_label ? `Connects to your ${item.thread_label} thread` : null);

        const displayTitle = formatCaptureTitle(item.title, item.url);

        return (
          <li key={item.id} className="saved-capture-item">
            <div className="saved-capture-main">
              <div className="saved-capture-meta">
                <span
                  className={`saved-capture-status${
                    item.in_briefing ? " saved-capture-status-done" : ""
                  }`}
                >
                  {item.in_briefing ? "In briefing" : "Queued"}
                </span>
                {host ? <span className="saved-capture-host">{host}</span> : null}
              </div>

              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="saved-capture-title"
                  title={item.title}
                >
                  {displayTitle}
                </a>
              ) : (
                <h3 className="saved-capture-title" title={item.title}>
                  {displayTitle}
                </h3>
              )}

              {item.summary ? (
                <p className="saved-capture-summary">{item.summary}</p>
              ) : null}

              {connection ? (
                <p className="saved-capture-connection">{connection}</p>
              ) : item.why_relevant ? (
                <p className="saved-capture-connection">{item.why_relevant}</p>
              ) : null}

              {item.user_note ? (
                <p className="saved-capture-note">&ldquo;{item.user_note}&rdquo;</p>
              ) : null}
            </div>

            <time className="saved-capture-date" dateTime={item.created_at}>
              {formatCaptureDate(item.created_at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
