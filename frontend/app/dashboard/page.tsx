"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Digest, type MeResponse, type Source } from "@/lib/api";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BriefingPanel, SourcesSidebar } from "@/components/dashboard/BriefingPanel";
import { DashboardToolbar } from "@/components/dashboard/DashboardToolbar";
import { SourceDiscoveryWizard } from "@/components/dashboard/SourceDiscoveryWizard";

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

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingPhase, setGeneratingPhase] = useState(0);
  const [error, setError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);
  const [connectBanner, setConnectBanner] = useState<string | null>(null);

  const generatingRef = useRef(false);
  const pendingGenerateRef = useRef(false);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearPhaseTimers() {
    phaseTimers.current.forEach(clearTimeout);
    phaseTimers.current = [];
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function pollBriefingUntilDone(): Promise<{ digest: Digest; warnings: string[] }> {
    const maxAttempts = 300;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(2000);
      const status = await api.getBriefingGenerationStatus();
      if (status.status === "complete") {
        const digest =
          status.digest ??
          (status.digest_id ? await api.getDigest(status.digest_id) : null) ??
          (await api.getLatestDigest());
        if (digest) {
          return { digest, warnings: status.warnings ?? [] };
        }
      }
      if (status.status === "error") {
        throw new Error(status.error || "Briefing generation failed");
      }
    }
    const latest = await api.getLatestDigest();
    if (latest) {
      return { digest: latest, warnings: [] };
    }
    throw new Error(
      "Briefing generation is taking longer than expected. Try refreshing in a moment.",
    );
  }

  async function runGenerate() {
    if (generatingRef.current) {
      pendingGenerateRef.current = true;
      return;
    }
    generatingRef.current = true;
    pendingGenerateRef.current = false;
    setGenerating(true);
    setGeneratingPhase(0);
    setGenerateError("");
    setGenerateWarnings([]);

    clearPhaseTimers();
    phaseTimers.current = [
      setTimeout(() => setGeneratingPhase(1), 4000),
      setTimeout(() => setGeneratingPhase(2), 9000),
    ];

    try {
      const existing = await api.getBriefingGenerationStatus().catch(() => null);
      const alreadyRunning = existing?.status === "running";

      if (!alreadyRunning) {
        const started = await api.generateDigest();
        if (started.status === "complete" && started.digest) {
          setDigest(started.digest);
          setGenerateWarnings(started.warnings ?? []);
          return;
        }
      }

      const result = await pollBriefingUntilDone();
      setDigest(result.digest);
      setGenerateWarnings(result.warnings);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate briefing");
    } finally {
      clearPhaseTimers();
      setGenerating(false);
      setGeneratingPhase(0);
      generatingRef.current = false;
      if (pendingGenerateRef.current) {
        pendingGenerateRef.current = false;
        void runGenerate();
      }
    }
  }

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
        const [meData, digestData, sourcesData] = await Promise.all([
          api.getMe(),
          api.getLatestDigest(),
          api.getSources(),
        ]);

        if (!meData.onboarding_completed) {
          router.replace("/onboarding");
          return;
        }

        setMe(meData);
        setDigest(digestData);
        setSources(sourcesData);
        setLoading(false);

        if (!meData.sources_discovery_confirmed) {
          setShowDiscovery(true);
          return;
        }

        const today = new Date().toISOString().split("T")[0];
        const needsDigest = !digestData || digestData.digest_date < today;
        const emptyToday =
          digestData &&
          digestData.digest_date === today &&
          digestData.total_items_shown === 0 &&
          (digestData.items?.length ?? 0) === 0;
        const hasSources = sourcesData.some((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));

        const genStatus = await api.getBriefingGenerationStatus().catch(() => null);
        if (genStatus?.status === "running") {
          void runGenerate();
          return;
        }

        if ((needsDigest || emptyToday) && hasSources) runGenerate();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
        setLoading(false);
      }
    }

    init();
    return () => clearPhaseTimers();
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
    void runGenerate();
  }

  function handleSourceAdded(source: Source) {
    setSources((prev) => {
      if (prev.some((s) => s.id === source.id)) return prev;
      return [source, ...prev];
    });
    if (showDiscovery) return;
    if (FETCHABLE_SOURCE_TYPES.has(source.source_type)) {
      void runGenerate();
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
      void runGenerate();
    }
  }

  const fetchableSources = sources.filter((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));
  const greeting = me?.user.name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <DashboardShell userName={me?.user.name ?? null} avatarUrl={me?.user.avatar_url}>
        {loading ? (
          <DashboardSkeleton />
        ) : error || !me ? (
          <p className="form-error dash-error">{error || "Something went wrong"}</p>
        ) : showDiscovery ? (
          <SourceDiscoveryWizard
            existingSources={fetchableSources}
            gmailConnected={me.gmail_connected}
            connectBanner={connectBanner}
            onConfirmed={handleDiscoveryConfirmed}
            onSourceAdded={handleSourceAdded}
          />
        ) : (
          <>
            <DashboardToolbar
              name={greeting}
              dateLabel={today}
              itemCount={digest?.total_items_shown ?? null}
              sourceCount={fetchableSources.length}
              streak={me.reading_streak ?? 0}
              digestId={digest?.id ?? null}
              generating={generating}
              onRegenerate={() => void runGenerate()}
            />

            <div className="dash-layout-v3">
              <div className="dash-main-col">
                <BriefingPanel
                  digest={digest}
                  sources={fetchableSources}
                  sourcesCount={fetchableSources.length}
                  generating={generating}
                  generatingPhase={generatingPhase}
                  generateError={generateError}
                  generateWarnings={generateWarnings}
                  onRegenerate={() => void runGenerate()}
                />
              </div>
              <SourcesSidebar
                ingestionEmail={me.ingestion_email}
                sources={sources}
                gmailConnected={me.gmail_connected}
                autoSuggestions={me.auto_suggestions ?? []}
                onSourceAdded={handleSourceAdded}
                onSourceRemoved={handleSourceRemoved}
                onRediscover={() => void handleRediscover()}
              />
            </div>
          </>
        )}
    </DashboardShell>
  );
}
