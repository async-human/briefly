"use client";

import Link from "next/link";
import { graphItemUrl } from "@/lib/graphLinks";

export type SerendipityConnection = {
  title: string;
  body: string;
  content_id?: string | null;
  headline?: string | null;
  kind?: "in_brief" | "history" | "saved" | string;
  thread_update?: string | null;
  thread_key?: string | null;
  strength?: number;
};

const KIND_LABELS: Record<string, string> = {
  in_brief: "In today's brief",
  history: "From your reading history",
  saved: "From something you saved",
};

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M10 14l-4 4m0 0l-1.5-1.5M6 18l1.5-1.5M14 10l4-4m0 0l1.5 1.5M18 6l-1.5 1.5" strokeLinecap="round" />
      <path d="M8 16l8-8" strokeLinecap="round" />
    </svg>
  );
}

type Props = {
  connections: SerendipityConnection[];
  digestId?: string | null;
  inBriefContentIds?: Set<string>;
};

export function SerendipityPanel({ connections, digestId, inBriefContentIds }: Props) {
  if (!connections.length) return null;

  return (
    <section className="serendipity-panel" aria-label="Connections Briefly noticed">
      <header className="serendipity-head">
        <span className="serendipity-head-icon" aria-hidden>
          <LinkIcon />
        </span>
        <div>
          <h3 className="serendipity-title">Connections Briefly noticed</h3>
          <p className="serendipity-sub">How today&apos;s stories link to what you&apos;ve been following</p>
        </div>
      </header>
      <ul className="serendipity-list">
        {connections.map((conn, i) => {
          const kind = conn.kind || "history";
          const kindLabel = KIND_LABELS[kind] || "Connection";
          const storyHeadline = conn.headline?.trim();
          const pastLink = conn.body?.trim();
          const inBrief = Boolean(
            conn.content_id && inBriefContentIds?.has(conn.content_id),
          );

          return (
            <li key={`${conn.content_id ?? conn.body}-${i}`} className="serendipity-card">
              <div className="serendipity-card-top">
                <span className={`serendipity-kind serendipity-kind--${kind}`}>{kindLabel}</span>
                {conn.thread_key && (
                  <span className="serendipity-thread-key">{conn.thread_key.replace(/-/g, " ")}</span>
                )}
              </div>

              {storyHeadline && (
                <p className="serendipity-story-headline">{storyHeadline}</p>
              )}

              {pastLink && (
                <div className="serendipity-link-block">
                  {storyHeadline && <span className="serendipity-link-label">Connects to</span>}
                  <p className="serendipity-link-text">{pastLink}</p>
                </div>
              )}

              {conn.thread_update && conn.thread_update !== pastLink && (
                <p className="serendipity-thread-update">{conn.thread_update}</p>
              )}

              {!storyHeadline && !pastLink && (
                <p className="serendipity-link-text">{conn.title}</p>
              )}

              <div className="serendipity-card-actions">
                {digestId && inBrief && (
                  <Link href={`/dashboard/read/${digestId}`} className="serendipity-action">
                    Read in brief
                  </Link>
                )}
                {conn.content_id && (
                  <Link href={graphItemUrl(conn.content_id)} className="serendipity-action serendipity-action-muted">
                    View in graph
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
