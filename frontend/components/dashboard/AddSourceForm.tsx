"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Source, type SourceDetection } from "@/lib/api";
import { useUpgradeOptional } from "@/components/billing/UpgradeProvider";
import { isPlanLimitError, sourceSlotUsage, upgradeReasonFromError } from "@/lib/plans";

const TYPE_OVERRIDES = [
  { value: "", label: "Auto-detect" },
  { value: "rss", label: "RSS feed" },
  { value: "youtube", label: "YouTube channel" },
  { value: "reddit", label: "Subreddit" },
  { value: "url", label: "Website" },
  { value: "watched_page", label: "Follow a page (no RSS needed)" },
  { value: "email", label: "Email sender" },
];

export function AddSourceForm({
  sourceCount = 0,
  variant = "default",
  onAdded,
}: {
  sourceCount?: number;
  variant?: "default" | "inline";
  onAdded: (source: Source) => void;
}) {
  const upgrade = useUpgradeOptional();
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [typeOverride, setTypeOverride] = useState("");
  const [detection, setDetection] = useState<SourceDetection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const slots = sourceSlotUsage(upgrade?.billing, sourceCount);
  const atSourceLimit = slots.atLimit;

  const runDetect = useCallback(async (value: string, override: string) => {
    const trimmed = value.trim();
    if (trimmed.length < 3) {
      setDetection(null);
      return;
    }
    setDetecting(true);
    try {
      const result = await api.detectSource({
        identifier: trimmed,
        source_type: override || undefined,
      });
      setDetection(result);
      setError("");
    } catch {
      setDetection(null);
    } finally {
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void runDetect(identifier, typeOverride);
    }, 400);
    return () => clearTimeout(timer);
  }, [identifier, typeOverride, runDetect]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;

    if (atSourceLimit) {
      upgrade?.openUpgrade({ reason: "sources_limit" });
      return;
    }

    setLoading(true);
    setError("");
    try {
      const source = await api.addSource({
        identifier: identifier.trim(),
        source_type: typeOverride || undefined,
        name: name.trim() || undefined,
      });
      setIdentifier("");
      setName("");
      setDetection(null);
      onAdded(source);
      void upgrade?.refreshBilling();
    } catch (err) {
      if (isPlanLimitError(err)) {
        upgrade?.openUpgrade({ reason: upgradeReasonFromError(err) });
        return;
      }
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
    <form className={`source-form${variant === "inline" ? " source-form--inline" : ""}`} onSubmit={handleSubmit}>
      {variant === "default" && <p className="source-form-label">Add a connection</p>}

      <div className={variant === "inline" ? "source-form-primary" : undefined}>
        <label className="field-label">
          {variant === "default" ? "Paste anything" : "Paste a link or address"}
          <input
            type="text"
            placeholder="URL, @channel, subreddit, or email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="field-input"
            disabled={atSourceLimit}
          />
        </label>

        {variant === "inline" && (
          <button
            type="submit"
            className="btn-primary source-submit source-submit--inline"
            disabled={loading || !identifier.trim() || atSourceLimit}
          >
            {atSourceLimit ? "Upgrade" : loading ? "Adding…" : "Add"}
          </button>
        )}
      </div>

      {detecting && <p className="field-hint">Detecting source type…</p>}
      {!detecting && detection && (
        <div className="source-detect-pill">
          <span className="source-detect-type">{detection.label}</span>
          <span className="source-detect-hint">{detection.hint}</span>
        </div>
      )}

      <details className="source-advanced">
        <summary>{variant === "inline" ? "More options" : "Override type"}</summary>
        <label className="field-label">
          Source type
          <select
            value={typeOverride}
            onChange={(e) => setTypeOverride(e.target.value)}
            className="field-input"
            disabled={atSourceLimit}
          >
            {TYPE_OVERRIDES.map((t) => (
              <option key={t.value || "auto"} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        {variant === "inline" && (
          <label className="field-label">
            <span>Display name <span className="field-optional">optional</span></span>
            <input
              type="text"
              placeholder="My favourite newsletter"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field-input"
              disabled={atSourceLimit}
            />
          </label>
        )}
      </details>

      {variant === "default" && (
        <label className="field-label">
          <span>Display name <span className="field-optional">optional</span></span>
          <input
            type="text"
            placeholder="My favourite newsletter"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="field-input"
            disabled={atSourceLimit}
          />
        </label>
      )}

      {variant === "default" && (
        <button
          type="submit"
          className="btn-primary source-submit"
          disabled={loading || !identifier.trim() || atSourceLimit}
        >
          {atSourceLimit ? "Upgrade to add more" : loading ? "Adding…" : "Add connection"}
        </button>
      )}
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
