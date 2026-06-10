"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type DiscoveredArticle, type Source } from "@/lib/api";
import { SourceIcon } from "@/components/SourceIcon";

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

export function DiscoverContentPanel({ onSourceAdded }: DiscoverContentPanelProps) {
  const [articles, setArticles] = useState<DiscoveredArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingFeed, setAddingFeed] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setError(null);
    try {
      const res = force
        ? await api.refreshDiscoveredArticles()
        : await api.getDiscoveredArticles();
      setArticles(res.articles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load discoveries");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
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
    } catch {
      setError("Could not add this source.");
    } finally {
      setAddingFeed(null);
    }
  }

  const visible = articles.filter((a) => !dismissed.has(a.id));

  if (loading) {
    return (
      <div className="discover-content-panel discover-content-loading">
        <div className="discover-content-spinner" aria-hidden />
        <p>Finding relevant content outside your subscriptions…</p>
      </div>
    );
  }

  if (!visible.length && !error) {
    return null;
  }

  return (
    <section className="discover-content-panel" aria-labelledby="discover-content-title">
      <header className="discover-content-head">
        <div>
          <h2 id="discover-content-title" className="discover-content-title">
            Worth discovering
          </h2>
          <p className="discover-content-desc">
            Fresh, highly relevant articles from sources you haven&apos;t subscribed to — picked from
            your interests and reading behavior.
          </p>
        </div>
        <button
          type="button"
          className="discover-content-refresh"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
        >
          {refreshing ? "Scanning…" : "Refresh"}
        </button>
      </header>

      {error && <p className="form-error discover-content-error">{error}</p>}

      <ul className="discover-content-list">
        {visible.map((article) => {
          const scorePct = Math.round((article.relevance_score || 0) * 100);
          const reasonLabel = REASON_LABELS[article.discovery_reason] || "Relevant";
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
                <SourceIcon type={article.source_type} size={14} />
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
    </section>
  );
}
