"use client";

import type { Digest, Source } from "@/lib/api";
import { AddSourceForm, CopyEmailButton } from "./AddSourceForm";

type SourcesSidebarProps = {
  ingestionEmail: string;
  sources: Source[];
  onSourceAdded: (source: Source) => void;
};

export function SourcesSidebar({
  ingestionEmail,
  sources,
  onSourceAdded,
}: SourcesSidebarProps) {
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
                <span className="source-type">{source.source_type}</span>
                <div className="source-info">
                  <span className="source-name">{source.name ?? source.identifier}</span>
                  {source.name && (
                    <span className="source-id">{source.identifier}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="source-add-hint">
          {sources.length === 0
            ? "Add your first source below."
            : "Add another source — each URL or channel counts separately."}
        </p>
        <AddSourceForm onAdded={onSourceAdded} />
      </div>
    </aside>
  );
}

type BriefingPanelProps = {
  digest: Digest | null;
  sourcesCount: number;
  generating: boolean;
  generateError: string;
  onGenerate: () => void;
};

export function BriefingPanel({
  digest,
  sourcesCount,
  generating,
  generateError,
  onGenerate,
}: BriefingPanelProps) {
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
            <span>Add an RSS feed in the panel →</span>
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
          <p className="briefing-empty-hint">Add at least one RSS source to continue.</p>
        )}
        {generateError && <p className="form-error">{generateError}</p>}
      </div>
    );
  }

  return (
    <div className="briefing-panel">
      <div className="briefing-toolbar">
        <div className="briefing-stats">
          <span>{digest.total_items_shown} items</span>
          <span className="briefing-stat-dot" />
          <span>{digest.digest_date}</span>
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

      <div className="briefing-items">
        {digest.items.map((item, index) => (
          <article key={item.id} className="briefing-item">
            <span className="briefing-item-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="briefing-item-body">
              {item.section && (
                <p className="briefing-item-section">{item.section}</p>
              )}
              <div className="briefing-item-meta">
                <span>{item.source_name}</span>
                {item.source_url && (
                  <a href={item.source_url} target="_blank" rel="noopener noreferrer">
                    Read source
                  </a>
                )}
              </div>
              <h3 className="briefing-item-headline">{item.headline}</h3>
              {item.summary && (
                <p className="briefing-item-summary">{item.summary}</p>
              )}
              <blockquote className="briefing-item-why">
                {item.why_it_matters}
              </blockquote>
            </div>
          </article>
        ))}
      </div>

      {generateError && <p className="form-error briefing-error">{generateError}</p>}
    </div>
  );
}
