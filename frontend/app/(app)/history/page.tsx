"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type DigestSummary } from "@/lib/api";
import { AppPageHeader } from "@/components/dashboard/AppPageHeader";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { HistoryArchive } from "@/components/history/HistoryArchive";
import { AnimatedPageSkeleton } from "@/components/loading/AnimatedPageSkeleton";
import { PageContentTransition } from "@/components/loading/PageContentTransition";
import { useMinLoadTime } from "@/components/loading/useMinLoadTime";
import { getToken } from "@/lib/auth";

export default function HistoryPage() {
  const router = useRouter();
  const [digests, setDigests] = useState<DigestSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);
  const showLoading = useMinLoadTime(loading);

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
      {showLoading ? (
        <AnimatedPageSkeleton variant="history" />
      ) : (
        <PageContentTransition>
        <div className="dash-page">
          <AppPageHeader
            eyebrow="History"
            title="Past briefings"
            subtitle={
              digests.length > 0
                ? `${digests.length} saved briefing${digests.length !== 1 ? "s" : ""} — pick a day to read`
                : "Your reading archive will appear here after your first brief"
            }
            stats={
              digests.length > 0
                ? [
                    { value: digests.length, label: "Briefings" },
                    { value: totalItems, label: "Items" },
                  ]
                : undefined
            }
            actions={
              <Link href="/dashboard" className="dash-btn dash-btn-secondary">
                Today
              </Link>
            }
          />

          {digests.length === 0 ? (
            <div className="dash-surface dash-surface-empty">
              <div className="dash-empty-state">
                <h2 className="dash-empty-title">No past briefings yet</h2>
                <p className="dash-empty-desc">
                  Generate your first briefing from Today — each day you refresh, a new entry
                  appears here.
                </p>
                <Link href="/dashboard" className="dash-btn dash-btn-primary">
                  Go to Today
                </Link>
              </div>
            </div>
          ) : (
            <div className="dash-surface dash-surface-history">
              <div className="dash-surface-head dash-surface-head-inline">
                <div>
                  <h2 className="dash-surface-title">Archive</h2>
                  <p className="dash-surface-desc">
                    Timeline on the left · full briefing on the right
                  </p>
                </div>
              </div>
              <div className="dash-surface-body dash-surface-body-flush">
                <HistoryArchive
                  digests={digests}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
            </div>
          )}
        </div>
        </PageContentTransition>
      )}
    </DashboardShell>
  );
}
