"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type DigestSummary } from "@/lib/api";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { HistoryArchive } from "@/components/history/HistoryArchive";
import { getToken } from "@/lib/auth";

function HistorySkeleton() {
  return (
    <>
      {/* Hero */}
      <div className="dash-skeleton-hero">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="skeleton-block" style={{ width: 60, height: 10, display: "block" }} />
          <span className="skeleton-block" style={{ width: 200, height: 34, display: "block" }} />
          <span className="skeleton-block" style={{ width: 120, height: 13, display: "block" }} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {[1, 2].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              <span className="skeleton-block" style={{ width: 28, height: 28, display: "block" }} />
              <span className="skeleton-block" style={{ width: 52, height: 11, display: "block" }} />
            </div>
          ))}
        </div>
      </div>
      {/* History grid */}
      <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", minHeight: 480, background: "var(--bg-elevated)" }}>
        {/* Sidebar */}
        <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid var(--border)", padding: "8px 0" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
              <span className="skeleton-block" style={{ width: 80, height: 10, display: "block" }} />
              <span className="skeleton-block" style={{ width: "85%", height: 13, display: "block" }} />
              <span className="skeleton-block" style={{ width: "65%", height: 13, display: "block" }} />
              <span className="skeleton-block" style={{ width: 60, height: 10, display: "block" }} />
            </div>
          ))}
        </div>
        {/* Detail */}
        <div style={{ flex: 1, padding: "0" }}>
          <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)" }}>
            <span className="skeleton-block" style={{ width: 220, height: 11, display: "block" }} />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ display: "flex", gap: 20, padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
              <span className="skeleton-block" style={{ width: 24, height: 14, display: "block", flexShrink: 0 }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
                <span className="skeleton-block" style={{ width: "45%", height: 10, display: "block" }} />
                <span className="skeleton-block" style={{ width: "80%", height: 17, display: "block" }} />
                <span className="skeleton-block" style={{ width: "65%", height: 17, display: "block" }} />
                <span className="skeleton-block" style={{ width: "92%", height: 13, display: "block" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
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

  const totalItems = digests.reduce((sum, d) => sum + d.total_items_shown, 0);

  return (
    <div className="dash-shell">
      <DashboardNav userName={me?.name ?? null} avatarUrl={me?.avatar_url} />
      <main className="dash-main">
        {loading ? (
          <HistorySkeleton />
        ) : (
          <>
            <header className="dash-hero history-page-hero">
              <div>
                <p className="dash-hero-label">Archive</p>
                <h1 className="dash-hero-title">Past briefings</h1>
                <p className="dash-hero-date">
                  {digests.length > 0
                    ? `${digests.length} day${digests.length !== 1 ? "s" : ""} saved`
                    : "Your reading history lives here"}
                </p>
              </div>
              {digests.length > 0 && (
                <div className="dash-hero-meta">
                  <div className="meta-pill">
                    <span className="meta-value">{digests.length}</span>
                    <span className="meta-label">briefings</span>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-value">{totalItems}</span>
                    <span className="meta-label">items read</span>
                  </div>
                </div>
              )}
            </header>

            {digests.length === 0 ? (
              <div className="history-empty">
                <div className="briefing-empty-icon">
                  <span className="briefing-empty-ring" />
                </div>
                <h2 className="briefing-empty-title">No past briefings yet</h2>
                <p className="briefing-empty-desc">
                  Generate your first briefing from Today&apos;s dashboard — each day you refresh,
                  a new entry appears here.
                </p>
                <Link href="/dashboard" className="btn-primary history-empty-cta">
                  Go to Today
                </Link>
              </div>
            ) : (
              <HistoryArchive
                digests={digests}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
