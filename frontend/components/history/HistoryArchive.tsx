"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Digest, type DigestItem, type DigestSummary } from "@/lib/api";
import { useMediaQuery } from "@/lib/useMediaQuery";

function parseDigestDate(iso: string) {
  return new Date(iso + "T12:00:00");
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function relativeDayLabel(iso: string) {
  const date = parseDigestDate(iso);
  const today = new Date();
  if (isSameDay(date, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, yesterday)) return "Yesterday";
  return null;
}

function formatWeekday(iso: string) {
  return parseDigestDate(iso).toLocaleDateString("en-US", { weekday: "long" });
}

function formatMonthDay(iso: string) {
  return parseDigestDate(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function formatYear(iso: string) {
  return parseDigestDate(iso).getFullYear();
}

function formatShortDate(iso: string) {
  return parseDigestDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function dayNumber(iso: string) {
  return parseDigestDate(iso).getDate();
}

function StatusPill({ status }: { status: string }) {
  const label = status === "sent" ? "Sent" : status === "ready" ? "Ready" : status;
  return <span className="history-status-pill">{label}</span>;
}

function HistoryItemCard({ item, index, compact }: { item: DigestItem; index: number; compact?: boolean }) {
  if (compact) {
    return (
      <article className="history-preview-item">
        <span className="history-preview-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="history-preview-body">
          {item.section && <p className="history-preview-section">{item.section}</p>}
          <h3 className="history-preview-headline">{item.headline}</h3>
          <p className="history-preview-meta">{item.source_name}</p>
        </div>
      </article>
    );
  }

  return (
    <article className="briefing-item history-briefing-item">
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

function DigestReader({
  digestId,
  compact,
  onBack,
  showBack,
}: {
  digestId: string;
  compact?: boolean;
  onBack?: () => void;
  showBack?: boolean;
}) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    setDigest(null);
    api
      .getDigest(digestId)
      .then((d) => {
        setDigest(d);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [digestId]);

  if (loading) {
    return (
      <div className="history-reader-state">
        <span className="btn-spinner" />
        <p>Loading briefing…</p>
      </div>
    );
  }

  if (error || !digest) {
    return (
      <div className="history-reader-state">
        <p>Couldn&apos;t load this briefing. Try selecting another day.</p>
        {showBack && onBack && (
          <button type="button" className="history-mobile-back" onClick={onBack}>
            ← All briefings
          </button>
        )}
      </div>
    );
  }

  const relative = relativeDayLabel(digest.digest_date);
  const previewItems = compact ? digest.items.slice(0, 6) : digest.items;
  const remaining = digest.items.length - previewItems.length;

  return (
    <div className="history-reader">
      {showBack && onBack && (
        <button type="button" className="history-mobile-back" onClick={onBack}>
          ← All briefings
        </button>
      )}

      <header className="history-reader-header">
        <div className="history-reader-date-block">
          {relative && <span className="history-reader-relative">{relative}</span>}
          <h2 className="history-reader-title">{formatWeekday(digest.digest_date)}</h2>
          <p className="history-reader-subtitle">
            {formatMonthDay(digest.digest_date)}, {formatYear(digest.digest_date)}
          </p>
        </div>
        <div className="history-reader-meta">
          <span className="history-reader-count">{digest.total_items_shown} items</span>
          <StatusPill status={digest.status} />
        </div>
      </header>

      {digest.preview_text && (
        <p className="history-reader-lede">{digest.preview_text}</p>
      )}

      <div className="history-reader-items" role="list">
        {previewItems.map((item, i) => (
          <HistoryItemCard key={item.id} item={item} index={i} compact={compact} />
        ))}
      </div>

      {compact && remaining > 0 && (
        <p className="history-preview-more">+{remaining} more in reading mode</p>
      )}

      <div className="history-reader-footer">
        <Link href={`/dashboard/read/${digest.id}`} className="dash-btn dash-btn-primary">
          Open in reading mode
        </Link>
      </div>
    </div>
  );
}

type HistoryArchiveProps = {
  digests: DigestSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function HistoryArchive({ digests, selectedId, onSelect }: HistoryArchiveProps) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [mobileDetail, setMobileDetail] = useState(false);

  const selected = digests.find((d) => d.id === selectedId) ?? digests[0] ?? null;

  useEffect(() => {
    if (!isMobile) setMobileDetail(false);
  }, [isMobile]);

  function handleSelect(id: string) {
    onSelect(id);
    if (isMobile) setMobileDetail(true);
  }

  function handleBack() {
    setMobileDetail(false);
  }

  const shellMode = isMobile && mobileDetail ? "history-shell--detail" : "";

  return (
    <div className={`history-shell${shellMode ? ` ${shellMode}` : ""}`}>
      <aside className="history-rail" aria-label="Past briefings">
        <div className="history-rail-head">
          <p className="history-rail-label">Timeline</p>
          <p className="history-rail-hint">
            {isMobile ? "Tap a day to open" : "Select a day to read"}
          </p>
        </div>

        <ol className="history-timeline">
          {digests.map((digest, index) => {
            const active = digest.id === (selectedId ?? digests[0]?.id);
            const relative = relativeDayLabel(digest.digest_date);
            const preview = digest.preview_text || digest.subject_line || "Morning briefing";

            return (
              <li key={digest.id} className="history-timeline-entry">
                <button
                  type="button"
                  className={`history-day-card${active ? " active" : ""}`}
                  onClick={() => handleSelect(digest.id)}
                  aria-current={active && !isMobile ? "true" : undefined}
                >
                  <div className="history-day-card-top">
                    <div className="history-day-card-date">
                      <span className="history-day-num">{dayNumber(digest.digest_date)}</span>
                      <div>
                        {relative ? (
                          <span className="history-day-relative">{relative}</span>
                        ) : (
                          <span className="history-day-weekday">{formatShortDate(digest.digest_date)}</span>
                        )}
                        <span className="history-day-month">
                          {parseDigestDate(digest.digest_date).toLocaleDateString("en-US", {
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                    <span className="history-day-count">{digest.total_items_shown}</span>
                  </div>
                  <p className="history-day-preview">{preview}</p>
                  <div className="history-day-card-foot">
                    <StatusPill status={digest.status} />
                  </div>
                </button>
                {index < digests.length - 1 && !isMobile && (
                  <span className="history-timeline-line" aria-hidden />
                )}
              </li>
            );
          })}
        </ol>
      </aside>

      <section className="history-reader-panel" aria-label="Briefing content">
        {selected ? (
          <DigestReader
            key={selected.id}
            digestId={selected.id}
            compact={isMobile}
            onBack={handleBack}
            showBack={isMobile && mobileDetail}
          />
        ) : (
          <div className="history-reader-state">
            <p>Select a briefing from the timeline.</p>
          </div>
        )}
      </section>
    </div>
  );
}
