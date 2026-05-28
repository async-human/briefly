"use client";

import { useEffect, useState } from "react";
import { api, type Digest, type MeResponse, type Source } from "@/lib/api";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { AddSourceForm } from "@/components/dashboard/AddSourceForm";

export default function DashboardPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [digest, setDigest] = useState<Digest | null | undefined>(undefined);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [meData, digestData, sourcesData] = await Promise.all([
          api.getMe(),
          api.getLatestDigest(),
          api.getSources(),
        ]);
        setMe(meData);
        setDigest(digestData);
        setSources(sourcesData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <>
        <DashboardNav userName={null} />
        <main className="dash-main"><p className="dash-loading">Loading…</p></main>
      </>
    );
  }

  if (error || !me) {
    return (
      <>
        <DashboardNav userName={null} />
        <main className="dash-main">
          <p className="form-error">{error || "Something went wrong"}</p>
        </main>
      </>
    );
  }

  const greeting = me.user.name?.split(" ")[0] ?? "there";

  return (
    <>
      <DashboardNav userName={me.user.name} />
      <main className="dash-main">
        <div className="dash-grid">
          <section className="dash-primary">
            <div className="dash-header">
              <h1 className="dash-greeting">Good morning, {greeting}</h1>
              <p className="dash-date">
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>

            {digest === null ? (
              <div className="dash-empty">
                <h2>Your first briefing is on its way</h2>
                <p>
                  Connect a source below. Briefly will read overnight and deliver your first digest tomorrow morning.
                </p>
              </div>
            ) : digest ? (
              <div className="digest-panel">
                <div className="digest-panel-meta">
                  <span>{digest.total_items_shown} items</span>
                  <span>{digest.status}</span>
                </div>
                {digest.items.map((item) => (
                  <article key={item.id} className="digest-panel-item">
                    {item.section && (
                      <p className="digest-panel-section">{item.section}</p>
                    )}
                    <p className="digest-panel-source">{item.source_name}</p>
                    <h3 className="digest-panel-headline">{item.headline}</h3>
                    <p className="digest-panel-why">{item.why_it_matters}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </section>

          <aside className="dash-sidebar">
            <div className="dash-card">
              <h2 className="dash-card-title">Your ingestion email</h2>
              <p className="dash-card-desc">
                Forward newsletters to this address to add them as a source.
              </p>
              <code className="ingestion-email">{me.ingestion_email}</code>
            </div>

            <div className="dash-card">
              <h2 className="dash-card-title">Sources</h2>
              <p className="dash-card-desc">{sources.length} connected</p>
              <AddSourceForm onAdded={(s) => setSources((prev) => [s, ...prev])} />
              {sources.length > 0 && (
                <ul className="source-list">
                  {sources.map((source) => (
                    <li key={source.id} className="source-list-item">
                      <span className="source-type">{source.source_type}</span>
                      <span className="source-name">{source.name ?? source.identifier}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
