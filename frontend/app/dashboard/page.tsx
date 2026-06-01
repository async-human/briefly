"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Digest, type MeResponse, type Source } from "@/lib/api";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BriefingPanel, SourcesSidebar } from "@/components/dashboard/BriefingPanel";
import { DashboardHero } from "@/components/dashboard/DashboardHero";

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
      <div className="dash-skeleton-hero">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonBlock w={64} h={10} />
          <SkeletonBlock w={240} h={34} />
          <SkeletonBlock w={180} h={13} />
        </div>
      </div>
      <div className="dash-skeleton-grid">
        <div className="briefing-panel" style={{ overflow: "hidden", minHeight: 320 }} />
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="dash-card" style={{ minHeight: 200 }} />
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
  const [generating, setGenerating] = useState(false);
  const [generatingPhase, setGeneratingPhase] = useState(0);
  const [error, setError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);

  const generatingRef = useRef(false);
  const pendingGenerateRef = useRef(false);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearPhaseTimers() {
    phaseTimers.current.forEach(clearTimeout);
    phaseTimers.current = [];
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
      const result = await api.generateDigest();
      setDigest(result.digest);
      setGenerateWarnings(result.warnings ?? []);
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

        const today = new Date().toISOString().split("T")[0];
        const needsDigest = !digestData || digestData.digest_date < today;
        const emptyToday =
          digestData &&
          digestData.digest_date === today &&
          digestData.total_items_shown === 0 &&
          (digestData.items?.length ?? 0) === 0;
        const hasSources = sourcesData.some((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));

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

  function handleSourceAdded(source: Source) {
    setSources((prev) => {
      if (prev.some((s) => s.id === source.id)) return prev;
      return [source, ...prev];
    });
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
    if (shouldRegenerate) {
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
        ) : (
          <>
            <DashboardHero
              name={greeting}
              dateLabel={today}
              itemCount={digest?.total_items_shown ?? null}
              sourceCount={sources.length}
              streak={me.reading_streak ?? 0}
              digestId={digest?.id ?? null}
              generating={generating}
            />

            <div className="dash-grid dash-grid-v2">
              <SourcesSidebar
                ingestionEmail={me.ingestion_email}
                sources={sources}
                gmailConnected={me.gmail_connected}
                autoSuggestions={me.auto_suggestions ?? []}
                onSourceAdded={handleSourceAdded}
                onSourceRemoved={handleSourceRemoved}
              />
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
          </>
        )}
    </DashboardShell>
  );
}
