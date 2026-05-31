"use client";

import { useState } from "react";
import { api, type GmailSender, type Source } from "@/lib/api";

export function GmailDiscovery({
  onAdded,
  compact = false,
}: {
  onAdded: (s: Source) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [senders, setSenders] = useState<GmailSender[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleDiscover() {
    setOpen(true);
    setLoading(true);
    setDone(false);
    setError("");
    setSenders([]);
    setSelected(new Set());
    try {
      const res = await api.discoverGmailNewsletters();
      setSenders(res.senders);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan inbox");
    } finally {
      setLoading(false);
    }
  }

  function toggleSender(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === senders.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(senders.map((s) => s.email)));
    }
  }

  async function handleAdd() {
    if (!selected.size) return;
    setAdding(true);
    try {
      const toAdd = senders
        .filter((s) => selected.has(s.email))
        .map((s) => ({ identifier: s.email, source_type: "email", name: s.name }));
      const result = await api.bulkAddSources(toAdd);
      result.added.forEach((src) => onAdded(src));
      setDone(true);
      setSenders((prev) => prev.filter((s) => !selected.has(s.email)));
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add sources");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className={compact ? "dash-integration-block" : "dash-card"}>
      {!compact && (
        <>
          <p className="dash-card-label">Gmail</p>
          <h2 className="dash-card-title">Discover newsletters</h2>
        </>
      )}
      {compact && <p className="dash-integration-label">Gmail inbox scan</p>}
      {!compact && (
        <p className="dash-card-desc">
          Scan your inbox to find newsletters you already receive and add them in one click.
        </p>
      )}

      {!open ? (
        <button type="button" className="briefing-refresh" onClick={handleDiscover}>
          Scan inbox
        </button>
      ) : loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
          <span className="btn-spinner" style={{ borderTopColor: "var(--text-muted)" }} />
          Scanning inbox…
        </div>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : done && senders.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--accent)" }}>All found newsletters added!</p>
      ) : senders.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          No new newsletters found. Try forwarding some to your ingestion email.
        </p>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {senders.length} found — {selected.size} selected
            </span>
            <button
              type="button"
              style={{ background: "none", border: "none", fontSize: 12, color: "var(--accent)", cursor: "pointer" }}
              onClick={toggleAll}
            >
              {selected.size === senders.length ? "Deselect all" : "Select all"}
            </button>
          </div>
          <ul style={{ listStyle: "none", maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
            {senders.map((s) => (
              <li key={s.email}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", cursor: "pointer", borderBottom: "1px solid var(--border)" }}>
                  <input
                    type="checkbox"
                    checked={selected.has(s.email)}
                    onChange={() => toggleSender(s.email)}
                    style={{ accentColor: "var(--accent)", width: 14, height: 14, flexShrink: 0 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.name}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.email} · {s.count} emails
                    </p>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="form-error" style={{ marginBottom: 8 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-primary"
              style={{ fontSize: 13, padding: "9px 18px" }}
              onClick={handleAdd}
              disabled={adding || !selected.size}
            >
              {adding ? "Adding…" : `Add ${selected.size || ""} source${selected.size !== 1 ? "s" : ""}`}
            </button>
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: 13, padding: "9px 14px" }}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
