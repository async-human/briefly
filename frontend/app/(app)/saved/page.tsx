"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type BrowserCapture } from "@/lib/api";
import { AppPageHeader } from "@/components/dashboard/AppPageHeader";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SaveLinkPanel } from "@/components/saved/SaveLinkPanel";
import { MobileShareSetup } from "@/components/saved/MobileShareSetup";
import { SavedCapturesList } from "@/components/saved/SavedCapturesList";
import { PageContentTransition } from "@/components/loading/PageContentTransition";
import { useMinLoadTime } from "@/components/loading/useMinLoadTime";
import { SavedPageSkeleton } from "@/components/saved/SavedPageSkeleton";
import { getToken } from "@/lib/auth";
import { urlFromShareParams } from "@/lib/shareUrl";

const CHROME_STORE_URL = process.env.NEXT_PUBLIC_CHROME_STORE_URL ?? "";

function SavedPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [captures, setCaptures] = useState<BrowserCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<{ name: string | null; avatar_url?: string | null } | null>(null);
  const sharedUrl = urlFromShareParams(searchParams);
  const showLoading = useMinLoadTime(loading);

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

  function handleSaved(item: BrowserCapture) {
    setCaptures((prev) => {
      const without = prev.filter((c) => c.id !== item.id);
      return [item, ...without];
    });
  }

  const queued = captures.filter((c) => !c.in_briefing).length;

  return (
    <DashboardShell userName={me?.name ?? null} avatarUrl={me?.avatar_url}>
      {showLoading ? (
        <SavedPageSkeleton />
      ) : (
      <PageContentTransition>
      <div className="dash-page">
        <AppPageHeader
          eyebrow="Save"
          title="Saved"
          subtitle="Feed articles to your second brain — extension on desktop, share or paste on mobile"
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

        <div className="dash-page-stack">
          <div className="dash-surface dash-surface-save-form">
            <div className="dash-surface-body">
              <SaveLinkPanel initialUrl={sharedUrl} onSaved={handleSaved} />
            </div>
          </div>

          <div className="dash-surface dash-surface-install-hint">
            <div className="dash-surface-body install-hint-body">
              <div>
                <h2 className="install-hint-title">Desktop — Chrome extension</h2>
                <p className="install-hint-desc">
                  One click on any article. Connect once from the extension popup — it stays linked
                  with a device token.
                </p>
                {!CHROME_STORE_URL ? (
                  <p className="install-hint-desc install-hint-dev">
                    Dev: Chrome → Extensions → Load unpacked → select the <code>extension/</code> folder
                    in this repo, then click Connect in the popup.
                  </p>
                ) : null}
              </div>
              {CHROME_STORE_URL ? (
                <a
                  href={CHROME_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dash-btn dash-btn-primary"
                >
                  Get extension
                </a>
              ) : (
                <span className="install-hint-badge">Store listing coming soon</span>
              )}
            </div>
            <div className="install-hint-divider" />
            <div className="dash-surface-body install-hint-body">
              <div>
                <h2 className="install-hint-title">Mobile — Share to Briefly</h2>
                <p className="install-hint-desc">
                  Add Briefly to your home screen, then share any article from Chrome or other apps.
                </p>
                <MobileShareSetup />
              </div>
            </div>
          </div>

          {captures.length === 0 ? (
            <div className="dash-surface dash-surface-empty">
              <div className="dash-empty-state">
                <h2 className="dash-empty-title">Your feed is empty</h2>
                <p className="dash-empty-desc">
                  Save your first article with the form above, the extension, or your phone&apos;s
                  share sheet.
                </p>
              </div>
            </div>
          ) : (
            <div className="dash-surface dash-surface-saved">
              <div className="dash-surface-head">
                <h2 className="dash-surface-title">Your saves</h2>
              </div>
              <div className="dash-surface-body dash-surface-body-flush-saved">
                <SavedCapturesList captures={captures} />
              </div>
            </div>
          )}
        </div>
      </div>
      </PageContentTransition>
      )}
    </DashboardShell>
  );
}

export default function SavedPage() {
  return (
    <Suspense
      fallback={
        <DashboardShell userName={null} avatarUrl={null}>
          <SavedPageSkeleton />
        </DashboardShell>
      }
    >
      <SavedPageContent />
    </Suspense>
  );
}
