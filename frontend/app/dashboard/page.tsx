"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Digest, type MeResponse, type Source } from "@/lib/api";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { BriefingPanel, SourcesSidebar } from "@/components/dashboard/BriefingPanel";

const FETCHABLE_SOURCE_TYPES = new Set([
  "rss", "youtube", "youtube_account", "reddit", "reddit_account", "url", "gmail",
]);

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [generateWarnings, setGenerateWarnings] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([api.getMe(), api.getLatestDigest(), api.getSources()])
      .then(([meData, digestData, sourcesData]) => {
        if (!meData.onboarding_completed) {
          router.replace("/onboarding");
          return;
        }
        setMe(meData);
        setDigest(digestData);
        setSources(sourcesData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError("");
    setGenerateWarnings([]);
    try {
      const result = await api.generateDigest();
      setDigest(result.digest);
      setGenerateWarnings(result.warnings);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate briefing");
    } finally {
      setGenerating(false);
    }
  }

  const fetchableSources = sources.filter((s) =>
    FETCHABLE_SOURCE_TYPES.has(s.source_type),
  );
  const greeting = me?.user.name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="dash-shell">
      <DashboardNav userName={me?.user.name ?? null} avatarUrl={me?.user.avatar_url} />

      <main className="dash-main">
        {loading ? (
          <div className="dash-loading-state">
            <span className="btn-spinner" />
            <p>Loading your briefing…</p>
          </div>
        ) : error || !me ? (
          <p className="form-error dash-error">{error || "Something went wrong"}</p>
        ) : (
          <>
            <header className="dash-hero">
              <div>
                <p className="dash-hero-label">Morning briefing</p>
                <h1 className="dash-hero-title">Good morning, {greeting}</h1>
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
                generateError={generateError}
                generateWarnings={generateWarnings}
                onGenerate={handleGenerate}
              />
              <SourcesSidebar
                ingestionEmail={me.ingestion_email}
                sources={sources}
                onSourceAdded={(s) => setSources((prev) => [s, ...prev])}
                onSourceRemoved={(id) => setSources((prev) => prev.filter((s) => s.id !== id))}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
