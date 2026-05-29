"use client";

import React, { useEffect, useMemo, useState } from "react";
import { api, type Digest, type DigestItem, type Source } from "@/lib/api";
import { AddSourceForm, CopyEmailButton } from "./AddSourceForm";
import { GmailDiscovery } from "./GmailDiscovery";
import { SourceSuggestions } from "./SourceSuggestions";
import {
  SOURCE_TYPE_LABELS,
  matchItemToSource,
  sourceDisplayName,
} from "./sourceLabels";

// ── Sidebar ───────────────────────────────────────────────────────────────────

type SourcesSidebarProps = {
  ingestionEmail: string;
  sources: Source[];
  gmailConnected: boolean;
  onSourceAdded: (source: Source) => void;
  onSourceRemoved: (sourceId: string) => void;
};

export function SourcesSidebar({
  ingestionEmail,
  sources,
  gmailConnected,
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

  return (
    <aside className="dash-sidebar">
      <div className="dash-card">
        <p className="dash-card-label">Ingestion email</p>
        <h2 className="dash-card-title">Forward newsletters here</h2>
        <p className="dash-card-desc">
          Any email sent to this address becomes a source in your briefing.
        </p>
        <div className="ingestion-box">
          <code className="ingestion-email">{ingestionEmail}</code>
          <CopyEmailButton email={ingestionEmail} />
        </div>
      </div>

      <div className="dash-card">
        <div className="dash-card-head">
          <div>
            <p className="dash-card-label">Sources</p>
            <h2 className="dash-card-title">What you follow</h2>
          </div>
          <span className="source-count">{sources.length}</span>
        </div>
        {sources.length > 0 && (
          <ul className="source-list source-list-connected">
            {sources.map((source) => (
              <li key={source.id} className="source-list-item">
                <span className="source-type">
                  {SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}
                </span>
                <div className="source-info">
                  <span className="source-name">{sourceDisplayName(source)}</span>
                  {source.name && <span className="source-id">{source.identifier}</span>}
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
        <p className="source-add-hint">
          {sources.length === 0
            ? "Paste any URL, channel, or subreddit below."
            : "Add another source — paste anything, we'll detect the type."}
        </p>
        <AddSourceForm onAdded={onSourceAdded} />
      </div>

      {gmailConnected && (
        <GmailDiscovery onAdded={onSourceAdded} />
      )}

      <SourceSuggestions existingSources={sources} onAdded={onSourceAdded} />

      <ReadwiseCard sources={sources} onAdded={onSourceAdded} onRemoved={onSourceRemoved} />
    </aside>
  );
}

// ── Readwise card ─────────────────────────────────────────────────────────────

function ReadwiseCard({
  sources,
  onAdded,
  onRemoved,
}: {
  sources: Source[];
  onAdded: (s: Source) => void;
  onRemoved: (id: string) => void;
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
    <div className="dash-card">
      <p className="dash-card-label">Readwise</p>
      <h2 className="dash-card-title">Saved reading list</h2>
      {connected ? (
        <div>
          <p className="dash-card-desc" style={{ marginBottom: 12 }}>
            Connected — your saved Readwise articles are included in briefings.
          </p>
          <button type="button" className="briefing-refresh" onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={handleConnect}>
          <p className="dash-card-desc">
            Paste your Readwise API key to include saved articles in your briefing.
          </p>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="rw_..."
            className="field-input"
            style={{ marginBottom: 8 }}
          />
          {error && <p className="form-error" style={{ marginBottom: 8 }}>{error}</p>}
          <button type="submit" className="briefing-refresh" disabled={saving || !key.trim()}>
            {saving ? "Connecting…" : "Connect"}
          </button>
        </form>
      )}
    </div>
  );
}

// ── Source tabs ───────────────────────────────────────────────────────────────

type SourceTab = {
  id: string;
  label: string;
  type: string;
  items: DigestItem[];
};

function buildSourceTabs(items: DigestItem[], sources: Source[]): SourceTab[] {
  const grouped = new Map<string, DigestItem[]>();
  const other: DigestItem[] = [];

  for (const source of sources) {
    grouped.set(source.id, []);
  }

  for (const item of items) {
    const match = matchItemToSource(item, sources);
    if (match) {
      grouped.get(match.id)!.push(item);
    } else {
      other.push(item);
    }
  }

  const tabs: SourceTab[] = sources.map((source) => ({
    id: source.id,
    label: sourceDisplayName(source),
    type: source.source_type,
    items: grouped.get(source.id) ?? [],
  }));

  if (other.length > 0) {
    tabs.push({ id: "__other__", label: "Other", type: "other", items: other });
  }

  return tabs;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function BriefingItemSkeleton() {
  return (
    <article className="briefing-item briefing-item-skeleton" aria-hidden>
      <span className="skeleton-block" style={{ width: 24, height: 14, borderRadius: 3 }} />
      <div className="briefing-item-body" style={{ gap: 8 }}>
        <span className="skeleton-block" style={{ width: "55%", height: 11 }} />
        <span className="skeleton-block" style={{ width: "88%", height: 17 }} />
        <span className="skeleton-block" style={{ width: "70%", height: 17 }} />
        <span className="skeleton-block" style={{ width: "92%", height: 13, marginTop: 4 }} />
        <span className="skeleton-block" style={{ width: "80%", height: 13 }} />
        <span className="skeleton-block" style={{ width: "60%", height: 13 }} />
      </div>
    </article>
  );
}

// ── Briefing item ─────────────────────────────────────────────────────────────

function FeedbackButton({
  icon, label, active, activeColor, onClick,
}: {
  icon: string; label: string; active: boolean; activeColor: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: 14,
        color: active ? activeColor : "var(--text-muted)",
        transition: "color 0.15s, transform 0.1s",
        transform: active ? "scale(1.2)" : "scale(1)",
        padding: "2px 4px",
        lineHeight: 1,
      }}
    >
      {icon}
    </button>
  );
}

function BriefingItemCard({ item, digestId, index }: { item: DigestItem; digestId: string; index: number }) {
  const [liked, setLiked] = useState(false);
  const [disliked, setDisliked] = useState(false);

  function sendFeedback(type: "liked" | "disliked") {
    api.recordFeedback({ signal_type: type, digest_item_id: item.id, digest_id: digestId })
      .catch(() => {/* silent */});
  }

  function handleLike() {
    if (liked) return;
    setLiked(true);
    setDisliked(false);
    sendFeedback("liked");
  }

  function handleDislike() {
    if (disliked) return;
    setDisliked(true);
    setLiked(false);
    sendFeedback("disliked");
  }

  return (
    <article className="briefing-item">
      <span className="briefing-item-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="briefing-item-body">
        {item.section && <p className="briefing-item-section">{item.section}</p>}
        <div className="briefing-item-meta">
          <span>{item.source_name}</span>
          {item.source_url && (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer">
              Read source
            </a>
          )}
        </div>
        <h3 className="briefing-item-headline">{item.headline}</h3>
        {item.summary && <p className="briefing-item-summary">{item.summary}</p>}
        <blockquote className="briefing-item-why">{item.why_it_matters}</blockquote>
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 10 }}>
          <FeedbackButton icon="👍" label="More like this" active={liked} activeColor="var(--accent)" onClick={handleLike} />
          <FeedbackButton icon="👎" label="Less like this" active={disliked} activeColor="#c47070" onClick={handleDislike} />
        </div>
      </div>
    </article>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type BriefingPanelProps = {
  digest: Digest | null;
  sources: Source[];
  sourcesCount: number;
  generating: boolean;
  generateError: string;
  generateWarnings?: string[];
};

export function BriefingPanel({
  digest,
  sources,
  sourcesCount,
  generating,
  generateError,
  generateWarnings = [],
}: BriefingPanelProps) {
  const sourceTabs = useMemo(
    () => (digest ? buildSourceTabs(digest.items, sources) : []),
    [digest, sources],
  );

  const [activeTab, setActiveTab] = useState<"all" | string>("all");

  useEffect(() => {
    if (activeTab === "all") return;
    const stillExists = sourceTabs.some((tab) => tab.id === activeTab);
    if (!stillExists) setActiveTab("all");
  }, [activeTab, sourceTabs]);

  const visibleItems =
    activeTab === "all"
      ? digest?.items ?? []
      : sourceTabs.find((tab) => tab.id === activeTab)?.items ?? [];

  const activeTabMeta = sourceTabs.find((tab) => tab.id === activeTab);

  // ── No digest yet — show skeleton if generating, else wait-state ─────────
  if (!digest) {
    if (generating) {
      return (
        <div className="briefing-panel">
          <div className="briefing-generating-bar">
            <span className="briefing-generating-dot" />
            Reading your feeds…
          </div>
          <div className="briefing-items">
            {Array.from({ length: 5 }).map((_, i) => (
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
        <h2 className="briefing-empty-title">No briefing yet</h2>
        <p className="briefing-empty-desc">
          {sourcesCount > 0
            ? "Your briefing is being prepared. Check back in a moment."
            : "Connect a source in the panel on the right — your briefing will generate automatically."}
        </p>
        {generateError && <p className="form-error" style={{ marginTop: 16 }}>{generateError}</p>}
      </div>
    );
  }

  // ── Digest exists ────────────────────────────────────────────────────────
  const showTabs = sources.length > 1 || sourceTabs.some((tab) => tab.id === "__other__");

  return (
    <div className="briefing-panel">
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

      <div className="briefing-toolbar">
        <div className="briefing-stats">
          <span>{digest.total_items_shown} items</span>
          <span className="briefing-stat-dot" />
          <span>{digest.digest_date}</span>
          {showTabs && activeTab !== "all" && (
            <>
              <span className="briefing-stat-dot" />
              <span>{visibleItems.length} in view</span>
            </>
          )}
        </div>
      </div>

      {showTabs && (
        <div className="briefing-tabs-wrap">
          <div className="briefing-tabs" role="tablist" aria-label="Filter by source">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "all"}
              className={`briefing-tab${activeTab === "all" ? " active" : ""}`}
              onClick={() => setActiveTab("all")}
            >
              <span className="briefing-tab-label">All</span>
              <span className="briefing-tab-count">{digest.items.length}</span>
            </button>
            {sourceTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`briefing-tab${activeTab === tab.id ? " active" : ""}${tab.items.length === 0 ? " empty" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="briefing-tab-type">
                  {SOURCE_TYPE_LABELS[tab.type] ?? tab.type}
                </span>
                <span className="briefing-tab-label">{tab.label}</span>
                <span className="briefing-tab-count">{tab.items.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab !== "all" && activeTabMeta && (
        <div className="briefing-tab-context">
          <span className="briefing-tab-context-type">
            {SOURCE_TYPE_LABELS[activeTabMeta.type] ?? activeTabMeta.type}
          </span>
          <span className="briefing-tab-context-name">{activeTabMeta.label}</span>
        </div>
      )}

      <div className="briefing-items" role="tabpanel">
        {generating ? (
          // Show skeletons overlaid when regenerating after a source was added
          Array.from({ length: 5 }).map((_, i) => <BriefingItemSkeleton key={i} />)
        ) : visibleItems.length > 0 ? (
          visibleItems.map((item, index) => (
            <BriefingItemCard key={item.id} item={item} digestId={digest.id} index={index} />
          ))
        ) : (
          <div className="briefing-tab-empty">
            <p>No items from this source in today&apos;s briefing.</p>
            <button type="button" className="briefing-tab-empty-btn" onClick={() => setActiveTab("all")}>
              View all sources
            </button>
          </div>
        )}
      </div>

      {generateError && <p className="form-error briefing-error">{generateError}</p>}
    </div>
  );
}
