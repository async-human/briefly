"use client";

import { useEffect, useState } from "react";
import { api, type IngestionSummary } from "@/lib/api";

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "Not yet";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export function IngestionPanel() {
  const [summary, setSummary] = useState<IngestionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getIngestionSummary()
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, []);

  async function handleRefresh() {
    setRunning(true);
    setError("");
    try {
      const next = await api.runIngestion();
      setSummary(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingestion failed");
    } finally {
      setRunning(false);
    }
  }

  const last = summary?.last_summary;
  const feed = summary?.activity_feed?.slice(0, 3) ?? [];

  return (
    <div className="dash-card dash-ingestion-card">
      <div className="dash-card-head">
        <div>
          <p className="dash-card-label">Overnight</p>
          <h2 className="dash-card-title">What Briefly ingested</h2>
        </div>
      </div>
      {loading ? (
        <p className="dash-card-desc">Loading ingestion status…</p>
      ) : (
        <>
          <p className="dash-card-desc">
            {summary?.pool_items_recent
              ? `${summary.pool_items_recent} items in your pool (last 48h)`
              : "Briefly fetches your sources overnight so morning briefings are fast."}
          </p>
          {last && ((last.items_new ?? 0) > 0 || (last.items_updated ?? 0) > 0) && (
            <ul className="ingestion-stats">
              <li><strong>{last.items_new ?? 0}</strong> new</li>
              <li><strong>{last.items_updated ?? 0}</strong> updated</li>
              <li><strong>{last.sources_ok ?? 0}</strong> sources</li>
            </ul>
          )}
          <p className="ingestion-last-run">
            Last run: {formatRelativeTime(summary?.last_ingestion_at ?? last?.ingested_at)}
          </p>
          {feed.length > 0 && (
            <ul className="ingestion-feed">
              {feed.map((entry, i) => (
                <li key={`${entry.at}-${i}`}>{entry.message}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="onboard-chip-btn ingestion-refresh-btn"
            onClick={handleRefresh}
            disabled={running}
          >
            {running ? "Fetching sources…" : "Refresh sources now"}
          </button>
          {error && <p className="form-error" style={{ marginTop: 8 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
