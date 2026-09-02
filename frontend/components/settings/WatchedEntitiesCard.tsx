"use client";

import { useEffect, useState, type ReactElement } from "react";
import { presentOfficialState, shortLabel } from "@/lib/intelligenceHome";
import { api, type WatchedEntity } from "@/lib/api";

const KINDS = [
  { value: "company", label: "Company" },
  { value: "topic", label: "Topic" },
  { value: "person", label: "Person" },
  { value: "product", label: "Product" },
];

function shortKnown(text: string, max = 72): string {
  const fact = presentOfficialState(text)[0] || text.trim();
  return shortLabel(fact, max);
}

export function WatchedEntitiesCard({ compact = false }: { compact?: boolean }) {
  const [entities, setEntities] = useState<WatchedEntity[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("company");
  const [pageUrl, setPageUrl] = useState("");
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pinUrl, setPinUrl] = useState("");
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
      const created = await api.addWatchedEntity({
        name: trimmed,
        kind,
        page_url: pageUrl.trim() || undefined,
      });
      setEntities((prev) =>
        prev.some((x) => x.id === created.id) ? prev : [created, ...prev],
      );
      setName("");
      setPageUrl("");
      if (!created.last_checked) {
        sessionStorage.setItem(
          "briefly:monitoring-setup-warning",
          `${created.name} was added. Run Check now on Today to activate monitoring.`,
        );
      }
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

  async function pinPage(id: string) {
    const url = pinUrl.trim();
    if (!url || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api.pinWatchedPage(id, url);
      setEntities((prev) => prev.map((ent) => (ent.id === id ? updated : ent)));
      setPinFor(null);
      setPinUrl("");
      setNote("Official page pinned. Check now to store a baseline.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pin that page.");
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
        {!compact && (kind === "company" || kind === "product") ? (
          <input
            className="watched-input"
            type="url"
            value={pageUrl}
            onChange={(e) => setPageUrl(e.target.value)}
            placeholder="Official pricing/docs URL (optional)"
            aria-label="Official page URL"
          />
        ) : null}
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
        {entities.some((ent) => ent.coverage || (ent.last_states?.length ?? 0) > 0) ? (
          <ul className="watched-known">
            {entities.flatMap((ent) => {
              const rows: ReactElement[] = [];
              const cov = ent.coverage;
              if (cov) {
                const watching = (cov.pages || [])
                  .filter((p) => p.status === "watching" || p.status === "pending")
                  .map((p) => p.source_type);
                const label =
                  cov.status === "official"
                    ? `official ${watching.join(" · ") || "pages"}`
                    : cov.status === "partial"
                      ? `official ${watching.join(" · ") || "page"} · news for the rest`
                      : cov.status === "skipped"
                        ? "news and RSS"
                        : "news only";
                const canPin =
                  (ent.kind === "company" || ent.kind === "product") &&
                  cov.status !== "official" &&
                  cov.status !== "skipped";
                rows.push(
                  <li key={`${ent.id}-cov`}>
                    <span className="watched-known-name">{ent.name}</span>
                    <span className="watched-known-label">{label}</span>
                    {canPin ? (
                      pinFor === ent.id ? (
                        <form
                          className="watched-pin"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void pinPage(ent.id);
                          }}
                        >
                          <input
                            className="watched-input"
                            type="url"
                            value={pinUrl}
                            onChange={(e) => setPinUrl(e.target.value)}
                            placeholder="https://…/pricing"
                            aria-label={`Official page for ${ent.name}`}
                          />
                          <button type="submit" className="dash-btn dash-btn-secondary" disabled={busy || !pinUrl.trim()}>
                            Pin
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="watched-pin-link"
                          onClick={() => {
                            setPinFor(ent.id);
                            setPinUrl("");
                          }}
                        >
                          Pin a page we missed
                        </button>
                      )
                    ) : null}
                  </li>,
                );
              }
              const latest = ent.last_states?.[0];
              if (latest?.state) {
                rows.push(
                  <li key={`${ent.id}-known`}>
                    <span className="watched-known-name">{ent.name}</span>
                    <span className="watched-known-label">{latest.label}</span>
                    <span className="watched-known-state">{shortKnown(latest.state)}</span>
                  </li>,
                );
              }
              return rows;
            })}
          </ul>
        ) : null}
        </>
      ) : (
        <p className="watched-empty">
          {compact
            ? "Track a company from a brief, or add one here."
            : "Nothing watched yet. Add a company and Briefly resolves its official pricing, docs, and changelog pages when it can find them. News still runs if a page cannot be confirmed."}
        </p>
      )}

      {note && <p className="watched-empty">{note}</p>}
      {error && <p className="push-card-msg push-card-msg--err">{error}</p>}
    </div>
  );
}
