"use client";

import React, { useState } from "react";
import Link from "next/link";
import { api, type AutoSuggestion, type Digest, type DigestItem, type Source } from "@/lib/api";
import { AddSourceForm, CopyEmailButton } from "./AddSourceForm";
import { CollapsibleCard } from "./CollapsibleCard";
import { GmailDiscovery } from "./GmailDiscovery";
import { SourceSuggestions } from "./SourceSuggestions";
import { sourceDisplayName } from "./sourceLabels";
import { SourceIcon } from "@/components/SourceIcon";

const PREVIEW_LIMIT = 5;

type SourcesSidebarProps = {
  ingestionEmail: string;
  sources: Source[];
  gmailConnected: boolean;
  autoSuggestions?: AutoSuggestion[];
  onSourceAdded: (source: Source) => void;
  onSourceRemoved: (sourceId: string) => void;
};

export function SourcesSidebar({
  ingestionEmail,
  sources,
  gmailConnected,
  autoSuggestions = [],
  onSourceAdded,
  onSourceRemoved,
}: SourcesSidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(sourceId: string) {
    setDeletingId(sourceId);
    try {
      await api.deleteSource(sourceId);
      onSourceRemoved(sourceId);
    } catch {
      // keep in list on failure
    } finally {
      setDeletingId(null);
    }
  }

  const emailSources = sources.filter((s) => s.source_type === "email");

  return (
    <aside className="dash-sidebar">
      <div className="dash-card dash-card-primary">
        <div className="dash-card-head">
          <div>
            <p className="dash-card-label">Step 1</p>
            <h2 className="dash-card-title">Your sources</h2>
          </div>
          <span className="source-count">{sources.length}</span>
        </div>
        <p className="dash-card-desc">
          Paste a URL, channel, or RSS feed. Briefly detects the type automatically.
        </p>
        <AddSourceForm onAdded={onSourceAdded} />
        {sources.length > 0 && (
          <ul className="source-list source-list-connected source-list-compact">
            {sources.map((source) => (
              <li key={source.id} className="source-list-item">
                <span className="source-type-icon">
                  <SourceIcon
                    type={source.source_type}
                    name={source.name ?? undefined}
                    url={source.identifier?.startsWith("http") ? source.identifier : undefined}
                    size={18}
                  />
                </span>
                <div className="source-info">
                  <span className="source-name">{sourceDisplayName(source)}</span>
                </div>
                <button
                  type="button"
                  className="source-delete-btn"
                  onClick={() => handleDelete(source.id)}
                  disabled={deletingId === source.id}
                  aria-label={`Remove ${sourceDisplayName(source)}`}
                >
                  {deletingId === source.id ? "…" : "×"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="dash-sidebar-footnote">
          Topic filters and delivery time are in{" "}
          <Link href="/settings" className="dash-inline-link">Preferences</Link>.
        </p>
      </div>

      <SourceSuggestions
        existingSources={sources}
        onAdded={onSourceAdded}
        autoSuggestions={autoSuggestions}
      />

      <CollapsibleCard
        label="Optional"
        title="Newsletter forwarding"
        defaultOpen={emailSources.length > 0}
        badge={emailSources.length || undefined}
      >
        <p className="dash-card-desc">
          Use your personal address when subscribing, or forward existing newsletters here.
        </p>
        <div className="nl-address-row nl-address-row-compact">
          <code className="ingestion-email">{ingestionEmail}</code>
          <CopyEmailButton email={ingestionEmail} />
        </div>
        <a
          href="https://mail.google.com/mail/u/0/#settings/filters"
          target="_blank"
          rel="noopener noreferrer"
          className="nl-link"
        >
          Set up Gmail forwarding →
        </a>
        {emailSources.length > 0 && (
          <div className="nl-active">
            <p className="nl-active-label">Receiving from</p>
            <ul className="nl-active-list">
              {emailSources.map((s) => (
                <li key={s.id} className="nl-active-item">
                  <span className="nl-active-dot" aria-hidden />
                  <span className="nl-active-name">{s.name || s.identifier}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleCard>

      {(gmailConnected || !sources.some((s) => s.source_type === "readwise")) && (
        <CollapsibleCard label="Optional" title="More integrations">
          {gmailConnected && <GmailDiscovery onAdded={onSourceAdded} compact />}
          <ReadwiseCard
            sources={sources}
            onAdded={onSourceAdded}
            onRemoved={onSourceRemoved}
            compact
          />
        </CollapsibleCard>
      )}
    </aside>
  );
}

// ── Readwise card ─────────────────────────────────────────────────────────────

function ReadwiseCard({
  sources,
  onAdded,
  onRemoved,
  compact = false,
}: {
  sources: Source[];
  onAdded: (s: Source) => void;
  onRemoved: (id: string) => void;
  compact?: boolean;
}) {
  const connected = sources.find((s) => s.source_type === "readwise");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setSaving(true);
    setError("");
    try {
      const src = await api.connectReadwise(key.trim());
      onAdded(src);
      setKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!connected) return;
    try {
      await api.disconnectReadwise();
      onRemoved(connected.id);
    } catch {/* silent */}
  }

  return (
    <div className={compact ? "dash-integration-block" : "dash-card"}>
      {!compact && (
        <>
          <p className="dash-card-label">Readwise</p>
          <h2 className="dash-card-title">Saved reading list</h2>
        </>
      )}
      {compact && <p className="dash-integration-label">Readwise</p>}
      {connected ? (
        <div>
          <p className="dash-card-desc" style={{ marginBottom: 12 }}>
            Connected — saved articles are included in briefings.
          </p>
          <button type="button" className="briefing-refresh" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={handleConnect}>
          {!compact && (
            <p className="dash-card-desc">
              Paste your Readwise API key to include saved articles in your briefing.
            </p>
          )}
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Readwise API key"
            className="field-input"
            style={{ marginBottom: 8 }}
          />
          {error && <p className="form-error" style={{ marginBottom: 8 }}>{error}</p>}
          <button type="submit" className="briefing-refresh" disabled={saving || !key.trim()}>
            {saving ? "Connecting…" : "Connect Readwise"}
          </button>
        </form>
      )}
    </div>
  );
}

// ── Briefing preview item (dashboard — compact, no inline reading) ───────────

function BriefingPreviewItem({ item, index }: { item: DigestItem; index: number }) {
  return (
    <article className="briefing-preview-item">
      <span className="briefing-preview-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="briefing-preview-body">
        {item.section && <p className="briefing-preview-section">{item.section}</p>}
        <h3 className="briefing-preview-headline">{item.headline}</h3>
        <p className="briefing-preview-meta">{item.source_name}</p>
      </div>
    </article>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

function BriefingItemSkeleton() {
  return (
    <article className="briefing-preview-item briefing-item-skeleton" aria-hidden>
      <span className="skeleton-block" style={{ width: 24, height: 14, borderRadius: 3 }} />
      <div className="briefing-preview-body" style={{ gap: 8, display: "flex", flexDirection: "column" }}>
        <span className="skeleton-block" style={{ width: "40%", height: 10 }} />
        <span className="skeleton-block" style={{ width: "88%", height: 16 }} />
        <span className="skeleton-block" style={{ width: "35%", height: 11 }} />
      </div>
    </article>
  );
}

const GENERATING_PHASES = [
  "Fetching from your sources…",
  "Scoring what matters to you…",
  "Writing your briefing…",
];

type BriefingPanelProps = {
  digest: Digest | null;
  sources: Source[];
  sourcesCount: number;
  generating: boolean;
  generatingPhase?: number;
  generateError: string;
  generateWarnings?: string[];
};

export function BriefingPanel({
  digest,
  sourcesCount,
  generating,
  generatingPhase = 0,
  generateError,
  generateWarnings = [],
}: BriefingPanelProps) {
  if (!digest) {
    if (generating) {
      return (
        <div className="briefing-panel">
          <div className="briefing-panel-header">
            <h2 className="briefing-panel-title">Today&apos;s briefing</h2>
          </div>
          <div className="briefing-generating-bar">
            <span className="briefing-generating-dot" />
            {GENERATING_PHASES[generatingPhase] ?? GENERATING_PHASES[0]}
          </div>
          <div className="briefing-preview-list">
            {Array.from({ length: 4 }).map((_, i) => (
              <BriefingItemSkeleton key={i} />
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="briefing-empty">
        <div className="briefing-empty-icon">
          <span className="briefing-empty-ring" />
        </div>
        <h2 className="briefing-empty-title">Your briefing will appear here</h2>
        <p className="briefing-empty-desc">
          {sourcesCount > 0
            ? "We're preparing today's items. This usually takes a few seconds."
            : "Add a source on the right — RSS, YouTube, Reddit, or any URL."}
        </p>
        {generateError && <p className="form-error" style={{ marginTop: 16 }}>{generateError}</p>}
      </div>
    );
  }

  const previewItems = digest.items.slice(0, PREVIEW_LIMIT);
  const remaining = digest.items.length - previewItems.length;

  return (
    <div className="briefing-panel">
      <div className="briefing-panel-header">
        <div>
          <p className="dash-card-label">Step 2</p>
          <h2 className="briefing-panel-title">Today&apos;s briefing</h2>
        </div>
        {!generating && digest.items.length > 0 && (
          <Link href={`/dashboard/read/${digest.id}`} className="briefing-panel-read-link">
            Open reading mode →
          </Link>
        )}
      </div>

      {generating && (
        <div className="briefing-generating-bar">
          <span className="briefing-generating-dot" />
          Updating your briefing…
        </div>
      )}

      {generateWarnings.length > 0 && (
        <ul className="briefing-warnings briefing-warnings-panel">
          {generateWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <p className="briefing-panel-sub">
        {digest.total_items_shown} curated items · {digest.digest_date}
        {digest.items.length > 0 && " · Tap below to read with summaries and why-it-matters"}
      </p>

      <div className="briefing-preview-list">
        {generating ? (
          Array.from({ length: 4 }).map((_, i) => <BriefingItemSkeleton key={i} />)
        ) : previewItems.length > 0 ? (
          previewItems.map((item, index) => (
            <BriefingPreviewItem key={item.id} item={item} index={index} />
          ))
        ) : (
          <div className="briefing-tab-empty">
            <p>No items in today&apos;s briefing.</p>
          </div>
        )}
      </div>

      {!generating && digest.items.length > 0 && (
        <div className="briefing-preview-footer">
          {remaining > 0 && (
            <p className="briefing-preview-more">
              +{remaining} more item{remaining === 1 ? "" : "s"} in reading mode
            </p>
          )}
          <Link href={`/dashboard/read/${digest.id}`} className="briefing-preview-cta">
            Read full brief ({digest.items.length} items)
          </Link>
        </div>
      )}

      {generateError && <p className="form-error briefing-error">{generateError}</p>}
    </div>
  );
}
