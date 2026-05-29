"use client";

import { useEffect, useState } from "react";
import { api, type Source, type SourceSuggestion } from "@/lib/api";

export function SourceSuggestions({
  existingSources,
  onAdded,
}: {
  existingSources: Source[];
  onAdded: (s: Source) => void;
}) {
  const [suggestions, setSuggestions] = useState<SourceSuggestion[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getSourceSuggestions().then(setSuggestions).catch(() => {});
  }, []);

  const existingUrls = new Set(existingSources.map((s) => s.identifier.toLowerCase()));
  const visible = suggestions.filter(
    (s) => !existingUrls.has(s.url.toLowerCase()) && !dismissed.has(s.url),
  );

  if (visible.length === 0) return null;

  async function handleAdd(suggestion: SourceSuggestion) {
    setAdding(suggestion.url);
    try {
      const src = await api.addSource({ identifier: suggestion.url, name: suggestion.name });
      onAdded(src);
      setDismissed((prev) => new Set([...prev, suggestion.url]));
    } catch {/* silent — source may already exist */
      setDismissed((prev) => new Set([...prev, suggestion.url]));
    } finally {
      setAdding(null);
    }
  }

  function handleDismiss(url: string) {
    setDismissed((prev) => new Set([...prev, url]));
  }

  return (
    <div className="dash-card">
      <p className="dash-card-label">Suggested for you</p>
      <h2 className="dash-card-title">Sources you might like</h2>
      <p className="dash-card-desc" style={{ marginBottom: 12 }}>
        Based on your interests — one click to add.
      </p>
      <ul style={{ listStyle: "none" }}>
        {visible.slice(0, 6).map((s) => (
          <li
            key={s.url}
            style={{
              padding: "10px 0",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: "0 0 2px", fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
                {s.name}
              </p>
              <p style={{ margin: "0 0 4px", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                {s.description}
              </p>
              <span style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {s.topic}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
              <button
                type="button"
                className="briefing-refresh"
                style={{ padding: "5px 12px", fontSize: 12 }}
                onClick={() => handleAdd(s)}
                disabled={adding === s.url}
              >
                {adding === s.url ? "…" : "+ Add"}
              </button>
              <button
                type="button"
                style={{ background: "none", border: "none", fontSize: 11, color: "var(--text-muted)", cursor: "pointer", textAlign: "center" }}
                onClick={() => handleDismiss(s.url)}
              >
                Skip
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
