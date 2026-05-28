"use client";

import { useState } from "react";
import { api, type Source } from "@/lib/api";

const SOURCE_TYPES = [
  {
    value: "rss",
    label: "RSS feed",
    placeholder: "https://feeds.arstechnica.com/arstechnica/index",
    hint: "Any blog or news RSS/Atom URL.",
  },
  {
    value: "youtube",
    label: "YouTube channel",
    placeholder: "https://www.youtube.com/@mkbhd",
    hint: "Channel URL, @handle, or channel ID (UC…).",
  },
  {
    value: "reddit",
    label: "Subreddit",
    placeholder: "technology",
    hint: "Subreddit name without r/ — e.g. MachineLearning",
  },
  {
    value: "email",
    label: "Email sender",
    placeholder: "newsletter@example.com",
    hint: "Or forward mail to your ingestion address below.",
  },
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
      const message = err instanceof Error ? err.message : "Failed to add source";
      setError(
        message.includes("already connected")
          ? "Already connected — use a different URL to add another source."
          : message,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="source-form" onSubmit={handleSubmit}>
      <label className="field-label">
        Type
        <select
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
          className="field-input"
        >
          {SOURCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </label>
      <label className="field-label">
        URL or identifier
        <input
          type="text"
          placeholder={current.placeholder}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="field-input"
        />
      </label>
      <p className="field-hint">{current.hint}</p>
      <label className="field-label">
        <span>Display name <span className="field-optional">optional</span></span>
        <input
          type="text"
          placeholder="My favourite newsletter"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field-input"
        />
      </label>
      <button type="submit" className="btn-primary source-submit" disabled={loading}>
        {loading ? "Adding…" : "Add source"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </form>
  );
}

export function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className="copy-email-btn" onClick={handleCopy}>
      {copied ? "Copied" : "Copy address"}
    </button>
  );
}
