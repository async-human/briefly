"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type BrowserCapture } from "@/lib/api";
import { AppPageHeader } from "@/components/dashboard/AppPageHeader";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SavedCapturesList } from "@/components/saved/SavedCapturesList";
import { getToken } from "@/lib/auth";

function SavedSkeleton() {
  return (
    <div className="dash-page">
      <header className="dash-page-header dash-page-header-skeleton">
        <span className="skeleton-block" style={{ width: 72, height: 12, display: "block" }} />
        <span className="skeleton-block" style={{ width: 200, height: 32, display: "block", marginTop: 12 }} />
      </header>
      <div className="dash-surface" style={{ minHeight: 320 }} />
    </div>
  );
}

export default function SavedPage() {
  const router = useRouter();
  const [captures, setCaptures] = useState<BrowserCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    Promise.all([api.getMe(), api.listCaptures()])
      .then(([meData, list]) => {
        setMe({ name: meData.user.name, avatar_url: meData.user.avatar_url });
        setCaptures(list);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  const queued = captures.filter((c) => !c.in_briefing).length;

  return (
    <DashboardShell userName={me?.name ?? null} avatarUrl={me?.avatar_url}>
      {loading ? (
        <SavedSkeleton />
      ) : (
        <div className="dash-page">
          <AppPageHeader
            eyebrow="Extension"
            title="Saved"
            subtitle={
              captures.length > 0
                ? "Articles you fed to Briefly from the web — processed into your second brain"
                : "Save articles with the Briefly extension — they appear here instantly"
            }
            stats={
              captures.length > 0
                ? [
                    { value: captures.length, label: "Saved" },
                    ...(queued > 0 ? [{ value: queued, label: "Queued", accent: true }] : []),
                  ]
                : undefined
            }
            actions={
              <Link href="/dashboard" className="dash-btn dash-btn-secondary">
                Today
              </Link>
            }
          />

          {captures.length === 0 ? (
            <div className="dash-surface dash-surface-empty">
              <div className="dash-empty-state">
                <h2 className="dash-empty-title">Nothing saved yet</h2>
                <p className="dash-empty-desc">
                  Install the Briefly browser extension, connect your account, and click it on
                  any article. You&apos;ll see what it connects to — and it&apos;ll land here.
                </p>
                <Link href="/dashboard" className="dash-btn dash-btn-primary">
                  Go to Today
                </Link>
              </div>
            </div>
          ) : (
            <div className="dash-surface dash-surface-saved">
              <div className="dash-surface-body">
                <SavedCapturesList captures={captures} />
              </div>
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
