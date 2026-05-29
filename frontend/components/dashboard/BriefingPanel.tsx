"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type Digest, type DigestItem, type Source } from "@/lib/api";
import { AddSourceForm, CopyEmailButton } from "./AddSourceForm";
import {
  SOURCE_TYPE_LABELS,
  matchItemToSource,
  sourceDisplayName,
} from "./sourceLabels";

type SourcesSidebarProps = {
  ingestionEmail: string;
  sources: Source[];
  onSourceAdded: (source: Source) => void;
  onSourceRemoved: (sourceId: string) => void;
};

export function SourcesSidebar({
  ingestionEmail,
  sources,
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
    </aside>
  );
}

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
    tabs.push({
      id: "__other__",
      label: "Other",
      type: "other",
      items: other,
    });
  }

  return tabs;
}

function BriefingItemCard({ item, index }: { item: DigestItem; index: number }) {
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
      </div>
    </article>
  );
}

type BriefingPanelProps = {
  digest: Digest | null;
  sources: Source[];
  sourcesCount: number;
  generating: boolean;
  generateError: string;
  generateWarnings?: string[];
  onGenerate: () => void;
};

export function BriefingPanel({
  digest,
  sources,
  sourcesCount,
  generating,
  generateError,
  generateWarnings = [],
  onGenerate,
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

  if (!digest) {
    return (
      <div className="briefing-empty">
        <div className="briefing-empty-icon">
          <span className="briefing-empty-ring" />
        </div>
        <h2 className="briefing-empty-title">No briefing yet</h2>
        <p className="briefing-empty-desc">
          Connect a source, then generate your first read — takes about 30 seconds.
        </p>

        <ol className="briefing-steps">
          <li className={sourcesCount > 0 ? "done" : ""}>
            <span className="step-num">1</span>
            <span>Add any source in the panel →</span>
          </li>
          <li>
            <span className="step-num">2</span>
            <span>Click generate below</span>
          </li>
        </ol>

        <button
          type="button"
          className="btn-primary briefing-generate"
          onClick={onGenerate}
          disabled={generating || sourcesCount === 0}
        >
          {generating ? (
            <>
              <span className="btn-spinner" />
              Reading your feeds…
            </>
          ) : (
            "Generate briefing"
          )}
        </button>

        {sourcesCount === 0 && (
          <p className="briefing-empty-hint">
            Add at least one source (RSS, YouTube, Reddit, or website) to continue.
          </p>
        )}
        {generateError && <p className="form-error">{generateError}</p>}
        {generateWarnings.length > 0 && (
          <ul className="briefing-warnings">
            {generateWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const showTabs = sources.length > 1 || sourceTabs.some((tab) => tab.id === "__other__");

  return (
    <div className="briefing-panel">
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
        <button
          type="button"
          className="briefing-refresh"
          onClick={onGenerate}
          disabled={generating}
        >
          {generating ? "Generating…" : "Refresh"}
        </button>
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
        {visibleItems.length > 0 ? (
          visibleItems.map((item, index) => (
            <BriefingItemCard key={item.id} item={item} index={index} />
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
