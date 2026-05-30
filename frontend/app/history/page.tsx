"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Digest, type DigestItem, type DigestSummary } from "@/lib/api";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { getToken } from "@/lib/auth";

function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function StatusBadge({ status }: { status: string }) {
  const label = status === "sent" ? "Sent" : status === "ready" ? "Ready" : status;
  const color = status === "sent" ? "var(--accent)" : "var(--text-muted)";
  return (
    <span style={{ fontFamily: "var(--mono)", fontSize: 9, color, letterSpacing: "0.1em", textTransform: "uppercase" }}>
      {label}
    </span>
  );
}

function HistoryItemCard({ item, index }: { item: DigestItem; index: number }) {
  return (
    <article className="briefing-item">
      <span className="briefing-item-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="briefing-item-body">
        {item.section && <p className="briefing-item-section">{item.section}</p>}
        <div className="briefing-item-meta">
          <span>{item.source_name}</span>
          {item.source_url && (
            <a href={item.source_url} target="_blank" rel="noopener noreferrer">Read source</a>
          )}
        </div>
        <h3 className="briefing-item-headline">{item.headline}</h3>
        {item.summary && <p className="briefing-item-summary">{item.summary}</p>}
        <blockquote className="briefing-item-why">{item.why_it_matters}</blockquote>
      </div>
    </article>
  );
}

function DigestDetail({ digestId }: { digestId: string }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setDigest(null);
    api.getDigest(digestId).then((d) => {
      setDigest(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [digestId]);

  if (loading) {
    return (
      <div className="history-detail-loading">
        <span className="btn-spinner" />
        <p>Loading briefing…</p>
      </div>
    );
  }

  if (!digest) {
    return <div className="history-detail-loading"><p style={{ color: "var(--text-muted)" }}>Failed to load.</p></div>;
  }

  return (
    <div className="briefing-panel">
      <div className="briefing-toolbar">
        <div className="briefing-stats">
          <span>{digest.total_items_shown} items</span>
          <span className="briefing-stat-dot" />
          <span>{formatDate(digest.digest_date)}</span>
          {digest.subject_line && (
            <>
              <span className="briefing-stat-dot" />
              <span style={{ fontFamily: "var(--sans)", textTransform: "none", letterSpacing: 0 }}>
                {digest.subject_line}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="briefing-items" role="list">
        {digest.items.map((item, i) => (
          <HistoryItemCard key={item.id} item={item} index={i} />
        ))}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const router = useRouter();
  const [digests, setDigests] = useState<DigestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([api.getMe(), api.getDigests()])
      .then(([meData, list]) => {
        setMe({ name: meData.user.name, avatar_url: meData.user.avatar_url });
        setDigests(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <div className="dash-shell">
      <DashboardNav userName={me?.name ?? null} avatarUrl={me?.avatar_url} />
      <main className="dash-main">
        {loading ? (
          <div className="dash-loading-state">
            <span className="btn-spinner" />
            <p>Loading history…</p>
          </div>
        ) : (
          <>
            <header className="dash-hero">
              <div>
                <p className="dash-hero-label">Archive</p>
                <h1 className="dash-hero-title">Past briefings</h1>
                <p className="dash-hero-date">{digests.length} briefing{digests.length !== 1 ? "s" : ""}</p>
              </div>
            </header>

            {digests.length === 0 ? (
              <div className="briefing-empty">
                <div className="briefing-empty-icon"><span className="briefing-empty-ring" /></div>
                <h2 className="briefing-empty-title">No past briefings</h2>
                <p className="briefing-empty-desc">
                  Generate your first briefing from the dashboard and it will appear here.
                </p>
              </div>
            ) : (
              <div className="history-grid">
                <nav className="history-list" aria-label="Past briefings">
                  {digests.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`history-list-item${selectedId === d.id ? " active" : ""}`}
                      onClick={() => setSelectedId(d.id)}
                    >
                      <div className="history-list-date">{formatDate(d.digest_date)}</div>
                      <div className="history-list-preview">
                        {d.preview_text || d.subject_line || "Briefing"}
                      </div>
                      <div className="history-list-meta">
                        <StatusBadge status={d.status} />
                        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-muted)" }}>
                          {d.total_items_shown} items
                        </span>
                      </div>
                    </button>
                  ))}
                </nav>
                <div className="history-detail">
                  {selectedId && <DigestDetail key={selectedId} digestId={selectedId} />}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
