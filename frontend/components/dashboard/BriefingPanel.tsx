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
import { SourceIcon } from "@/components/SourceIcon";

// ── Never-show inline editor ──────────────────────────────────────────────────

function NeverShowEditor({
  tags,
  onSave,
}: {
  tags: string[];
  onSave: (tags: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");

  function add(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/,+$/, "");
    if (tag && !tags.includes(tag)) onSave([...tags, tag]);
    setInputValue("");
  }

  function remove(tag: string) { onSave(tags.filter((t) => t !== tag)); }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (inputValue) add(inputValue); }
    if (e.key === "Backspace" && !inputValue && tags.length > 0) remove(tags[tags.length - 1]);
  }

  return (
    <div>
      <div className="tag-input-wrap tag-input-wrap--danger" style={{ marginBottom: 8 }}>
        {tags.map((tag) => (
          <span key={tag} className="tag-chip tag-chip--danger">
            {tag}
            <button type="button" onClick={() => remove(tag)} aria-label={`Remove ${tag}`}>×</button>
          </span>
        ))}
        <input
          type="text"
          className="tag-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (inputValue) add(inputValue); }}
          placeholder={tags.length === 0 ? "e.g. crypto, sports, politics" : ""}
        />
      </div>
      {tags.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Nothing filtered yet. Add topics to block.</p>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

type SourcesSidebarProps = {
  ingestionEmail: string;
  sources: Source[];
  gmailConnected: boolean;
  onSourceAdded: (source: Source) => void;
  onSourceRemoved: (sourceId: string) => void;
  neverShow: string[];
  onNeverShowChange: (tags: string[]) => void;
};

export function SourcesSidebar({
  ingestionEmail,
  sources,
  gmailConnected,
  onSourceAdded,
  onSourceRemoved,
  neverShow,
  onNeverShowChange,
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
      <div className="dash-card nl-card">
        <p className="dash-card-label">Newsletters</p>
        <h2 className="dash-card-title">Add any newsletter to your briefing</h2>

        <ol className="nl-steps">
          <li className="nl-step">
            <span className="nl-step-num">1</span>
            <div className="nl-step-body">
              <p className="nl-step-title">Copy your personal Briefly address</p>
              <div className="nl-address-row">
                <code className="ingestion-email">{ingestionEmail}</code>
                <CopyEmailButton email={ingestionEmail} />
              </div>
            </div>
          </li>
          <li className="nl-step">
            <span className="nl-step-num">2</span>
            <div className="nl-step-body">
              <p className="nl-step-title">Use it when subscribing to any newsletter</p>
              <p className="nl-step-desc">
                Substack, Morning Brew, Lenny&apos;s, anything. Enter this as your email
                instead of your personal address when you sign up.
              </p>
            </div>
          </li>
          <li className="nl-step">
            <span className="nl-step-num">3</span>
            <div className="nl-step-body">
              <p className="nl-step-title">Already subscribed elsewhere? Forward it</p>
              <p className="nl-step-desc">
                In Gmail, create a filter to auto-forward newsletters to this address.
              </p>
              <a
                href="https://mail.google.com/mail/u/0/#settings/filters"
                target="_blank"
                rel="noopener noreferrer"
                className="nl-link"
              >
                Open Gmail filter settings →
              </a>
            </div>
          </li>
        </ol>

        {emailSources.length > 0 && (
          <div className="nl-active">
            <p className="nl-active-label">Already feeding your briefing</p>
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
                <span className="source-type-icon">
                  <SourceIcon
                    type={source.source_type}
                    name={source.name ?? undefined}
                    url={source.identifier?.startsWith("http") ? source.identifier : undefined}
                    size={20}
                  />
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

      {/* Never-show filter — moved here from onboarding */}
      <div className="dash-card">
        <p className="dash-card-label">Filters</p>
        <h2 className="dash-card-title">Topics to skip</h2>
        <p className="dash-card-desc">These are hard-filtered from every briefing, no matter the source.</p>
        <NeverShowEditor tags={neverShow} onSave={onNeverShowChange} />
      </div>
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
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        border: "1px solid",
        borderColor: active ? activeColor : "var(--border)",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 12,
        color: active ? activeColor : "var(--text-muted)",
        transition: "color 0.15s, border-color 0.15s, background 0.15s",
        padding: "4px 10px",
        lineHeight: 1,
        background: active ? `${activeColor}12` : "transparent",
      }}
    >
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span>{label}</span>
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <FeedbackButton icon="👍" label="More like this" active={liked} activeColor="var(--accent)" onClick={handleLike} />
          <FeedbackButton icon="👎" label="Less like this" active={disliked} activeColor="#c47070" onClick={handleDislike} />
        </div>
      </div>
    </article>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

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
  sources,
  sourcesCount,
  generating,
  generatingPhase = 0,
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
            {GENERATING_PHASES[generatingPhase] ?? GENERATING_PHASES[0]}
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
                  <SourceIcon type={tab.type} name={tab.label} size={14} />
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
            <SourceIcon type={activeTabMeta.type} name={activeTabMeta.label} size={16} />
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
