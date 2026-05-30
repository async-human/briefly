"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Digest, type MeResponse, type Source } from "@/lib/api";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { BriefingPanel, SourcesSidebar } from "@/components/dashboard/BriefingPanel";
import { TimeGreetingHero } from "@/components/TimeGreeting";

const FETCHABLE_SOURCE_TYPES = new Set([
  "rss", "youtube", "youtube_account", "reddit", "reddit_account", "url", "gmail",
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
      {/* Hero */}
      <div className="dash-skeleton-hero">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonBlock w={64} h={10} />
          <SkeletonBlock w={240} h={34} />
          <SkeletonBlock w={180} h={13} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {[1, 2].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
              <SkeletonBlock w={28} h={28} />
              <SkeletonBlock w={44} h={11} />
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="dash-skeleton-grid">
        {/* Briefing panel */}
        <div className="briefing-panel" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <SkeletonBlock w={200} h={11} />
          </div>
          <div style={{ padding: "8px 0" }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: "flex", gap: 20, padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
                <SkeletonBlock w={24} h={14} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
                  <SkeletonBlock w="50%" h={10} />
                  <SkeletonBlock w="88%" h={17} />
                  <SkeletonBlock w="72%" h={17} />
                  <SkeletonBlock w="90%" h={13} />
                  <SkeletonBlock w="75%" h={13} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[{ lines: 4, btn: true }, { lines: 3, btn: false }].map((card, ci) => (
            <div key={ci} className="dash-card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <SkeletonBlock w={80} h={10} />
              <SkeletonBlock w="55%" h={20} />
              {Array.from({ length: card.lines - 2 }).map((_, i) => (
                <SkeletonBlock key={i} w={i % 2 === 0 ? "90%" : "75%"} h={13} />
              ))}
              {card.btn && <SkeletonBlock w="100%" h={38} mb={4} />}
            </div>
          ))}
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
  const [neverShow, setNeverShow] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);

  const generatingRef = useRef(false);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearPhaseTimers() {
    phaseTimers.current.forEach(clearTimeout);
    phaseTimers.current = [];
  }

  async function runGenerate() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setGeneratingPhase(0);
    setGenerateError("");
    setGenerateWarnings([]);

    // Advance phase text every few seconds so the wait feels active
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
        setNeverShow(meData.profile?.never_show ?? []);
        setLoading(false);

        const today = new Date().toISOString().split("T")[0];
        const needsDigest = !digestData || digestData.digest_date < today;
        const hasSources = sourcesData.some((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));

        if (needsDigest && hasSources) runGenerate();
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
    setSources((prev) => [source, ...prev]);
    runGenerate();
  }

  async function handleNeverShowChange(tags: string[]) {
    setNeverShow(tags);
    try {
      await api.updateOnboardingProfile({ never_show: tags });
    } catch {
      // optimistic — state already updated, silent failure is acceptable
    }
  }

  const fetchableSources = sources.filter((s) => FETCHABLE_SOURCE_TYPES.has(s.source_type));
  const greeting = me?.user.name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div className="dash-shell">
      <DashboardNav userName={me?.user.name ?? null} avatarUrl={me?.user.avatar_url} />

      <main className="dash-main">
        {loading ? (
          <DashboardSkeleton />
        ) : error || !me ? (
          <p className="form-error dash-error">{error || "Something went wrong"}</p>
        ) : (
          <>
            <header className="dash-hero">
              <div>
                <TimeGreetingHero name={greeting} />
                <p className="dash-hero-date">{today}</p>
              </div>
              <div className="dash-hero-meta">
                <div className="meta-pill">
                  <span className="meta-value">{sources.length}</span>
                  <span className="meta-label">sources</span>
                </div>
                <div className="meta-pill">
                  <span className="meta-value">{digest?.total_items_shown ?? "—"}</span>
                  <span className="meta-label">items today</span>
                </div>
              </div>
            </header>

            <div className="dash-grid">
              <BriefingPanel
                digest={digest}
                sources={fetchableSources}
                sourcesCount={fetchableSources.length}
                generating={generating}
                generatingPhase={generatingPhase}
                generateError={generateError}
                generateWarnings={generateWarnings}
              />
              <SourcesSidebar
                ingestionEmail={me.ingestion_email}
                sources={sources}
                gmailConnected={me.gmail_connected}
                onSourceAdded={handleSourceAdded}
                onSourceRemoved={(id) => setSources((prev) => prev.filter((s) => s.id !== id))}
                neverShow={neverShow}
                onNeverShowChange={handleNeverShowChange}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
