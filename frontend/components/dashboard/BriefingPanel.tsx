"use client";

import React, { useState } from "react";
import Link from "next/link";
import { api, type AutoSuggestion, type Digest, type DigestItem, type Source } from "@/lib/api";
import {
  groupDigestItemsBySection,
  SECTION_HIGHLY_RELEVANT,
  SECTION_WHATS_NEW,
  sectionBadgeClass,
} from "@/lib/digestSections";
import { AddSourceForm, CopyEmailButton } from "./AddSourceForm";
import { CollapsibleCard } from "./CollapsibleCard";
import { GmailDiscovery } from "./GmailDiscovery";
import { SourceSuggestions } from "./SourceSuggestions";
import { IngestionPanel } from "./IngestionPanel";
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
  onSourceUpdated?: (source: Source) => void;
  onRediscover?: () => void;
};

export function SourcesSidebar({
  ingestionEmail,
  sources,
  gmailConnected,
  autoSuggestions = [],
  onSourceAdded,
  onSourceRemoved,
  onSourceUpdated,
  onRediscover,
}: SourcesSidebarProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [showAllSources, setShowAllSources] = useState(false);

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

  async function handleTogglePriority(source: Source) {
    const current = source.priority ?? "normal";
    const next = current === "high" ? "normal" : "high";
    setPriorityId(source.id);
    try {
      const updated = await api.setSourcePriority(source.id, next);
      onSourceUpdated?.(updated);
    } catch {
      // keep previous state
    } finally {
      setPriorityId(null);
    }
  }

  const emailSources = sources.filter((s) => s.source_type === "email");
  const SOURCE_PREVIEW = 8;
  const visibleSources = showAllSources ? sources : sources.slice(0, SOURCE_PREVIEW);
  const hiddenCount = sources.length - SOURCE_PREVIEW;

  return (
    <aside className="dash-sidebar dash-aside-col">
      <div className="dash-card dash-card-primary">
        <div className="dash-card-head">
          <div>
            <h2 className="dash-card-title">Sources</h2>
            <p className="dash-card-desc dash-card-desc-tight">
              Star sources you always want in your briefing (Medium, YC, etc.).
            </p>
          </div>
          <span className="source-count">{sources.length}</span>
        </div>
        <AddSourceForm onAdded={onSourceAdded} />
        {sources.length > 0 && (
          <>
            <ul className="source-list source-list-connected source-list-compact">
              {visibleSources.map((source) => (
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
                    className={`source-priority-btn${(source.priority ?? "normal") === "high" ? " is-high" : ""}`}
                    onClick={() => void handleTogglePriority(source)}
                    disabled={priorityId === source.id}
                    aria-label={
                      (source.priority ?? "normal") === "high"
                        ? `Unstar ${sourceDisplayName(source)}`
                        : `Star ${sourceDisplayName(source)} for priority`
                    }
                    title={
                      (source.priority ?? "normal") === "high"
                        ? "Priority source — click to unstar"
                        : "Star to prioritize in briefings"
                    }
                  >
                    {priorityId === source.id ? "…" : (source.priority ?? "normal") === "high" ? "★" : "☆"}
                  </button>
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
            {hiddenCount > 0 && !showAllSources && (
              <button
                type="button"
                className="source-list-expand"
                onClick={() => setShowAllSources(true)}
              >
                Show all {sources.length} sources
              </button>
            )}
          </>
        )}
        <p className="dash-sidebar-footnote">
          Interests & delivery in{" "}
          <Link href="/settings" className="dash-inline-link">Preferences</Link>
          {onRediscover && (
            <>
              {" · "}
              <button type="button" className="dash-inline-link" onClick={onRediscover}>
                Re-discover
              </button>
            </>
          )}
        </p>
      </div>

      <CollapsibleCard label="Suggestions" title="Recommended sources" defaultOpen={false}>
        <SourceSuggestions
          existingSources={sources}
          onAdded={onSourceAdded}
          autoSuggestions={autoSuggestions}
          embedded
        />
      </CollapsibleCard>

      <CollapsibleCard label="Sync" title="Content pool" defaultOpen={false}>
        <IngestionPanel embedded />
      </CollapsibleCard>

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

function BriefingPreviewItem({
  item,
  index,
  digestId,
}: {
  item: DigestItem;
  index: number;
  digestId?: string;
}) {
  const content = (
    <>
      <span className="briefing-preview-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="briefing-preview-body">
        <h3 className="briefing-preview-headline">{item.headline}</h3>
        <p className="briefing-preview-meta">{item.source_name}</p>
      </div>
      {digestId && <span className="briefing-preview-chevron" aria-hidden>→</span>}
    </>
  );

  if (digestId) {
    return (
      <Link href={`/dashboard/read/${digestId}`} className="briefing-preview-item briefing-preview-link">
        {content}
      </Link>
    );
  }

  return <article className="briefing-preview-item">{content}</article>;
}

function sectionSubtitle(section: string): string {
  if (section === SECTION_WHATS_NEW) return "Latest from each of your sources";
  if (section === SECTION_HIGHLY_RELEVANT) return "Matched to your interests and profile";
  return "";
}

function buildGroupedPreview(items: DigestItem[], limit: number) {
  const groups = groupDigestItemsBySection(items);
  let shown = 0;
  const result: { section: string; items: DigestItem[] }[] = [];
  for (const group of groups) {
    const take = Math.min(group.items.length, limit - shown);
    if (take <= 0) break;
    result.push({ section: group.section, items: group.items.slice(0, take) });
    shown += take;
  }
  return { groups: result, shown };
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
  "Matching to your interests…",
  "Building What's new & Highly relevant…",
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
  onRegenerate?: () => void;
};

export function BriefingPanel({
  digest,
  sourcesCount,
  generating,
  generatingPhase = 0,
  generateError,
  generateWarnings = [],
  onRegenerate,
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
            ? "We're preparing today's items. This usually takes a minute with many sources."
            : "Add a source in the sidebar to get your first briefing."}
        </p>
        {sourcesCount > 0 && onRegenerate && !generating && (
          <button
            type="button"
            className="briefing-refresh briefing-empty-regenerate"
            onClick={onRegenerate}
          >
            Regenerate briefing
          </button>
        )}
        {generateError && <p className="form-error" style={{ marginTop: 16 }}>{generateError}</p>}
      </div>
    );
  }

  const preview = buildGroupedPreview(digest.items, PREVIEW_LIMIT);
  const remaining = digest.items.length - preview.shown;
  let previewIndex = 0;

  return (
    <div className="briefing-panel">
      <div className="briefing-panel-header briefing-panel-header-compact">
        <div>
          <h2 className="briefing-panel-title">Today&apos;s briefing</h2>
          <p className="briefing-panel-sub briefing-panel-sub-inline">
            {digest.total_items_shown} curated items · {digest.digest_date}
          </p>
        </div>
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

      <div className="briefing-preview-list">
        {generating ? (
          Array.from({ length: 4 }).map((_, i) => <BriefingItemSkeleton key={i} />)
        ) : preview.shown > 0 ? (
          preview.groups.map((group) => (
            <section key={group.section} className="briefing-section-group">
              <header className="briefing-section-head">
                <span className={sectionBadgeClass(group.section)}>{group.section}</span>
                {sectionSubtitle(group.section) && (
                  <p className="briefing-section-sub">{sectionSubtitle(group.section)}</p>
                )}
              </header>
              <div className="briefing-section-items">
                {group.items.map((item) => {
                  previewIndex += 1;
                  return (
                    <BriefingPreviewItem
                      key={item.id}
                      item={item}
                      index={previewIndex - 1}
                      digestId={digest.id}
                    />
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <div className="briefing-tab-empty">
            <p>No items in today&apos;s briefing.</p>
            {sourcesCount > 0 && onRegenerate && (
              <button
                type="button"
                className="briefing-tab-empty-btn btn-primary"
                onClick={onRegenerate}
              >
                Regenerate briefing
              </button>
            )}
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
