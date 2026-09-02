"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DiscoveredArticle, type Source } from "@/lib/api";
import { SourceIcon } from "@/components/SourceIcon";
import { BriefLoaderArt } from "@/components/loading/BriefLoaderArt";
import { useUpgradeOptional } from "@/components/billing/UpgradeProvider";
import { isPlanLimitError, upgradeReasonFromError } from "@/lib/plans";

type DiscoverContentPanelProps = {
  onSourceAdded?: (source: Source) => void;
};

const REASON_LABELS: Record<string, string> = {
  coverage_gap: "Fills a gap",
  behavioral: "Matches your reads",
  recent_engagement: "From recent interest",
  cluster: "Topic cluster",
  declared: "Your interests",
};

const POLL_MS = 3000;
const MAX_POLLS = 60; // ~3 min of polling; job runs in background if this elapses

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function discoveryStatus(meta?: Record<string, unknown>): string {
  const status = meta?.status;
  return typeof status === "string" ? status : "idle";
}

function discoveryLabel(meta?: Record<string, unknown>): string {
  const label = meta?.label;
  return typeof label === "string" && label.trim() ? label : "Scanning for relevant articles…";
}

export function DiscoverContentPanel({ onSourceAdded }: DiscoverContentPanelProps) {
  const upgrade = useUpgradeOptional();
  const [articles, setArticles] = useState<DiscoveredArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanLabel, setScanLabel] = useState("Scanning for relevant articles…");
  const [refreshing, setRefreshing] = useState(false);
  const [addingFeed, setAddingFeed] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef(false);
  const holdArticlesRef = useRef(false);

  const applyResponse = useCallback((res: Awaited<ReturnType<typeof api.getDiscoveredArticles>>) => {
    const status = discoveryStatus(res.meta);
    const label = discoveryLabel(res.meta);
    setScanLabel(label);
    setScanning(status === "running");
    if (status === "error" && typeof res.meta?.error === "string") {
      setError(res.meta.error);
    }
    if (!holdArticlesRef.current || status !== "running") {
      setArticles(res.articles);
      if (status !== "running") holdArticlesRef.current = false;
    }
  }, []);

  const pollUntilDone = useCallback(async () => {
    if (pollRef.current) return;
    pollRef.current = true;
    try {
      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS);
        const res = await api.getDiscoveredArticles();
        applyResponse(res);
        const status = discoveryStatus(res.meta);
        if (status !== "running") {
          if (status === "complete" && res.articles.length === 0) {
            setError(null);
          }
          return;
        }
      }
      // Job may still be running server-side — don't treat as hard failure
      setScanning(true);
      setScanLabel("Still scanning in the background — check back in a minute or tap Refresh.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load discoveries");
    } finally {
      pollRef.current = false;
      holdArticlesRef.current = false;
      setScanning(false);
      setRefreshing(false);
    }
  }, [applyResponse]);

  const load = useCallback(async (force = false) => {
    setError(null);
    try {
      const res = force
        ? await api.refreshDiscoveredArticles()
        : await api.getDiscoveredArticles();
      applyResponse(res);
      const status = discoveryStatus(res.meta);
      if (status === "running" || (force && res.articles.length === 0)) {
        setScanning(true);
        void pollUntilDone();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load discoveries");
    } finally {
      setLoading(false);
      if (!pollRef.current) {
        holdArticlesRef.current = false;
        setRefreshing(false);
      }
    }
  }, [applyResponse, pollUntilDone]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    holdArticlesRef.current = true;
    setRefreshing(true);
    setScanning(true);
    setScanLabel("Refreshing discoveries…");
    setArticles([]);
    setDismissed(new Set());
    setError(null);
    await load(true);
  }

  async function handleSubscribe(article: DiscoveredArticle) {
    const feedUrl = article.feed_url?.trim();
    if (!feedUrl) return;
    setAddingFeed(article.id);
    try {
      const src = await api.addSource({
        identifier: feedUrl,
        name: article.source_name,
      });
      onSourceAdded?.(src);
      setDismissed((prev) => new Set(prev).add(article.id));
      void upgrade?.refreshBilling();
    } catch (err) {
      if (isPlanLimitError(err)) {
        upgrade?.openUpgrade({ reason: upgradeReasonFromError(err) });
      } else {
        setError("Could not add this source.");
      }
    } finally {
      setAddingFeed(null);
    }
  }

  const available = articles.filter((a) => !dismissed.has(a.id));
  const visible = available.slice(0, 3);

  if (loading) {
    return (
      <div className="discover-content-panel discover-content-loading">
        <BriefLoaderArt size="sm" />
        <p>Finding relevant content outside your subscriptions…</p>
      </div>
    );
  }

  const showPanel = visible.length > 0 || error || scanning || refreshing;

  if (!showPanel) {
    return null;
  }

  return (
    <section
      className="discover-content-panel"
      aria-labelledby="discover-content-title"
      aria-busy={refreshing}
    >
      <header className="discover-content-head">
        <div>
          <h2 id="discover-content-title" className="discover-content-title">
            Discoveries
          </h2>
          <p className="discover-content-desc">
            {visible.length === 1 ? "1 discovery" : `${visible.length} discoveries`} beyond your subscriptions,
            selected from your interests and reading behavior.
          </p>
        </div>
        <button
          type="button"
          className="discover-content-refresh"
          onClick={() => void handleRefresh()}
          disabled={refreshing || scanning}
        >
          {refreshing ? "Refreshing…" : scanning ? "Scanning…" : "Refresh"}
        </button>
      </header>

      {refreshing ? (
        <div className="discover-content-refresh-stage" aria-live="polite">
          <div className="discover-content-refresh-lead">
            <BriefLoaderArt size="md" />
            <div>
              <p className="discover-content-refresh-title">Looking for new discoveries</p>
              <p className="discover-content-refresh-label">{scanLabel}</p>
            </div>
          </div>
          <ul className="discover-content-list" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="discover-content-card discover-content-card-skel">
                <span className="discover-skel discover-skel-badge" />
                <span className="discover-skel discover-skel-title" />
                <span className="discover-skel discover-skel-line" />
                <span className="discover-skel discover-skel-line discover-skel-short" />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {scanning && (
            <div className="discover-content-scanning" aria-live="polite">
              <BriefLoaderArt size="sm" />
              <p>{scanLabel}</p>
            </div>
          )}

          {error && <p className="form-error discover-content-error">{error}</p>}

          {visible.length === 0 && !scanning && !error && (
            <p className="discover-content-empty">No new discoveries this pass. Refresh to try again.</p>
          )}

          {visible.length > 0 && (
            <ul className="discover-content-list discover-content-list-ready">
              {visible.map((article) => {
                const scorePct = Math.round((article.relevance_score || 0) * 100);
                const reasonLabel =
                  (article.discovery_reason && REASON_LABELS[article.discovery_reason]) || "Relevant";
                return (
                  <li key={article.id} className="discover-content-card">
                    <div className="discover-content-card-top">
                      <span className="discover-content-score">{scorePct}% match</span>
                      <span className="discover-content-reason">{reasonLabel}</span>
                    </div>
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="discover-content-link"
                    >
                      {article.title}
                    </a>
                    <p className="discover-content-why">{article.why_relevant}</p>
                    <div className="discover-content-meta">
                      <SourceIcon type={article.source_type ?? "rss"} size={14} />
                      <span>{article.source_name}</span>
                      {article.intent_topic && (
                        <span className="discover-content-topic">· {article.intent_topic}</span>
                      )}
                    </div>
                    <div className="discover-content-actions">
                      {article.feed_url && (
                        <button
                          type="button"
                          className="discover-content-subscribe"
                          onClick={() => void handleSubscribe(article)}
                          disabled={addingFeed === article.id}
                        >
                          {addingFeed === article.id ? "Adding…" : "Subscribe to source"}
                        </button>
                      )}
                      <button
                        type="button"
                        className="discover-content-dismiss"
                        onClick={() => setDismissed((prev) => new Set(prev).add(article.id))}
                      >
                        Not for me
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
