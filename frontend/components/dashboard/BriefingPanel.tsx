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
import { IngestionPanel } from "./IngestionPanel";
import { sourceDisplayName } from "./sourceLabels";
import { SourceIcon } from "@/components/SourceIcon";
import { OutcomeBriefHeader, SafeToIgnorePanel } from "./OutcomeBriefHeader";
import { getDigestOutcome, splitTopPriorityItems } from "@/lib/digestOutcome";

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
  onClose?: () => void;
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
  onClose,
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
      {/* ── Source list — primary focus ── */}
      <div className="dash-card dash-card-primary">
        <div className="dash-card-head">
          <div>
            <h2 className="dash-card-title">Briefly&apos;s sources</h2>
            {sources.length > 0 && (
              <p className="dash-card-desc dash-card-desc-tight">
                {sources.length} connected · star any to prioritise it
              </p>
            )}
          </div>
          <div className="dash-card-head-actions">
            {onClose && (
              <button type="button" className="outcome-sources-close" onClick={onClose} aria-label="Close sources">
                ×
              </button>
            )}
          </div>
        </div>

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
            <div className="source-add-divider" />
          </>
        )}

        {/* Add source form — below the list, not above it */}
        <AddSourceForm onAdded={onSourceAdded} />

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

      {/* ── Inline source recommendations — 3 max, reason visible, no collapse ── */}
      <InlineSourceRecommendations
        existingSources={sources}
        autoSuggestions={autoSuggestions}
        onAdded={onSourceAdded}
      />

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

// ── Inline recommendations — shown expanded, 3 max, reason visible ────────────

function InlineSourceRecommendations({
  existingSources,
  autoSuggestions,
  onAdded,
}: {
  existingSources: Source[];
  autoSuggestions: AutoSuggestion[];
  onAdded: (s: Source) => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const existingUrls = new Set(existingSources.map((s) => s.identifier.toLowerCase()));

  const visible = autoSuggestions
    .filter((s) => !existingUrls.has(s.url.toLowerCase()) && !dismissed.has(s.url))
    .slice(0, 3);

  if (visible.length === 0) return null;

  async function handleAdd(s: AutoSuggestion) {
    setAdding(s.url);
    try {
      const src = await api.addSource({ identifier: s.url, name: s.name });
      onAdded(src);
      setDismissed((prev) => new Set(Array.from(prev).concat(s.url)));
    } catch {
      // show nothing on error — user can try again
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="dash-card inline-rec-card">
      <p className="dash-card-label">Recommended</p>
      <h2 className="dash-card-title" style={{ marginBottom: 12 }}>You might also follow</h2>
      <ul className="inline-rec-list">
        {visible.map((s) => (
          <li key={s.url} className="inline-rec-item">
            <div className="inline-rec-body">
              <p className="inline-rec-name">{s.name}</p>
              <p className="inline-rec-reason">
                {s.reason || s.description || s.topic}
              </p>
            </div>
            <div className="inline-rec-actions">
              <button
                type="button"
                className="briefing-refresh inline-rec-add"
                onClick={() => void handleAdd(s)}
                disabled={adding === s.url}
              >
                {adding === s.url ? "…" : "+ Add"}
              </button>
              <button
                type="button"
                className="suggestion-dismiss-btn"
                onClick={() => setDismissed((prev) => new Set(Array.from(prev).concat(s.url)))}
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
  // Truncate why_it_matters to a single compact line
  const why = item.why_it_matters
    ? item.why_it_matters.length > 100
      ? item.why_it_matters.slice(0, 97).trimEnd() + "…"
      : item.why_it_matters
    : null;

  const hasMemory = Boolean(item.memory_reference || item.memory_connections?.length);

  const content = (
    <>
      <span className="briefing-preview-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="briefing-preview-body">
        <div className="briefing-preview-meta-row">
          <p className="briefing-preview-meta">{item.source_name}</p>
          {hasMemory && (
            <span className="briefing-preview-memory-dot" title="Briefly remembers this story" aria-label="You've been following this story" />
          )}
        </div>
        <h3 className="briefing-preview-headline">{item.headline}</h3>
        {why && <p className="briefing-preview-why">{why}</p>}
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
  if (section === SECTION_WHATS_NEW) return "Latest from your sources";
  if (section === SECTION_HIGHLY_RELEVANT) return "Picked for your interests";
  return "";
}

function sectionBadgeLabel(section: string): string {
  if (section === SECTION_WHATS_NEW) return "From your sources";
  if (section === SECTION_HIGHLY_RELEVANT) return "Picked for you";
  return section;
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
  "Reading your sources…",
  "Scoring items for relevance…",
  "Finding what&apos;s new for you…",
  "Writing your briefing…",
];

type BriefingPanelProps = {
  digest: Digest | null;
  sources: Source[];
  sourcesCount: number;
  generating: boolean;
  generatingLabel?: string;
  generatingElapsedSec?: number;
  generateError: string;
  generateWarnings?: string[];
  onRegenerate?: () => void;
};

function fmtElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  // Cap display at 10 minutes — anything beyond that is a stale/stuck timer
  if (m >= 10) return "taking longer than usual…";
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

// Map backend label text to a step index (0-3) so we don't do fragile string matching everywhere
function labelToStepIndex(lbl: string): number {
  const l = lbl.toLowerCase();
  if (l.includes("collect") || l.includes("source") || l.includes("fetch") ||
      l.includes("ingest") || l.includes("clean") || l.includes("normaliz")) return 0;
  if (l.includes("relev") || l.includes("scor") || l.includes("novel") ||
      l.includes("dedup") || l.includes("duplic")) return 1;
  if (l.includes("memory") || l.includes("plann") || l.includes("history") ||
      l.includes("thread") || l.includes("verif")) return 2;
  if (l.includes("writ") || l.includes("dump") || l.includes("deliver") ||
      l.includes("ready") || l.includes("done")) return 3;
  return 0; // default to first step
}

const PIPELINE_STEPS = [
  { label: "Reading your sources",      hint: "Fetching & cleaning content" },
  { label: "Scoring relevance",         hint: "Matching to your interests" },
  { label: "Connecting to your history",hint: "Memory, threads, dedup" },
  { label: "Writing your briefing",     hint: "Personalised with Haiku" },
];

function GeneratingPanel({
  statusLabel,
  elapsedSec,
  isUpdate,
}: {
  statusLabel: string;
  elapsedSec: number;
  isUpdate: boolean; // true = updating existing digest, false = first time
}) {
  const activeStep = labelToStepIndex(statusLabel);

  return (
    <div className="bgl-panel">
      {/* ── Header ── */}
      <div className="bgl-panel-header">
        <span className="bgl-pulse-ring" aria-hidden />
        <div className="bgl-panel-header-text">
          <h2 className="bgl-panel-title">
            {isUpdate ? "Generating today's brief" : "Building your first briefing"}
          </h2>
          <p className="bgl-panel-subtitle">
            {elapsedSec > 0
              ? fmtElapsed(elapsedSec)
              : "Starting up…"}
          </p>
        </div>
      </div>

      {/* ── Current label from backend ── */}
      <p className="bgl-panel-live-label">
        <span className="bgl-panel-live-dot" aria-hidden />
        {statusLabel}
      </p>

      {/* ── Pipeline steps ── */}
      <div className="bgl-panel-steps">
        {PIPELINE_STEPS.map((step, i) => {
          const state =
            i < activeStep ? "done" :
            i === activeStep ? "active" :
            "pending";
          return (
            <div key={step.label} className={`bgl-panel-step bgl-panel-step--${state}`}>
              <div className="bgl-panel-step-indicator">
                {state === "done" ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : state === "active" ? (
                  <span className="bgl-panel-step-pulse" aria-hidden />
                ) : (
                  <span className="bgl-panel-step-empty" aria-hidden />
                )}
              </div>
              <div className="bgl-panel-step-body">
                <span className="bgl-panel-step-label">{step.label}</span>
                {state === "active" && (
                  <span className="bgl-panel-step-hint">{step.hint}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Ghost skeleton items ── */}
      <div className="bgl-panel-ghost">
        {Array.from({ length: 4 }).map((_, i) => (
          <BriefingItemSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function BriefingPanel({
  digest,
  sourcesCount,
  generating,
  generatingLabel,
  generatingElapsedSec = 0,
  generateError,
  generateWarnings = [],
  onRegenerate,
}: BriefingPanelProps) {
  const statusLabel = generatingLabel || GENERATING_PHASES[0];

  // ── Generating state — shown ALWAYS when generating, regardless of prior digest ──
  if (generating) {
    return (
      <div className="briefing-panel">
        <GeneratingPanel
          statusLabel={statusLabel}
          elapsedSec={generatingElapsedSec}
          isUpdate={!!digest}
        />
      </div>
    );
  }

  // ── Error state — no digest and generation failed ──
  if (!digest) {
    return (
      <div className="briefing-empty">
        <div className="briefing-empty-icon">
          <span className="briefing-empty-ring" />
        </div>
        <h2 className="briefing-empty-title">Briefly is preparing your outcome</h2>
        <p className="briefing-empty-desc">
          {sourcesCount > 0
            ? "We read your sources overnight — your personalized brief will arrive shortly."
            : "Connect Gmail and Briefly will deliver your first brief — no source management needed."}
        </p>
        {sourcesCount > 0 && onRegenerate && (
          <button
            type="button"
            className="briefing-refresh briefing-empty-regenerate"
            onClick={onRegenerate}
          >
            Refresh today&apos;s brief
          </button>
        )}
        {generateError && <p className="form-error" style={{ marginTop: 16 }}>{generateError}</p>}
      </div>
    );
  }

  const outcome = getDigestOutcome(digest);
  const { topItems, restItems } = splitTopPriorityItems(digest, outcome);
  const restPreview = buildGroupedPreview(restItems, PREVIEW_LIMIT);
  const remaining = restItems.length - restPreview.shown;
  let previewIndex = 0;
  const skipped = digest.meta?.skipped ?? [];
  const blocked = digest.meta?.blocked;
  const moreToday = digest.meta?.more_today;

  return (
    <div className="briefing-panel briefing-panel-outcome">
      <OutcomeBriefHeader
        outcome={outcome}
        generating={false}
        itemCount={digest.total_items_shown}
        digestDate={digest.digest_date}
      />

      {generateWarnings.length > 0 && (
        <ul className="briefing-warnings briefing-warnings-panel">
          {generateWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="briefing-preview-list">
        <div>
          {topItems.length > 0 && (
            <section className="briefing-section-group briefing-section-top3">
              <header className="briefing-section-head">
                <span className="briefing-section-badge briefing-section-badge-top">Top 3 for today</span>
                <p className="briefing-section-sub">What deserves your attention first</p>
              </header>
              <div className="briefing-section-items">
                {topItems.map((item, index) => (
                  <BriefingPreviewItem
                    key={item.id}
                    item={item}
                    index={index}
                    digestId={digest.id}
                  />
                ))}
              </div>
            </section>
          )}

          {restPreview.shown > 0 ? (
            restPreview.groups.map((group) => (
              <section key={group.section} className="briefing-section-group">
                <header className="briefing-section-head">
                  <span className={sectionBadgeClass(group.section)}>{sectionBadgeLabel(group.section)}</span>
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
                        index={topItems.length + previewIndex - 1}
                        digestId={digest.id}
                      />
                    );
                  })}
                </div>
              </section>
            ))
          ) : topItems.length === 0 ? (
            <div className="briefing-tab-empty">
              <p>No items in today&apos;s brief yet.</p>
              {sourcesCount > 0 && onRegenerate && (
                <button
                  type="button"
                  className="briefing-tab-empty-btn btn-primary"
                  onClick={onRegenerate}
                >
                  Refresh today&apos;s brief
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <SafeToIgnorePanel
        skippedNote={outcome?.skipped_note}
        skippedItems={skipped}
        blockedItems={blocked}
        moreToday={moreToday}
        filteredCount={outcome?.filtered_count ?? 0}
      />

      {digest.items.length > 0 && (
        <div className={`briefing-preview-footer${generating ? " briefing-preview-footer-dimmed" : ""}`}>
          {remaining > 0 && (
            <p className="briefing-preview-more">
              +{remaining} more {remaining === 1 ? "item" : "items"} below
            </p>
          )}
          <Link href={`/dashboard/read/${digest.id}`} className="briefing-preview-cta">
            Open briefing
            <span className="briefing-preview-cta-count">{digest.items.length} items →</span>
          </Link>
        </div>
      )}

      {/* Server errors during background polling are suppressed when the digest
          is already visible — the user has everything they need. */}
    </div>
  );
}
