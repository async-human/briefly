"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type WatchedAlert, type WatchedEntity } from "@/lib/api";

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diffH = (Date.now() - d.getTime()) / 36e5;
  if (diffH < 1) return "Just now";
  if (diffH < 24) return `${Math.max(1, Math.round(diffH))}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isActionable(action: string | undefined): boolean {
  if (!action) return false;
  const t = action.trim();
  if (!t) return false;
  return !/^none(\s+immediate)?\.?$/i.test(t);
}

export function WatchingAlertsPanel() {
  const [alerts, setAlerts] = useState<WatchedAlert[]>([]);
  const [entities, setEntities] = useState<WatchedEntity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState("");

  const refresh = useCallback(() => {
    Promise.all([
      api.listWatchedAlerts(true).catch(() => [] as WatchedAlert[]),
      api.listWatchedEntities().catch(() => [] as WatchedEntity[]),
    ])
      .then(([nextAlerts, nextEntities]) => {
        setAlerts(nextAlerts);
        setEntities(nextEntities);
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function checkNow() {
    if (scanning) return;
    setScanning(true);
    setScanNote("Checking sources… this can take up to a minute.");
    try {
      const result = await api.scanWatchedEntities();
      const unread = result.alerts.filter((a) => !a.is_read);
      setAlerts(unread);
      setEntities((prev) =>
        prev.map((ent) => ({
          ...ent,
          unread_count: unread.filter((a) => a.entity_id === ent.id).length,
        })),
      );
      setScanNote(
        result.new_alerts > 0
          ? `Found ${result.new_alerts} new update${result.new_alerts === 1 ? "" : "s"}.`
          : "Checked sources. Nothing new scored high enough to alert.",
      );
    } catch (err) {
      setScanNote(err instanceof Error ? err.message : "Could not check sources.");
    } finally {
      setScanning(false);
    }
  }

  async function markRead(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    await api.markWatchedAlertRead(id).catch(() => undefined);
  }

  if (!loaded || entities.length === 0) return null;

  const names = entities.map((e) => e.name).slice(0, 4).join(", ");

  return (
    <section className="watching-alerts" aria-labelledby="watching-alerts-title">
      <div className="watching-alerts-head">
        <h2 id="watching-alerts-title" className="watching-alerts-title">
          Updates on what you&apos;re watching
        </h2>
        <div className="watching-alerts-head-actions">
          <button
            type="button"
            className="watching-alerts-clear"
            onClick={() => void checkNow()}
            disabled={scanning}
          >
            {scanning ? "Checking…" : "Check now"}
          </button>
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
      </div>

      {alerts.length === 0 ? (
        <p className="watching-alerts-empty">
          Watching {names}
          {entities.length > 4 ? "…" : ""}. No new updates yet
          {scanNote ? ` — ${scanNote}` : ". Click Check now to scan sources."}
        </p>
      ) : (
        <ul className="watching-alerts-list">
          {alerts.map((alert) => {
            const action = isActionable(alert.action) ? alert.action : "";
            const sourceOk = Boolean(alert.source_url && !alert.source_url.startsWith("pool:"));
            return (
              <li key={alert.id} className="watching-alert-card">
                <div className="watching-alert-meta">
                  <span className="watching-alert-entity">{alert.entity_name}</span>
                  {alert.is_urgent && <span className="watching-alert-urgent">Urgent</span>}
                  <span className="watching-alert-time">
                    {timeLabel(alert.published_at || alert.created_at)}
                  </span>
                  <button
                    type="button"
                    className="watching-alert-dismiss"
                    onClick={() => void markRead(alert.id)}
                  >
                    Mark read
                  </button>
                </div>
                <h3 className="watching-alert-headline">{alert.title}</h3>
                {(alert.what_changed || alert.why_it_matters || action) && (
                  <div className="watching-alert-fields">
                    {alert.what_changed ? (
                      <p className="watching-alert-field">
                        <span>Changed</span>
                        {alert.what_changed}
                      </p>
                    ) : null}
                    {alert.why_it_matters ? (
                      <p className="watching-alert-field">
                        <span>Why</span>
                        {alert.why_it_matters}
                      </p>
                    ) : null}
                    {action ? (
                      <p className="watching-alert-field watching-alert-field--action">
                        <span>Action</span>
                        {action}
                      </p>
                    ) : null}
                  </div>
                )}
                {(sourceOk || alert.related_urls.length > 0) && (
                  <div className="watching-alert-actions">
                    {sourceOk && (
                      <a href={alert.source_url} target="_blank" rel="noreferrer">
                        {alert.source_name || "Read source"}
                      </a>
                    )}
                    {alert.related_urls.length > 0 && (
                      <span className="watching-alert-related">
                        +{alert.related_urls.length} other
                        {alert.related_urls.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {alerts.length > 0 && scanNote && (
        <p className="watching-alerts-empty">{scanNote}</p>
      )}
    </section>
  );
}
