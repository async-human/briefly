"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type MeResponse, type Source } from "@/lib/api";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BriefingPanel, SourcesSidebar } from "@/components/dashboard/BriefingPanel";
import { DiscoverContentPanel } from "@/components/dashboard/DiscoverContentPanel";
import { DashboardToolbar } from "@/components/dashboard/DashboardToolbar";
import { SourceDiscoveryWizard } from "@/components/dashboard/SourceDiscoveryWizard";
import { useBriefingGeneration } from "@/components/dashboard/BriefingGenerationProvider";
import { getDigestOutcome } from "@/lib/digestOutcome";
import { needsBriefingForToday } from "@/lib/localDate";
import {
  clearBriefingGeneratedToday,
  hasBriefingGeneratedToday,
  markBriefingGeneratedToday,
} from "@/lib/briefingStorage";
import { runSilentSourceDiscovery } from "@/lib/silentDiscovery";
import { AnimatedPageSkeleton } from "@/components/loading/AnimatedPageSkeleton";
import { BriefLoaderArt } from "@/components/loading/BriefLoaderArt";
import { PageContentTransition } from "@/components/loading/PageContentTransition";
import { useMinLoadTime } from "@/components/loading/useMinLoadTime";
import { BrieflyKnowsSummary } from "@/components/dashboard/BrieflyKnowsSummary";
import { StoryThreadsRail } from "@/components/dashboard/StoryThreadsRail";
import { SerendipityPanel } from "@/components/dashboard/SerendipityPanel";
import { WeeklyReportCard } from "@/components/dashboard/WeeklyReportCard";
import { ProactiveAlertsBanner } from "@/components/dashboard/ProactiveAlertsBanner";
import type { ProfileIntelligence } from "@/lib/api";

const FETCHABLE_SOURCE_TYPES = new Set([
  "rss", "youtube", "youtube_account", "reddit", "reddit_account",
  "url", "gmail", "email", "readwise",
]);

function DashboardContent() {
  const router = useRouter();
  const {
    digest,
    setDigest,
    generating,
    generatingLabel,
    generatingElapsedSec,
    generateError,
    generateWarnings,
    runGenerate,
    ensureBriefing,
  } = useBriefingGeneration();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const showLoading = useMinLoadTime(loading);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [error, setError] = useState("");
  const [connectBanner, setConnectBanner] = useState<string | null>(null);
  const [discoveryRunning, setDiscoveryRunning] = useState(false);
  const [intel, setIntel] = useState<ProfileIntelligence | null>(null);
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
        const [meData, todayDigest, sourcesData, genStatus, intelData] = await Promise.all([
          api.getMe(),
          api.getTodayDigest(),
          api.getSources(),
          api.getBriefingGenerationStatus().catch(() => null),
          api.getProfileIntelligence().catch(() => null),
        ]);

        if (!meData.onboarding_completed) {
          router.replace("/onboarding");
          return;
        }

        setMe(meData);
        if (todayDigest && (!digest || todayDigest.digest_date >= digest.digest_date)) {
          setDigest(todayDigest);
        }
        setSources(sourcesData);
        if (intelData) setIntel(intelData);
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

        const digestTimezone = meData.profile?.digest_timezone;
        const hasSources = sourcesData.some((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));

        const todayDigestOk =
          todayDigest && !needsBriefingForToday(todayDigest, digestTimezone);
        const ctxDigestOk = digest && !needsBriefingForToday(digest, digestTimezone);
        if (todayDigestOk || ctxDigestOk) {
          markBriefingGeneratedToday(meData.user.id, digestTimezone);
          return;
        }

        if (hasBriefingGeneratedToday(meData.user.id, digestTimezone)) {
          clearBriefingGeneratedToday(meData.user.id);
        }

        if (genStatus?.status === "running") {
          ensureBriefing();
          return;
        }

        if (autoGenerateChecked.current) return;
        autoGenerateChecked.current = true;

        if (hasSources && !generating) {
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

  function handleSourcesRemoved(sourceIds: string[]) {
    if (!sourceIds.length) return;
    const removing = new Set(sourceIds);
    let shouldRegenerate = false;
    setSources((prev) => {
      shouldRegenerate = prev.some(
        (s) => removing.has(s.id) && FETCHABLE_SOURCE_TYPES.has(s.source_type),
      );
      return prev.filter((s) => !removing.has(s.id));
    });
    if (shouldRegenerate && !showDiscovery) {
      if (me) clearBriefingGeneratedToday(me.user.id);
      setDigest(null);
      runGenerate();
    }
  }

  const fetchableSources = sources.filter((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));
  const sidebarSources = fetchableSources;
  const outcome = getDigestOutcome(digest);
  const greeting = me?.user.name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  if (showLoading) {
    return <AnimatedPageSkeleton variant="dashboard" />;
  }

  if (error || !me) {
    return <p className="form-error dash-error">{error || "Something went wrong"}</p>;
  }

  if (discoveryRunning) {
    return (
      <div className="dash-page dash-page-centered">
        <div className="hm-discovery-boot" aria-busy="true" aria-live="polite">
          <BriefLoaderArt size="lg" />
          <h2 className="hm-discovery-boot-title">Learning your sources</h2>
          <p className="hm-discovery-boot-desc">
            Briefly is scanning what you follow — your first brief is on the way.
          </p>
        </div>
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
    <PageContentTransition>
    <div className="dash-page">
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

      <ProactiveAlertsBanner />

      {intel && (
        <div className="dash-intelligence-row">
          <BrieflyKnowsSummary
            intel={intel}
            streak={me.reading_streak ?? 0}
            declaredInterests={me.profile?.interests?.map((i) => i.topic).filter(Boolean) ?? []}
          />
          <StoryThreadsRail threads={intel.active_threads ?? []} />
        </div>
      )}

      <WeeklyReportCard />

      {digest?.meta?.serendipity && digest.meta.serendipity.length > 0 && (
        <SerendipityPanel connections={digest.meta.serendipity} />
      )}

      <div className="dash-page-grid">
        <section className="dash-surface dash-surface-briefing" aria-labelledby="briefing-surface-title">
          <h2 id="briefing-surface-title" className="sr-only">
            Today&apos;s briefing
          </h2>
          <div className="dash-surface-body dash-surface-body-flush">
            <BriefingPanel
              digest={digest}
              sources={fetchableSources}
              sourcesCount={fetchableSources.length}
              generating={generating}
              generatingLabel={generatingLabel}
              generatingElapsedSec={generatingElapsedSec}
              generateError={generateError}
              generateWarnings={generateWarnings}
              onRegenerate={() => {
                if (me) clearBriefingGeneratedToday(me.user.id);
                runGenerate();
              }}
            />
            <DiscoverContentPanel onSourceAdded={handleSourceAdded} />
          </div>
        </section>

        <aside className="dash-surface dash-surface-sources" aria-labelledby="sources-surface-title">
          <div className="dash-surface-head dash-surface-head-rail">
            <h2 id="sources-surface-title" className="dash-surface-title">
              Sources
            </h2>
            <p className="dash-surface-desc">
              {fetchableSources.length > 0
                ? `${fetchableSources.length} connected`
                : "Connect your feeds"}
            </p>
          </div>
          <div className="dash-surface-body dash-surface-body-sources">
            <SourcesSidebar
              ingestionEmail={me.ingestion_email}
              sources={sidebarSources}
              gmailConnected={me.gmail_connected}
              autoSuggestions={me.auto_suggestions ?? []}
              onSourceAdded={handleSourceAdded}
              onSourcesRemoved={handleSourcesRemoved}
              onSourceUpdated={(updated) =>
                setSources((prev) =>
                  prev.map((s) => (s.id === updated.id ? updated : s)),
                )
              }
              onRediscover={() => void handleRediscover()}
            />
          </div>
        </aside>
      </div>
    </div>
    </PageContentTransition>
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
