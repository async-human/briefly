"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type AutoSuggestion, type Source, type SourceSuggestion } from "@/lib/api";

type SuggestionItem = SourceSuggestion | AutoSuggestion;

function isAuto(s: SuggestionItem): s is AutoSuggestion {
  return "reason" in s && Boolean((s as AutoSuggestion).reason);
}

export function SourceSuggestions({
  existingSources,
  onAdded,
  autoSuggestions = [],
}: {
  existingSources: Source[];
  onAdded: (s: Source) => void;
  autoSuggestions?: AutoSuggestion[];
}) {
  const [catalogSuggestions, setCatalogSuggestions] = useState<SourceSuggestion[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (autoSuggestions.length === 0) {
      api.getSourceSuggestions().then(setCatalogSuggestions).catch(() => {});
    }
  }, [autoSuggestions.length]);

  const existingUrls = useMemo(
    () => new Set(existingSources.map((s) => s.identifier.toLowerCase())),
    [existingSources],
  );

  const autoVisible = autoSuggestions.filter(
    (s) => !existingUrls.has(s.url.toLowerCase()) && !dismissed.has(s.url),
  );

  const catalogVisible = catalogSuggestions.filter(
    (s) =>
      !existingUrls.has(s.url.toLowerCase()) &&
      !dismissed.has(s.url) &&
      !autoSuggestions.some((a) => a.url.toLowerCase() === s.url.toLowerCase()),
  );

  if (autoVisible.length === 0 && catalogVisible.length === 0) return null;

  async function handleAdd(suggestion: SuggestionItem) {
    setAdding(suggestion.url);
    try {
      const src = await api.addSource({ identifier: suggestion.url, name: suggestion.name });
      onAdded(src);
      setDismissed((prev) => new Set(Array.from(prev).concat(suggestion.url)));
    } catch {
      setDismissed((prev) => new Set(Array.from(prev).concat(suggestion.url)));
    } finally {
      setAdding(null);
    }
  }

  function handleDismiss(url: string) {
    setDismissed((prev) => new Set(Array.from(prev).concat(url)));
  }

  function renderRow(s: SuggestionItem, showReason: boolean) {
    return (
      <li key={s.url} className="suggestion-row">
        <div className="suggestion-row-body">
          <div className="suggestion-row-head">
            <p className="suggestion-row-name">{s.name}</p>
            {isAuto(s) && s.source === "medium" && (
              <span className="suggestion-badge suggestion-badge-medium">Medium</span>
            )}
          </div>
          <p className="suggestion-row-desc">{s.description}</p>
          {showReason && isAuto(s) && s.reason && (
            <p className="suggestion-row-reason">{s.reason}</p>
          )}
          <span className="suggestion-row-topic">{s.topic}</span>
        </div>
        <div className="suggestion-row-actions">
          <button
            type="button"
            className="briefing-refresh suggestion-add-btn"
            onClick={() => handleAdd(s)}
            disabled={adding === s.url}
          >
            {adding === s.url ? "…" : "+ Add"}
          </button>
          <button
            type="button"
            className="suggestion-dismiss-btn"
            onClick={() => handleDismiss(s.url)}
          >
            Skip
          </button>
        </div>
      </li>
    );
  }

  return (
    <>
      {autoVisible.length > 0 && (
        <div className="dash-card suggestion-card suggestion-card-auto">
          <p className="dash-card-label">Picked for you</p>
          <h2 className="dash-card-title">Based on what you read</h2>
          <p className="dash-card-desc">
            Briefly learns from your saves and clicks — including Medium tag feeds when they match.
          </p>
          <ul className="suggestion-list">
            {autoVisible.slice(0, 6).map((s) => renderRow(s, true))}
          </ul>
        </div>
      )}

      {catalogVisible.length > 0 && (
        <div className="dash-card suggestion-card">
          <p className="dash-card-label">Suggested for you</p>
          <h2 className="dash-card-title">Sources you might like</h2>
          <p className="dash-card-desc">Based on your declared interests — one click to add.</p>
          <ul className="suggestion-list">
            {catalogVisible.slice(0, 6).map((s) => renderRow(s, false))}
          </ul>
        </div>
      )}
    </>
  );
}
