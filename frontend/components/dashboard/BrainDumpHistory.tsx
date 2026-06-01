"use client";

import { useEffect, useState } from "react";
import { api, type BrainDump } from "@/lib/api";

function formatWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const intentLabel: Record<string, string> = {
  action_item: "Action items",
  project_idea: "Project idea",
  general_context: "Context",
};

type BrainDumpHistoryProps = {
  refreshKey?: number;
  onNewDump: () => void;
};

export function BrainDumpHistory({ refreshKey = 0, onNewDump }: BrainDumpHistoryProps) {
  const [dumps, setDumps] = useState<BrainDump[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .listBrainDumps()
      .then((list) => {
        if (!cancelled) setDumps(list);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load past dumps.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="brain-dump-history-loading">
        <span className="btn-spinner brain-dump-btn-spinner" aria-hidden />
        <span>Loading past dumps…</span>
      </div>
    );
  }

  if (error) {
    return <p className="form-error brain-dump-error">{error}</p>;
  }

  if (dumps.length === 0) {
    return (
      <div className="brain-dump-history-empty">
        <p>No brain dumps yet.</p>
        <button type="button" className="btn-primary" onClick={onNewDump}>
          Create your first dump
        </button>
      </div>
    );
  }

  return (
    <ul className="brain-dump-history-list">
      {dumps.map((dump) => {
        const open = expandedId === dump.id;
        return (
          <li key={dump.id} className={`brain-dump-history-item${open ? " is-open" : ""}`}>
            <button
              type="button"
              className="brain-dump-history-head"
              onClick={() => setExpandedId(open ? null : dump.id)}
              aria-expanded={open}
            >
              <span className="brain-dump-history-title">{dump.title}</span>
              <span className="brain-dump-history-meta">
                {formatWhen(dump.created_at)}
                {dump.input_mode === "voice" && " · voice"}
              </span>
            </button>
            {open && (
              <div className="brain-dump-history-body">
                <p className="brain-dump-history-summary">{dump.clean_summary}</p>
                <div className="brain-dump-meta-row">
                  <span className="brain-dump-badge">
                    {intentLabel[dump.intent_type] ?? dump.intent_type}
                  </span>
                </div>
                {dump.action_items.length > 0 && (
                  <ul className="brain-dump-actions-list">
                    {dump.action_items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {dump.relevance_keywords.length > 0 && (
                  <div className="brain-dump-keywords">
                    {dump.relevance_keywords.map((kw) => (
                      <span key={kw} className="brain-dump-kw">{kw}</span>
                    ))}
                  </div>
                )}
                <details className="brain-dump-raw-details">
                  <summary>Original transcript</summary>
                  <p className="brain-dump-raw-text">{dump.raw_transcript}</p>
                </details>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
