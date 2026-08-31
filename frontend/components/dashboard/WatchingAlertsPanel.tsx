"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type WatchedAlert } from "@/lib/api";

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffH = (Date.now() - d.getTime()) / 36e5;
  if (diffH < 1) return "Just now";
  if (diffH < 24) return `${Math.max(1, Math.round(diffH))}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function WatchingAlertsPanel() {
  const [alerts, setAlerts] = useState<WatchedAlert[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    api
      .listWatchedAlerts(true)
      .then(setAlerts)
      .catch(() => setAlerts([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function markRead(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    await api.markWatchedAlertRead(id).catch(() => undefined);
  }

  if (!loaded || alerts.length === 0) return null;

  return (
    <section className="watching-alerts" aria-labelledby="watching-alerts-title">
      <div className="watching-alerts-head">
        <h2 id="watching-alerts-title" className="watching-alerts-title">
          Updates on what you&apos;re watching
        </h2>
        {alerts.length > 1 && (
          <button
            type="button"
            className="watching-alerts-clear"
            onClick={() => {
              setAlerts([]);
              void api.markWatchedAlertsReadAll().catch(() => undefined);
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      <ul className="watching-alerts-list">
        {alerts.map((alert) => (
          <li key={alert.id} className="watching-alert-card">
            <div className="watching-alert-meta">
              <span className="watching-alert-entity">{alert.entity_name}</span>
              {alert.is_urgent && <span className="watching-alert-urgent">Urgent</span>}
              <span className="watching-alert-time">
                {timeLabel(alert.published_at || alert.created_at)}
              </span>
            </div>
            <h3 className="watching-alert-headline">{alert.title}</h3>
            {alert.what_changed && (
              <p className="watching-alert-line">
                <span>What changed</span>
                {alert.what_changed}
              </p>
            )}
            {alert.why_it_matters && (
              <p className="watching-alert-line">
                <span>Why it matters</span>
                {alert.why_it_matters}
              </p>
            )}
            {alert.action && (
              <p className="watching-alert-line">
                <span>Action</span>
                {alert.action}
              </p>
            )}
            <div className="watching-alert-actions">
              {alert.source_url && !alert.source_url.startsWith("pool:") && (
                <a href={alert.source_url} target="_blank" rel="noreferrer">
                  Read source
                </a>
              )}
              {alert.related_urls.length > 0 && (
                <span className="watching-alert-related">
                  +{alert.related_urls.length} other source
                  {alert.related_urls.length === 1 ? "" : "s"}
                </span>
              )}
              {alert.sources_checked > 0 && (
                <span className="watching-alert-related">
                  Monitored {alert.sources_checked} source
                  {alert.sources_checked === 1 ? "" : "s"}
                </span>
              )}
              <button type="button" onClick={() => void markRead(alert.id)}>
                Mark read
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
