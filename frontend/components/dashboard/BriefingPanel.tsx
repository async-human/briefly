"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type AutoSuggestion, type Digest, type DigestItem, type Source } from "@/lib/api";
import {
  groupDigestItemsBySection,
  SECTION_HIGHLY_RELEVANT,
  SECTION_WHATS_NEW,
  SECTION_WORTH_DISCOVERING,
  sectionBadgeClass,
} from "@/lib/digestSections";
import { AddSourceForm, CopyEmailButton } from "./AddSourceForm";
import { SourceSlotMeter } from "./SourceSlotMeter";
import { useUpgradeOptional } from "@/components/billing/UpgradeProvider";
import {
  filterBillableSources,
  isPlanLimitError,
  sourceSlotUsage,
  upgradeReasonFromError,
} from "@/lib/plans";
import { CollapsibleCard } from "./CollapsibleCard";
import { GmailDiscovery } from "./GmailDiscovery";
import { IngestionPanel } from "./IngestionPanel";
import { sourceDisplayName, sourceTypeLabel } from "./sourceLabels";
import { SourceIcon } from "@/components/SourceIcon";
import { OutcomeBriefHeader, SafeToIgnorePanel } from "./OutcomeBriefHeader";
import { getDigestOutcome, splitTopPriorityItems } from "@/lib/digestOutcome";
import { formatHeroHeadline, formatHeroWhy, formatPreviewHeadline } from "@/lib/formatHeadline";
import { graphItemUrl } from "@/lib/graphLinks";
import { BrieflyLogo } from "@/components/BrieflyLogo";
import { askAboutContent } from "@/lib/askLinks";
import { BriefLoaderArt } from "@/components/loading/BriefLoaderArt";
import { GeneratingProgressRing } from "@/components/loading/GeneratingProgressRing";
import { YouTubeItemBadge } from "@/components/dashboard/YouTubeItemBadge";
import { getYouTubeBadge } from "@/lib/youtubeBadge";

const PREVIEW_LIMIT = 5;

type SourcesSidebarProps = {
  ingestionEmail: string;
  /** All source rows from the API — internal types are filtered for display. */
  sources: Source[];
  gmailConnected: boolean;
  autoSuggestions?: AutoSuggestion[];
  onSourceAdded: (source: Source) => void;
  onSourcesRemoved: (sourceIds: string[]) => void;
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
  onSourcesRemoved,
  onSourceUpdated,
  onRediscover,
}: SourcesSidebarProps) {
  const upgrade = useUpgradeOptional();
  const [pendingRemoval, setPendingRemoval] = useState<Set<string>>(() => new Set());
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [showAllSources, setShowAllSources] = useState(false);

  function togglePendingRemoval(sourceId: string) {
    setPendingRemoval((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  async function confirmRemovals() {
    const ids = Array.from(pendingRemoval);
    if (!ids.length) return;
    setConfirmingRemoval(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.deleteSource(id)));
      const succeeded = ids.filter((_, index) => results[index].status === "fulfilled");
      setPendingRemoval((prev) => {
        const next = new Set(prev);
        succeeded.forEach((id) => next.delete(id));
        return next;
      });
      if (succeeded.length) {
        onSourcesRemoved(succeeded);
        void upgrade?.refreshBilling();
      }
    } finally {
      setConfirmingRemoval(false);
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

  const billableSources = filterBillableSources(sources);
  const emailSources = billableSources.filter((s) => s.source_type === "email");
  const SOURCE_PREVIEW = 8;
  const visibleSources = showAllSources ? billableSources : billableSources.slice(0, SOURCE_PREVIEW);
  const hiddenCount = billableSources.length - SOURCE_PREVIEW;
  const slots = sourceSlotUsage(upgrade?.billing, billableSources.length);

  return (
    <aside className="dash-sidebar dash-sidebar-embedded">
      <div className="dash-card dash-card-embedded">
        <SourceSlotMeter
          used={billableSources.length}
          limit={slots.limit}
          isPro={slots.isPro}
          onUpgrade={() => upgrade?.openUpgrade({ reason: "sources_limit" })}
        />

        {billableSources.length > 0 && (
          <p className="dash-sidebar-hint">
            Star a connection to prioritise it in your briefings. Remove any connection to free a
            slot.
          </p>
        )}

        {billableSources.length === 0 ? (
          <div className="source-connections-empty">
            <p className="source-connections-empty-title">No connections yet</p>
            <p className="source-connections-empty-hint">
              Add an RSS feed, YouTube channel, newsletter, or subreddit below. Each one counts
              toward your plan limit.
            </p>
          </div>
        ) : (
          <>
            <ul className="source-list source-list-connected source-list-compact">
              {visibleSources.map((source) => {
                const marked = pendingRemoval.has(source.id);
                return (
                <li
                  key={source.id}
                  className={`source-list-item${marked ? " is-pending-removal" : ""}`}
                >
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
                    <span className="source-type-badge">{sourceTypeLabel(source.source_type)}</span>
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
                    className={`source-delete-btn${marked ? " is-marked" : ""}`}
                    onClick={() => togglePendingRemoval(source.id)}
                    disabled={confirmingRemoval}
                    aria-label={
                      marked
                        ? `Undo remove ${sourceDisplayName(source)}`
                        : `Mark ${sourceDisplayName(source)} for removal`
                    }
                    title={marked ? "Undo" : "Remove"}
                  >
                    {marked ? "↩" : "×"}
                  </button>
                </li>
              );
              })}
            </ul>
            {pendingRemoval.size > 0 && (
              <div className="source-removal-bar" role="status">
                <p className="source-removal-bar-text">
                  {pendingRemoval.size} source{pendingRemoval.size === 1 ? "" : "s"} will be removed
                </p>
                <div className="source-removal-bar-actions">
                  <button
                    type="button"
                    className="source-removal-cancel"
                    onClick={() => setPendingRemoval(new Set())}
                    disabled={confirmingRemoval}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="source-removal-confirm"
                    onClick={() => void confirmRemovals()}
                    disabled={confirmingRemoval}
                  >
                    {confirmingRemoval ? "Removing…" : "Confirm & refresh brief"}
                  </button>
                </div>
              </div>
            )}
            {hiddenCount > 0 && !showAllSources && (
              <button
                type="button"
                className="source-list-expand"
                onClick={() => setShowAllSources(true)}
              >
                Show all {billableSources.length} connections
              </button>
            )}
            <div className="source-add-divider" />
          </>
        )}

        <AddSourceForm sourceCount={billableSources.length} onAdded={onSourceAdded} />

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
        existingSources={billableSources}
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

      {(gmailConnected || !billableSources.some((s) => s.source_type === "readwise")) && (
        <CollapsibleCard label="Optional" title="More integrations">
          {gmailConnected && <GmailDiscovery onAdded={onSourceAdded} compact />}
          <ReadwiseCard
            sources={billableSources}
            onAdded={onSourceAdded}
            onRemoved={(id) => onSourcesRemoved([id])}
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
  const upgrade = useUpgradeOptional();
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
      void upgrade?.refreshBilling();
    } catch (err) {
      if (isPlanLimitError(err)) {
        upgrade?.openUpgrade({ reason: upgradeReasonFromError(err) });
      }
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

// ── Hero item — full personalization surfaced on dashboard ───────────────────

function BriefingHeroItem({
  item,
  digestId,
}: {
  item: DigestItem;
  digestId: string;
}) {
  const router = useRouter();
  const youtubeBadge = getYouTubeBadge(item);
  const headline = formatHeroHeadline(item.headline);
  const why = item.why_it_matters ? formatHeroWhy(item.why_it_matters) : null;

  return (
    <article className="briefing-hero-item">
      <div className="briefing-hero-meta">
        <span className="briefing-hero-badge">Top story</span>
        <YouTubeItemBadge item={item} variant="compact" />
        {item.source_name && !youtubeBadge && (
          <span className="briefing-hero-source">{item.source_name}</span>
        )}
      </div>
      <h3
        className="briefing-hero-headline"
        title={headline.truncated ? headline.full : undefined}
      >
        {headline.display}
      </h3>
      {why && (
        <p className="briefing-hero-why">{why}</p>
      )}
      {item.confidence_signal && (
        <p className="briefing-hero-confidence">◈ {item.confidence_signal}</p>
      )}
      {item.contradiction_flag && item.contradiction_explanation && (
        <p className="briefing-hero-contradiction">
          <span aria-hidden>⚠</span> {item.contradiction_explanation}
        </p>
      )}
      {item.memory_reference && (
        <p className="briefing-hero-memory">⟳ {item.memory_reference}</p>
      )}
      <div className="briefing-hero-actions">
        {item.content_id && (
          <Link
            href={askAboutContent(item.content_id, item.id, item.headline)}
            className="briefing-hero-ask btn-primary"
          >
            Ask about this
          </Link>
        )}
        <Link href={`/dashboard/read/${digestId}`} className="briefing-hero-read">
          Read full brief →
        </Link>
        {item.content_id && (
          <button
            type="button"
            className="briefing-graph-link"
            onClick={() => router.push(graphItemUrl(item.content_id!))}
          >
            Graph
          </button>
        )}
      </div>
    </article>
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
  const router = useRouter();
  const why = item.why_it_matters
    ? item.why_it_matters.length > 100
      ? item.why_it_matters.slice(0, 97).trimEnd() + "…"
      : item.why_it_matters
    : null;
  const previewHeadline = formatPreviewHeadline(item.headline);

  const hasMemory = Boolean(item.memory_reference || item.memory_connections?.length);
  const youtubeBadge = getYouTubeBadge(item);

  const content = (
    <>
      <span className="briefing-preview-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="briefing-preview-body">
        <div className="briefing-preview-meta-row">
          <YouTubeItemBadge item={item} variant="compact" />
          {!youtubeBadge && item.source_name ? (
            <p className="briefing-preview-meta">{item.source_name}</p>
          ) : null}
          {hasMemory && (
            <span className="briefing-preview-memory-dot" title="Briefly remembers this story" aria-label="You've been following this story" />
          )}
          {item.content_id ? (
            <button
              type="button"
              className="briefing-graph-link"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(graphItemUrl(item.content_id!));
              }}
            >
              Graph
            </button>
          ) : null}
        </div>
        <h3
          className="briefing-preview-headline"
          title={previewHeadline !== item.headline ? item.headline : undefined}
        >
          {previewHeadline}
        </h3>
        {why && <p className="briefing-preview-why">{why}</p>}
        {item.contradiction_flag && item.contradiction_explanation && (
          <p className="briefing-preview-contradiction">⚠ {item.contradiction_explanation}</p>
        )}
        {item.confidence_signal && (
          <p className="briefing-preview-confidence">◈ {item.confidence_signal}</p>
        )}
      </div>
      {digestId ? <span className="briefing-preview-chevron" aria-hidden>→</span> : null}
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
  if (section === SECTION_WORTH_DISCOVERING) return "Relevant content from outside your subscriptions";
  return "";
}

function sectionBadgeLabel(section: string): string {
  if (section === SECTION_WHATS_NEW) return "From your sources";
  if (section === SECTION_HIGHLY_RELEVANT) return "Picked for you";
  if (section === SECTION_WORTH_DISCOVERING) return "Worth discovering";
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

const GENERATING_PHASES = [
  "Fetching from your sources…",
  "Reading your sources…",
  "Scoring items for relevance…",
  "Writing your briefing…",
];

function phaseIndexFromLabel(label: string): number {
  const lower = label.toLowerCase();
  if (lower.includes("writing") || lower.includes("ready")) return 3;
  if (lower.includes("scoring") || lower.includes("relevance") || lower.includes("planning")) return 2;
  if (lower.includes("reading") || lower.includes("clean") || lower.includes("dedup")) return 1;
  return 0;
}

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

function GeneratingPanel({
  statusLabel,
  elapsedSec,
  isUpdate,
}: {
  statusLabel: string;
  elapsedSec: number;
  isUpdate: boolean;
}) {
  const activePhase = phaseIndexFromLabel(statusLabel);
  const progress = Math.min(0.92, (activePhase + 0.35) / GENERATING_PHASES.length);

  return (
    <div className="hm-generating-panel" aria-busy="true" aria-live="polite">
      <div className="hm-generating-panel-visual">
        <GeneratingProgressRing progress={progress} />
        <BriefLoaderArt size="md" />
      </div>

      <h3 className="hm-generating-panel-title">
        {isUpdate ? "Preparing your briefing" : "Building your first briefing"}
      </h3>

      <p className="hm-generating-panel-status">
        <span className="dash-page-status-dot" aria-hidden />
        {statusLabel}
      </p>

      <ol className="hm-generating-steps">
        {GENERATING_PHASES.map((phase, i) => {
          const state =
            i < activePhase ? "done" : i === activePhase ? "active" : "pending";
          return (
            <li key={phase} className={`hm-generating-step hm-generating-step--${state}`}>
              <span className="hm-generating-step-marker" aria-hidden>
                {state === "done" ? (
                  <svg viewBox="0 0 12 12" width="10" height="10">
                    <path
                      d="M2.5 6.2 4.8 8.5 9.5 3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : state === "active" ? (
                  <span className="hm-generating-step-pulse" />
                ) : null}
              </span>
              <span className="hm-generating-step-label">{phase}</span>
            </li>
          );
        })}
      </ol>

      {elapsedSec > 0 && (
        <p className="hm-generating-panel-elapsed">{fmtElapsed(elapsedSec)}</p>
      )}
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
          <BrieflyLogo variant="mark" size="lg" />
          <span className="briefing-empty-ring" aria-hidden />
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
    <div className="briefing-panel briefing-panel-outcome briefing-panel-embedded">
      <OutcomeBriefHeader
        outcome={outcome}
        generating={false}
        itemCount={digest.total_items_shown}
        digestDate={digest.digest_date}
        subjectLine={digest.subject_line}
        previewText={digest.preview_text}
      />

      {topItems[0] && (
        <BriefingHeroItem item={topItems[0]} digestId={digest.id} />
      )}

      {generateWarnings.length > 0 && (
        <ul className="briefing-warnings briefing-warnings-panel">
          {generateWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="briefing-preview-list">
        <div>
          {topItems.length > 1 && (
            <section className="briefing-section-group briefing-section-top3">
              <header className="briefing-section-head">
                <span className="briefing-section-badge briefing-section-badge-top">Also priority today</span>
              </header>
              <div className="briefing-section-items">
                {topItems.slice(1).map((item, index) => (
                  <BriefingPreviewItem
                    key={item.id}
                    item={item}
                    index={index + 1}
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
