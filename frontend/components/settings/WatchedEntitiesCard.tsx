"use client";

import { useEffect, useState } from "react";
import { api, type WatchedEntity } from "@/lib/api";

const KINDS = [
  { value: "company", label: "Company" },
  { value: "topic", label: "Topic" },
  { value: "person", label: "Person" },
  { value: "product", label: "Product" },
];

function shortKnown(text: string, max = 72): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

export function WatchedEntitiesCard({ compact = false }: { compact?: boolean }) {
  const [entities, setEntities] = useState<WatchedEntity[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("company");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    void api
      .listWatchedEntities()
      .then(setEntities)
      .catch(() => setError("Could not load your watch list."));
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await api.addWatchedEntity({ name: trimmed, kind });
      setEntities((prev) =>
        prev.some((x) => x.id === created.id) ? prev : [created, ...prev],
      );
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add.");
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    if (scanning) return;
    setScanning(true);
    setError("");
    setNote("Checking sources…");
    try {
      const result = await api.scanWatchedEntities();
      const fresh = await api.listWatchedEntities().catch(() => null);
      const unreadByEntity = new Map<string, number>();
      for (const alert of result.alerts.filter((a) => !a.is_read)) {
        unreadByEntity.set(alert.entity_id, (unreadByEntity.get(alert.entity_id) ?? 0) + 1);
      }
      if (fresh) {
        setEntities(
          fresh.map((ent) => ({ ...ent, unread_count: unreadByEntity.get(ent.id) ?? ent.unread_count ?? 0 })),
        );
      } else {
        setEntities((prev) =>
          prev.map((ent) => ({ ...ent, unread_count: unreadByEntity.get(ent.id) ?? 0 })),
        );
      }
      setNote(
        result.new_alerts > 0
          ? `Found ${result.new_alerts} new update${result.new_alerts === 1 ? "" : "s"}. Open Today to read them.`
          : "Checked sources. Nothing new scored high enough to alert.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check sources.");
    } finally {
      setScanning(false);
    }
  }

  async function remove(id: string) {
    setEntities((prev) => prev.filter((x) => x.id !== id));
    await api.removeWatchedEntity(id).catch(() => undefined);
  }

  return (
    <div className={`watched-card${compact ? " watched-card--compact" : ""}`}>
      {compact && <p className="watched-card-label">Watching</p>}
      <form className="watched-form" onSubmit={add}>
        <select
          className="watched-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Type"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          className="watched-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. OpenAI, Anthropic, a topic to watch…"
        />
        <button type="submit" className="dash-btn dash-btn-primary" disabled={busy || !name.trim()}>
          Watch
        </button>
        {entities.length > 0 && (
          <button
            type="button"
            className="dash-btn dash-btn-secondary"
            onClick={() => void checkNow()}
            disabled={scanning}
          >
            {scanning ? "Checking…" : "Check now"}
          </button>
        )}
      </form>

      {entities.length > 0 ? (
        <>
        <ul className="watched-list">
          {entities.map((ent) => (
            <li key={ent.id} className="watched-chip">
              <span className="watched-chip-kind">{ent.kind}</span>
              <span className="watched-chip-name">{ent.name}</span>
              {(ent.unread_count ?? 0) > 0 && (
                <span className="watched-chip-count">{ent.unread_count}</span>
              )}
              <button
                type="button"
                onClick={() => remove(ent.id)}
                aria-label={`Stop watching ${ent.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {entities.some((ent) => (ent.last_states?.length ?? 0) > 0) ? (
          <ul className="watched-known">
            {entities.flatMap((ent) => {
              const latest = ent.last_states?.[0];
              if (!latest?.state) return [];
              return [
                <li key={`${ent.id}-known`}>
                  <span className="watched-known-name">{ent.name}</span>
                  <span className="watched-known-label">{latest.label}</span>
                  <span className="watched-known-state">{shortKnown(latest.state)}</span>
                </li>,
              ];
            })}
          </ul>
        ) : null}
        </>
      ) : (
        <p className="watched-empty">
          {compact
            ? "Track a company from a brief, or add one here."
            : "Nothing watched yet. Add a company or topic and Briefly will alert you when it ships something — even from sources you don't follow."}
        </p>
      )}

      {note && <p className="watched-empty">{note}</p>}
      {error && <p className="push-card-msg push-card-msg--err">{error}</p>}
    </div>
  );
}
