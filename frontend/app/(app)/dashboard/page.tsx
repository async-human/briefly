"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type MeResponse, type Source } from "@/lib/api";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BriefingPanel, SourcesSidebar } from "@/components/dashboard/BriefingPanel";
import { DashboardToolbar } from "@/components/dashboard/DashboardToolbar";
import { SourceDiscoveryWizard } from "@/components/dashboard/SourceDiscoveryWizard";
import { useBriefingGeneration } from "@/components/dashboard/BriefingGenerationProvider";
import { getDigestOutcome } from "@/lib/digestOutcome";
import { needsBriefingForToday } from "@/lib/localDate";
import { runSilentSourceDiscovery } from "@/lib/silentDiscovery";

const FETCHABLE_SOURCE_TYPES = new Set([
  "rss", "youtube", "youtube_account", "reddit", "reddit_account",
  "url", "gmail", "email", "readwise",
]);

function SkeletonBlock({ w, h, mb = 0 }: { w: number | string; h: number; mb?: number }) {
  return (
    <span
      className="skeleton-block"
      style={{ width: w, height: h, marginBottom: mb, display: "block" }}
    />
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="dash-toolbar dash-toolbar-skeleton">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonBlock w={120} h={10} />
          <SkeletonBlock w={280} h={28} />
        </div>
      </div>
      <div className="dash-skeleton-grid dash-layout-v3">
        <div className="briefing-panel dash-main-col" style={{ overflow: "hidden", minHeight: 360 }} />
        <aside className="dash-aside-col" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="dash-card" style={{ minHeight: 180 }} />
        </aside>
      </div>
    </>
  );
}

function DashboardContent() {
  const router = useRouter();
  const {
    digest,
    setDigest,
    generating,
    generatingLabel,
    generateError,
    generateWarnings,
    runGenerate,
    ensureBriefing,
    resumePolling,
  } = useBriefingGeneration();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [error, setError] = useState("");
  const [connectBanner, setConnectBanner] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [discoveryRunning, setDiscoveryRunning] = useState(false);
  const autoGenerateChecked = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    if (!gmail) return;

    window.history.replaceState({}, "", "/dashboard");

    if (gmail === "connected") {
      void api.getGmailStatus().then((status) => {
        if (status.access_error) {
          setConnectBanner(
            status.access_error_message ||
              "Gmail connected but inbox read access was denied. Reconnect and approve all permissions.",
          );
        } else {
          setConnectBanner("Gmail connected — scanning your inbox for newsletters…");
        }
      });
      void api.getMe().then(setMe);
    } else if (gmail === "denied") {
      setConnectBanner("Google blocked Gmail access. Add your email as a test user in Google Cloud Console, then try again.");
    } else if (gmail === "error") {
      setConnectBanner("Gmail connection was cancelled or failed. Please try again.");
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const [meData, digestData, sourcesData, genStatus] = await Promise.all([
          api.getMe(),
          api.getLatestDigest(),
          api.getSources(),
          api.getBriefingGenerationStatus().catch(() => null),
        ]);

        if (!meData.onboarding_completed) {
          router.replace("/onboarding");
          return;
        }

        setMe(meData);
        if (digestData) setDigest(digestData);
        setSources(sourcesData);
        setLoading(false);

        if (!meData.sources_discovery_confirmed) {
          const hasFetchable = sourcesData.some((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));
          if (meData.gmail_connected || hasFetchable) {
            setDiscoveryRunning(true);
            try {
              await runSilentSourceDiscovery();
              const freshSources = await api.getSources();
              setSources(freshSources);
              setMe({ ...meData, sources_discovery_confirmed: true, pending_discovery_count: 0 });
            } catch {
              setShowDiscovery(true);
              setDiscoveryRunning(false);
              return;
            }
            setDiscoveryRunning(false);
          } else {
            setShowDiscovery(true);
            return;
          }
        }

        if (autoGenerateChecked.current) return;
        autoGenerateChecked.current = true;

        if (genStatus?.status === "running") {
          resumePolling();
          return;
        }

        const digestTimezone = meData.profile?.digest_timezone;
        const hasSources = sourcesData.some((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));

        if (needsBriefingForToday(digestData, digestTimezone) && hasSources && !generating) {
          ensureBriefing();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
        setLoading(false);
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleRediscover() {
    await api.resetSourceDiscovery();
    setShowDiscovery(true);
    setMe((prev) => (prev ? { ...prev, sources_discovery_confirmed: false } : prev));
  }

  async function handleDiscoveryConfirmed(added: Source[]) {
    setShowDiscovery(false);
    const freshSources = await api.getSources();
    setSources(freshSources);
    setMe((prev) =>
      prev ? { ...prev, sources_discovery_confirmed: true, pending_discovery_count: 0 } : prev,
    );
    if (added.length) {
      /* merged via getSources */
    }
    ensureBriefing();
  }

  function handleSourceAdded(source: Source) {
    setSources((prev) => {
      if (prev.some((s) => s.id === source.id)) return prev;
      return [source, ...prev];
    });
    if (showDiscovery) return;
    if (FETCHABLE_SOURCE_TYPES.has(source.source_type)) {
      ensureBriefing();
    }
  }

  function handleSourceRemoved(sourceId: string) {
    let shouldRegenerate = false;
    setSources((prev) => {
      const removed = prev.find((s) => s.id === sourceId);
      if (removed && FETCHABLE_SOURCE_TYPES.has(removed.source_type)) {
        shouldRegenerate = true;
      }
      return prev.filter((s) => s.id !== sourceId);
    });
    if (shouldRegenerate && !showDiscovery) {
      runGenerate();
    }
  }

  const fetchableSources = sources.filter((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));
  const outcome = getDigestOutcome(digest);
  const greeting = me?.user.name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error || !me) {
    return <p className="form-error dash-error">{error || "Something went wrong"}</p>;
  }

  if (discoveryRunning) {
    return (
      <div className="outcome-discovery-loading">
        <span className="btn-spinner" aria-hidden />
        <p>Briefly is learning your sources — your first brief is on the way…</p>
      </div>
    );
  }

  if (showDiscovery) {
    return (
      <SourceDiscoveryWizard
        existingSources={fetchableSources}
        gmailConnected={me.gmail_connected}
        connectBanner={connectBanner}
        onConfirmed={handleDiscoveryConfirmed}
        onSourceAdded={handleSourceAdded}
      />
    );
  }

  return (
    <>
      <DashboardToolbar
        name={greeting}
        dateLabel={today}
        itemCount={digest?.total_items_shown ?? null}
        savedMinutes={outcome?.saved_minutes ?? null}
        sourceCount={fetchableSources.length}
        streak={me.reading_streak ?? 0}
        digestId={digest?.id ?? null}
        generating={generating}
        onRefresh={runGenerate}
      />

      <div className="dash-layout-v3">
        <div className="dash-main-col">
          <BriefingPanel
            digest={digest}
            sources={fetchableSources}
            sourcesCount={fetchableSources.length}
            generating={generating}
            generatingLabel={generatingLabel}
            generateError={generateError}
            generateWarnings={generateWarnings}
            onRegenerate={runGenerate}
          />
        </div>
        <aside className="dash-aside-col">
          {showSources ? (
            <SourcesSidebar
              ingestionEmail={me.ingestion_email}
              sources={sources}
              gmailConnected={me.gmail_connected}
              autoSuggestions={me.auto_suggestions ?? []}
              onSourceAdded={handleSourceAdded}
              onSourceRemoved={handleSourceRemoved}
              onSourceUpdated={(updated) =>
                setSources((prev) =>
                  prev.map((s) => (s.id === updated.id ? updated : s)),
                )
              }
              onRediscover={() => void handleRediscover()}
              onClose={() => setShowSources(false)}
            />
          ) : (
            <button
              type="button"
              className="outcome-sources-toggle"
              onClick={() => setShowSources(true)}
            >
              <span className="outcome-sources-toggle-label">Briefly&apos;s sources</span>
              <span className="outcome-sources-toggle-hint">Optional — Briefly reads in the background</span>
            </button>
          )}
        </aside>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    void api.getMe().then(setMe).catch(() => setMe(null));
  }, []);

  return (
    <DashboardShell userName={me?.user.name ?? null} avatarUrl={me?.user.avatar_url}>
      <DashboardContent />
    </DashboardShell>
  );
}
