"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type OnboardingStatus, type Source } from "@/lib/api";
import { SourceIcon } from "@/components/SourceIcon";
import { AddSourceForm } from "@/components/dashboard/AddSourceForm";
import { sourceDisplayName } from "@/components/dashboard/sourceLabels";
import { GmailConsentModal } from "@/components/privacy/GmailConsentModal";

const OAUTH_TYPES = new Set(["gmail", "youtube", "youtube_account", "reddit", "reddit_account"]);
const MANUAL_TYPES = new Set(["rss", "url", "email", "readwise"]);

type ConnectorId = "gmail" | "youtube" | "reddit" | "calendar";

type ConnectorDef = {
  id: ConnectorId;
  name: string;
  description: string;
  iconType: string;
};

const CONNECTORS: ConnectorDef[] = [
  {
    id: "gmail",
    name: "Gmail",
    description: "Newsletters from your inbox — never personal mail",
    iconType: "gmail",
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Videos from channels you subscribe to",
    iconType: "youtube",
  },
  {
    id: "reddit",
    name: "Reddit",
    description: "Posts from subreddits you follow",
    iconType: "reddit",
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Meeting-aware briefings — relevant stories before your meetings",
    iconType: "url",
  },
];

function isConnected(id: ConnectorId, status: OnboardingStatus | null): boolean {
  if (!status) return false;
  if (id === "gmail") return status.gmail_connected;
  if (id === "youtube") return status.youtube_connected;
  if (id === "calendar") return status.calendar_connected;
  return status.reddit_connected;
}

function connectorMeta(id: ConnectorId, status: OnboardingStatus | null): string | null {
  if (!status) return null;
  if (id === "gmail") {
    if (!status.gmail_connected) return null;
    const parts: string[] = [];
    if (status.gmail_email) parts.push(status.gmail_email);
    if (status.newsletter_count != null) parts.push(`${status.newsletter_count}+ newsletters`);
    return parts.join(" · ") || "Connected";
  }
  if (id === "youtube") {
    if (!status.youtube_connected) return null;
    if (status.youtube_channel_count != null && status.youtube_channel_count > 0) {
      return `${status.youtube_channel_count} channel${status.youtube_channel_count === 1 ? "" : "s"}`;
    }
    return "Connected — subscriptions may be private";
  }
  if (id === "calendar") {
    if (!status.calendar_connected) return null;
    return status.calendar_email ? `${status.calendar_email} · read-only` : "Connected — read-only";
  }
  if (!status.reddit_connected) return null;
  if (status.reddit_subreddit_count != null) {
    return `${status.reddit_subreddit_count} subreddit${status.reddit_subreddit_count === 1 ? "" : "s"}`;
  }
  return "Connected";
}

function manualSources(sources: Source[]): Source[] {
  return sources.filter((s) => MANUAL_TYPES.has(s.source_type) && !OAUTH_TYPES.has(s.source_type));
}

export function AccountConnections({ ingestionEmail }: { ingestionEmail?: string }) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<ConnectorId | "remove" | null>(null);
  const [gmailConsentOpen, setGmailConsentOpen] = useState(false);
  const [gmailDisconnectOpen, setGmailDisconnectOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [nextStatus, nextSources] = await Promise.all([
      api.getOnboardingStatus(),
      api.getSources(),
    ]);
    setStatus(nextStatus);
    setSources(nextSources);
    return { nextStatus, nextSources };
  }, []);

  useEffect(() => {
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load connections"))
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    const youtube = params.get("youtube");
    const reddit = params.get("reddit");
    const calendar = params.get("calendar");
    if (!gmail && !youtube && !reddit && !calendar) return;

    window.history.replaceState({}, "", "/settings");

    if (gmail === "connected") {
      setBanner("Gmail connected successfully.");
      void refresh();
    } else if (gmail === "denied") {
      setError("Gmail access was denied. Try again and approve all permissions.");
    } else if (gmail === "error") {
      setError("Gmail connection was cancelled or failed.");
    }

    if (youtube === "connected") {
      const channels = params.get("channels");
      setBanner(
        channels ? `YouTube connected — ${channels} subscribed channels found.` : "YouTube connected successfully.",
      );
      void refresh();
    } else if (youtube === "denied") {
      setError("YouTube access was denied.");
    } else if (youtube === "error") {
      setError("YouTube connection failed.");
    }

    if (reddit === "connected") {
      const subs = params.get("subreddits");
      setBanner(
        subs ? `Reddit connected — ${subs} subreddits found.` : "Reddit connected successfully.",
      );
      void refresh();
    } else if (reddit === "denied") {
      setError("Reddit access was denied.");
    } else if (reddit === "error") {
      setError("Reddit connection failed.");
    }

    if (calendar === "connected") {
      setBanner("Google Calendar connected — meeting-aware briefings enabled.");
      void refresh();
    } else if (calendar === "denied") {
      setError("Calendar access was denied.");
    } else if (calendar === "error") {
      setError("Calendar connection failed.");
    }
  }, [refresh]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(""), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 6000);
    return () => clearTimeout(t);
  }, [error]);

  function handleConnect(id: ConnectorId) {
    if (id === "gmail") {
      setGmailConsentOpen(true);
      return;
    }
    void startOAuthConnect(id);
  }

  async function startOAuthConnect(id: ConnectorId) {
    setBusy(id);
    setError("");
    try {
      const start =
        id === "gmail"
          ? api.startGmailConnect
          : id === "youtube"
            ? api.startYouTubeConnect
            : id === "calendar"
              ? api.startCalendarConnect
              : api.startRedditConnect;
      const { url } = await start("/settings");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not connect ${id}`);
      setBusy(null);
    }
  }

  function handleDisconnect(id: ConnectorId) {
    if (id === "gmail") {
      setGmailDisconnectOpen(true);
      return;
    }
    void confirmDisconnect(id);
  }

  async function confirmDisconnect(id: ConnectorId, deleteGmailContent = true) {
    setBusy(id);
    setError("");
    try {
      if (id === "gmail") {
        const res = await api.disconnectGmail(deleteGmailContent);
        setBanner(
          res.removed_content_items > 0
            ? `Gmail disconnected. Removed ${res.removed_sources} source(s) and ${res.removed_content_items} stored newsletter(s).`
            : "Gmail disconnected. Google access revoked.",
        );
        setGmailDisconnectOpen(false);
      } else if (id === "youtube") await api.disconnectYouTube();
      else if (id === "calendar") await api.disconnectCalendar();
      else await api.disconnectReddit();
      if (id !== "gmail") {
        setBanner(`${CONNECTORS.find((c) => c.id === id)?.name ?? "Account"} disconnected.`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveSource(id: string) {
    setBusy("remove");
    setError("");
    try {
      await api.deleteSource(id);
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove source");
    } finally {
      setBusy(null);
    }
  }

  const feeds = manualSources(sources);
  const connectedCount = CONNECTORS.filter((c) => isConnected(c.id, status)).length;

  return (
    <div className="settings-connections">
      <GmailConsentModal
        open={gmailConsentOpen}
        onCancel={() => setGmailConsentOpen(false)}
        onConfirm={() => {
          setGmailConsentOpen(false);
          void startOAuthConnect("gmail");
        }}
        confirming={busy === "gmail"}
        ingestionEmail={ingestionEmail}
      />

      {gmailDisconnectOpen && (
        <div className="privacy-modal-backdrop" role="presentation" onClick={() => setGmailDisconnectOpen(false)}>
          <div
            className="privacy-modal privacy-modal-sm"
            role="dialog"
            aria-labelledby="gmail-disconnect-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="gmail-disconnect-title" className="privacy-modal-title">
              Disconnect Gmail?
            </h2>
            <p className="privacy-modal-lead">
              This revokes Briefly&apos;s Google access. We will also delete Gmail-derived newsletter
              sources and any newsletter bodies fetched from your inbox via Gmail.
            </p>
            <p className="privacy-modal-foot">
              Forwarded mail to your Briefly address is kept.{" "}
              <Link href="/privacy/data-handling" className="privacy-modal-link" target="_blank">
                Learn more
              </Link>
            </p>
            <div className="privacy-modal-actions">
              <button
                type="button"
                className="privacy-modal-btn privacy-modal-btn-ghost"
                onClick={() => setGmailDisconnectOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="privacy-modal-btn privacy-modal-btn-danger"
                disabled={busy === "gmail"}
                onClick={() => void confirmDisconnect("gmail", true)}
              >
                {busy === "gmail" ? "Disconnecting…" : "Disconnect & delete content"}
              </button>
            </div>
          </div>
        </div>
      )}

      {banner && <div className="settings-connections-banner">{banner}</div>}
      {error && <div className="settings-connections-error" role="alert">{error}</div>}

      {loading ? (
        <p className="settings-connections-loading">Loading connections…</p>
      ) : (
        <>
          <div className="settings-connections-summary">
            <span className="settings-connections-count">
              {connectedCount} account{connectedCount === 1 ? "" : "s"} linked
            </span>
            {feeds.length > 0 && (
              <span className="settings-connections-count">
                · {feeds.length} feed{feeds.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <ul className="settings-connector-list">
            {CONNECTORS.map((connector) => {
              const connected = isConnected(connector.id, status);
              const meta = connectorMeta(connector.id, status);
              const isBusy = busy === connector.id;

              return (
                <li
                  key={connector.id}
                  className={`settings-connector-card${connected ? " is-connected" : ""}`}
                >
                  <div className="settings-connector-icon">
                    {connector.id === "calendar" ? (
                      <span className="settings-connector-cal-icon" aria-hidden>
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                          <rect x="3" y="5" width="18" height="16" rx="2" />
                          <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
                        </svg>
                      </span>
                    ) : (
                      <SourceIcon type={connector.iconType} size={26} />
                    )}
                  </div>
                  <div className="settings-connector-body">
                    <div className="settings-connector-head">
                      <span className="settings-connector-name">{connector.name}</span>
                      {connected && <span className="settings-connector-badge">Connected</span>}
                    </div>
                    <p className="settings-connector-desc">
                      {connected && meta ? meta : connector.description}
                    </p>
                  </div>
                  <div className="settings-connector-action">
                    {connected ? (
                      <button
                        type="button"
                        className="settings-connector-btn settings-connector-btn-ghost"
                        onClick={() => void handleDisconnect(connector.id)}
                        disabled={isBusy}
                      >
                        {isBusy ? "…" : "Disconnect"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="settings-connector-btn settings-connector-btn-primary"
                        onClick={() => void handleConnect(connector.id)}
                        disabled={isBusy}
                      >
                        {isBusy ? "Redirecting…" : "Connect"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="settings-feeds-section">
            <div className="settings-feeds-head">
              <h3 className="settings-feeds-title">Feeds & URLs</h3>
              <p className="settings-feeds-desc">
                Blogs, RSS, news sites, or any link Briefly can fetch.
              </p>
            </div>

            {feeds.length > 0 ? (
              <ul className="settings-feed-list">
                {feeds.map((source) => (
                  <li key={source.id} className="settings-feed-item">
                    <span className="settings-feed-icon">
                      <SourceIcon
                        type={source.source_type}
                        name={source.name ?? undefined}
                        url={source.identifier?.startsWith("http") ? source.identifier : undefined}
                        size={18}
                      />
                    </span>
                    <div className="settings-feed-info">
                      <span className="settings-feed-name">{sourceDisplayName(source)}</span>
                      {source.identifier?.startsWith("http") && (
                        <span className="settings-feed-url">{source.identifier}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="settings-feed-remove"
                      onClick={() => void handleRemoveSource(source.id)}
                      disabled={busy === "remove"}
                      aria-label={`Remove ${sourceDisplayName(source)}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="settings-feeds-empty">No custom feeds yet — add one below.</p>
            )}

            <div className="settings-feed-add">
              <AddSourceForm
                onAdded={(source) => {
                  setSources((prev) => [...prev, source]);
                  setBanner(`${sourceDisplayName(source)} added.`);
                }}
              />
            </div>
          </div>

          {ingestionEmail && (
            <p className="settings-connections-footnote">
              Forward newsletters to{" "}
              <code className="settings-ingestion-email">{ingestionEmail}</code> — they&apos;ll
              appear in your briefings automatically.{" "}
              <Link href="/privacy/data-handling" className="settings-connections-link">
                How we handle email
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
