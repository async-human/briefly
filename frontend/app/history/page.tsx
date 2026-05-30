"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type DigestSummary } from "@/lib/api";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { HistoryArchive } from "@/components/history/HistoryArchive";
import { getToken } from "@/lib/auth";

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
          <div className="dash-loading-state">
            <span className="btn-spinner" />
            <p>Loading history…</p>
          </div>
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
