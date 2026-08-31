"use client";

import { useEffect, useState } from "react";
import { api, type WatchedEntity } from "@/lib/api";

const KINDS = [
  { value: "company", label: "Company" },
  { value: "topic", label: "Topic" },
  { value: "person", label: "Person" },
];

export function WatchedEntitiesCard({ compact = false }: { compact?: boolean }) {
  const [entities, setEntities] = useState<WatchedEntity[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("company");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      </form>

      {entities.length > 0 ? (
        <ul className="watched-list">
          {entities.map((ent) => (
            <li key={ent.id} className="watched-chip">
              <span className="watched-chip-kind">{ent.kind}</span>
              <span className="watched-chip-name">{ent.name}</span>
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
      ) : (
        <p className="watched-empty">
          {compact
            ? "Track a company from a brief, or add one here."
            : "Nothing watched yet. Add a company or topic and Briefly will alert you when it ships something — even from sources you don't follow."}
        </p>
      )}

      {error && <p className="push-card-msg push-card-msg--err">{error}</p>}
    </div>
  );
}
