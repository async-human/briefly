"use client";

import { useState } from "react";
import { api, type Source } from "@/lib/api";

const SOURCE_TYPES = [
  { value: "rss", label: "RSS feed", placeholder: "https://example.com/feed.xml" },
  { value: "youtube", label: "YouTube channel", placeholder: "Channel ID or URL" },
  { value: "reddit", label: "Subreddit", placeholder: "MachineLearning" },
  { value: "email", label: "Email sender", placeholder: "newsletter@example.com" },
];

export function AddSourceForm({ onAdded }: { onAdded: (source: Source) => void }) {
  const [sourceType, setSourceType] = useState("rss");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const current = SOURCE_TYPES.find((t) => t.value === sourceType)!;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    setLoading(true);
    setError("");
    try {
      const source = await api.addSource({
        source_type: sourceType,
        identifier: identifier.trim(),
        name: name.trim() || undefined,
      });
      setIdentifier("");
      setName("");
      onAdded(source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add source");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="source-form" onSubmit={handleSubmit}>
      <div className="source-form-row">
        <select
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
          className="source-select"
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder={current.placeholder}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="source-input"
        />
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Adding…" : "Add"}
        </button>
      </div>
      <input
        type="text"
        placeholder="Display name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="source-input source-input-full"
      />
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}
