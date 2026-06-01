"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type DigestSummary } from "@/lib/api";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { HistoryArchive } from "@/components/history/HistoryArchive";
import { getToken } from "@/lib/auth";

function HistorySkeleton() {
  return (
    <>
      <div className="dash-skeleton-hero dash-skeleton-hero-v2">
        <div className="dash-skeleton-hero-main">
          <span className="skeleton-block" style={{ width: 60, height: 10, display: "block" }} />
          <span className="skeleton-block" style={{ width: 200, height: 34, display: "block", marginTop: 10 }} />
          <span className="skeleton-block" style={{ width: 120, height: 13, display: "block", marginTop: 10 }} />
        </div>
        <div className="dash-skeleton-hero-stats">
          {[1, 2].map((i) => (
            <div key={i} className="dash-skeleton-stat">
              <span className="skeleton-block" style={{ width: 28, height: 28, display: "block" }} />
              <span className="skeleton-block" style={{ width: 52, height: 11, display: "block", marginTop: 6 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="history-skeleton-shell">
        <div className="history-skeleton-rail">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="history-skeleton-day">
              <span className="skeleton-block" style={{ width: 80, height: 10, display: "block" }} />
              <span className="skeleton-block" style={{ width: "85%", height: 13, display: "block", marginTop: 8 }} />
              <span className="skeleton-block" style={{ width: "65%", height: 13, display: "block", marginTop: 8 }} />
              <span className="skeleton-block" style={{ width: 60, height: 10, display: "block", marginTop: 8 }} />
            </div>
          ))}
        </div>
        <div className="history-skeleton-detail">
          <div className="history-skeleton-detail-head">
            <span className="skeleton-block" style={{ width: 220, height: 11, display: "block" }} />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="history-skeleton-item">
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
    <DashboardShell userName={me?.name ?? null} avatarUrl={me?.avatar_url}>
        {loading ? (
          <HistorySkeleton />
        ) : (
          <>
            <header className="dash-hero dash-hero-v2 history-page-hero">
              <div className="dash-hero-main">
                <p className="dash-hero-label">Archive</p>
                <h1 className="dash-hero-title">Past briefings</h1>
                <p className="dash-hero-date">
                  {digests.length > 0
                    ? `${digests.length} day${digests.length !== 1 ? "s" : ""} saved`
                    : "Your reading history lives here"}
                </p>
              </div>
              {digests.length > 0 && (
                <ul className="dash-hero-stats" aria-label="Archive summary">
                  <li>
                    <span className="dash-hero-stat-value">{digests.length}</span>
                    <span className="dash-hero-stat-label">briefings</span>
                  </li>
                  <li>
                    <span className="dash-hero-stat-value">{totalItems}</span>
                    <span className="dash-hero-stat-label">items read</span>
                  </li>
                </ul>
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
    </DashboardShell>
  );
}
