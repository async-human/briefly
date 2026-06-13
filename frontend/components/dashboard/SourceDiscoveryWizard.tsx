"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type DiscoveryCandidate, type DiscoveryMeta, type DiscoveryProgress, type Source } from "@/lib/api";
import { AddSourceForm } from "./AddSourceForm";
import { DiscoveryScanning } from "./DiscoveryScanning";
import { SourceIcon } from "@/components/SourceIcon";
import { GmailConsentModal } from "@/components/privacy/GmailConsentModal";

const LAYER_LABELS: Record<string, string> = {
  inbound_footprint: "Newsletters you subscribe to",
  deep_link: "Articles linked in your digests",
  youtube_subscription: "Your YouTube subscriptions",
  reddit_subscription: "Your Reddit subscriptions",
  interest_feed: "Live feeds for your interests",
};

const LAYER_ORDER = [
  "inbound_footprint",
  "deep_link",
  "youtube_subscription",
  "reddit_subscription",
];

type SourceDiscoveryWizardProps = {
  existingSources: Source[];
  gmailConnected: boolean;
  youtubeConnected?: boolean;
  redditConnected?: boolean;
  connectBanner?: string | null;
  ingestionEmail?: string;
  onConfirmed: (sources: Source[]) => void;
  onSourceAdded: (source: Source) => void;
};

function shouldAutoDiscover(
  gmailConnected: boolean,
  youtubeConnected: boolean,
  redditConnected: boolean,
  existingSources: Source[],
): boolean {
  return (
    gmailConnected ||
    youtubeConnected ||
    redditConnected ||
    existingSources.length > 0
  );
}

export function SourceDiscoveryWizard({
  existingSources,
  gmailConnected,
  youtubeConnected = false,
  redditConnected = false,
  connectBanner,
  ingestionEmail,
  onConfirmed,
  onSourceAdded,
}: SourceDiscoveryWizardProps) {
  const [phase, setPhase] = useState<"scanning" | "review" | "confirming">("review");
  const [hasScanned, setHasScanned] = useState(false);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connectedAccounts, setConnectedAccounts] = useState<string[]>([]);
  const [scanMeta, setScanMeta] = useState<DiscoveryMeta>({});
  const [error, setError] = useState("");
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailConsentOpen, setGmailConsentOpen] = useState(false);
  const [scanProgress, setScanProgress] = useState<DiscoveryProgress | null>(null);
  const prevGmailRef = useRef(gmailConnected);
  const initialScanStarted = useRef(false);

  const pollDiscovery = useCallback(async () => {
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => setTimeout(r, 700));
      const status = await api.getDiscoveryStatus();
      if (status.meta?.progress) {
        setScanProgress(status.meta.progress);
      }
      const ps = status.meta?.progress?.status;
      if (ps === "complete" || ps === "error") {
        return status;
      }
      if (status.candidates.length > 0 && ps !== "running") {
        return status;
      }
    }
    throw new Error("Discovery timed out. Try Re-scan.");
  }, []);

  const runDiscovery = useCallback(async () => {
    setPhase("scanning");
    setScanProgress({ status: "running", step: "start", label: "Starting discovery…" });
    setError("");
    try {
      await api.runSourceDiscovery();
      const status = await pollDiscovery();
      if (status.meta?.progress?.status === "error") {
        setError(status.meta.progress.label || "Discovery failed");
      }
      setCandidates(status.candidates);
      setConnectedAccounts(status.meta?.connected_accounts ?? []);
      setScanMeta(status.meta ?? {});
      setSelected(new Set(status.candidates.filter((c) => c.selected).map((c) => c.id)));
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
      setPhase("review");
    } finally {
      setScanProgress(null);
      setHasScanned(true);
    }
  }, [pollDiscovery]);

  useEffect(() => {
    if (initialScanStarted.current) return;
    initialScanStarted.current = true;
    if (shouldAutoDiscover(gmailConnected, youtubeConnected, redditConnected, existingSources)) {
      void runDiscovery();
    }
  }, [gmailConnected, youtubeConnected, redditConnected, existingSources, runDiscovery]);

  useEffect(() => {
    if (gmailConnected && !prevGmailRef.current) {
      void runDiscovery();
    }
    prevGmailRef.current = gmailConnected;
  }, [gmailConnected, runDiscovery]);

  function handleConnectGmail() {
    setGmailConsentOpen(true);
  }

  async function startGmailOAuth() {
    setGmailLoading(true);
    setError("");
    try {
      const { url } = await api.startGmailConnect("/dashboard");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Gmail connection");
      setGmailLoading(false);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, DiscoveryCandidate[]>();
    for (const layer of LAYER_ORDER) {
      map.set(layer, []);
    }
    for (const c of candidates) {
      const list = map.get(c.layer) ?? [];
      list.push(c);
      map.set(c.layer, list);
    }
    return map;
  }, [candidates]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    setPhase("confirming");
    setError("");
    try {
      const result = await api.confirmSourceDiscovery(Array.from(selected));
      onConfirmed(result.added);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm sources");
      setPhase("review");
    }
  }

  const totalSelected = selected.size + existingSources.length;
  const canConfirm = selected.size > 0 || existingSources.length > 0;
  const reviewReady = phase !== "scanning";
  const onReviewStep = hasScanned || existingSources.length > 0 || candidates.length > 0;
  const showEmptyResults = hasScanned && candidates.length === 0 && !error;

  return (
    <div className="discovery-wizard-page">
      <GmailConsentModal
        open={gmailConsentOpen}
        onCancel={() => setGmailConsentOpen(false)}
        onConfirm={() => {
          setGmailConsentOpen(false);
          void startGmailOAuth();
        }}
        confirming={gmailLoading}
        ingestionEmail={ingestionEmail}
      />

      <div className="discovery-wizard-layout">
        <header className="discovery-wizard-hero">
          <ol className="discovery-wizard-steps" aria-label="Setup progress">
            <li className={gmailConnected ? "discovery-wizard-step discovery-wizard-step--done" : "discovery-wizard-step discovery-wizard-step--active"}>
              Connect
            </li>
            <li
              className={
                onReviewStep
                  ? "discovery-wizard-step discovery-wizard-step--active"
                  : "discovery-wizard-step"
              }
            >
              Review
            </li>
            <li className="discovery-wizard-step">First brief</li>
          </ol>

          <p className="discovery-wizard-eyebrow">Get your first brief</p>
          <h1 className="discovery-wizard-title">Connect your inbox</h1>
          <p className="discovery-wizard-lead">
            {gmailConnected
              ? "Briefly reads the newsletters you already receive — confirm what to include and we'll deliver your first brief."
              : "Link Gmail so Briefly can learn what you follow, or add sources manually below."}
          </p>

          {scanMeta?.gmail_messages_scanned != null && gmailConnected && !scanMeta.gmail_scan_error && (
            <p className="discovery-wizard-meta">
              Scanned {scanMeta.gmail_messages_scanned} emails · found{" "}
              {scanMeta.gmail_senders_found ?? 0} newsletter senders
            </p>
          )}
          {connectedAccounts.length > 0 && (
            <p className="discovery-wizard-meta">
              Connected: {connectedAccounts.join(" · ")}
            </p>
          )}
        </header>

        {connectBanner && !scanMeta.gmail_scan_error && (
          <div className="discovery-wizard-banner" role="status">
            {connectBanner}
          </div>
        )}

        <div className="discovery-wizard-main">
          {gmailConnected && scanMeta.gmail_scan_error && (
            <div className="discovery-integration discovery-integration--error">
              <div className="discovery-integration-icon" aria-hidden>
                <SourceIcon type="gmail" size={22} />
              </div>
              <div className="discovery-integration-body">
                <p className="discovery-integration-title">Couldn&apos;t read your Gmail inbox</p>
                <p className="discovery-integration-desc">
                  {scanMeta.gmail_scan_error_message ||
                    "Google blocked inbox access. Reconnect and approve read access to scan newsletters."}
                </p>
              </div>
              <button
                type="button"
                className="discovery-integration-action"
                onClick={() => void handleConnectGmail()}
                disabled={gmailLoading || phase === "confirming"}
              >
                {gmailLoading ? (
                  <>
                    <span className="btn-spinner btn-spinner-dark" />
                    Redirecting…
                  </>
                ) : (
                  "Reconnect Gmail"
                )}
              </button>
            </div>
          )}

          {!gmailConnected && (
            <div className="discovery-integration">
              <div className="discovery-integration-icon" aria-hidden>
                <SourceIcon type="gmail" size={22} />
              </div>
              <div className="discovery-integration-body">
                <p className="discovery-integration-title">Connect Gmail for richer discovery</p>
                <p className="discovery-integration-desc">
                  We scan newsletter senders from your inbox — Substack, Beehiiv, and more — so your
                  briefing reflects what you actually read.
                </p>
                <p className="discovery-integration-note">
                  Read-only access to newsletter metadata — never your personal mail.
                </p>
              </div>
              <button
                type="button"
                className="discovery-integration-action discovery-integration-action--primary"
                onClick={() => void handleConnectGmail()}
                disabled={gmailLoading || phase === "confirming"}
              >
                {gmailLoading ? (
                  <>
                    <span className="btn-spinner btn-spinner-light" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    <SourceIcon type="gmail" size={16} />
                    Connect Gmail
                  </>
                )}
              </button>
            </div>
          )}

          {phase === "scanning" && (
            <DiscoveryScanning progress={scanProgress} gmailConnected={gmailConnected} />
          )}

          {reviewReady && (
            <div className="discovery-wizard-review">
              {existingSources.length > 0 && (
                <section className="discovery-block">
                  <h2 className="discovery-block-title">Already connected</h2>
                  <ul className="discovery-chip-list">
                    {existingSources.map((s) => (
                      <li key={s.id} className="discovery-chip">
                        <SourceIcon type={s.source_type} name={s.name ?? undefined} size={16} />
                        <span>{s.name || s.identifier}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {LAYER_ORDER.map((layer) => {
                const items = grouped.get(layer) ?? [];
                if (items.length === 0) return null;
                return (
                  <section key={layer} className="discovery-block">
                    <h2 className="discovery-block-title">{LAYER_LABELS[layer]}</h2>
                    <ul className="discovery-pick-list">
                      {items.map((c) => {
                        const checked = selected.has(c.id);
                        return (
                          <li key={c.id}>
                            <label
                              className={`discovery-pick${checked ? " discovery-pick--selected" : ""}`}
                            >
                              <input
                                type="checkbox"
                                className="discovery-pick-input"
                                checked={checked}
                                onChange={() => toggle(c.id)}
                              />
                              <span className="discovery-pick-check" aria-hidden>
                                {checked && (
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <path
                                      d="M2 6l2.5 2.5L10 3"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                )}
                              </span>
                              <span className="discovery-pick-content">
                                <span className="discovery-pick-top">
                                  <span className="discovery-pick-name">{c.name}</span>
                                  <span className="discovery-pick-score">
                                    {Math.round(c.relevance_score * 100)}% match
                                  </span>
                                </span>
                                <span className="discovery-pick-reason">{c.reason}</span>
                                <span className="discovery-pick-id">{c.identifier}</span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}

              {showEmptyResults && (
                <div className="discovery-empty-state">
                  <p className="discovery-empty-title">No sources found yet</p>
                  <p className="discovery-empty-desc">
                    {gmailConnected
                      ? "Try forwarding a newsletter to your ingestion address, or add a feed manually below."
                      : "Connect Gmail for the richest scan, or paste a URL below."}
                  </p>
                </div>
              )}

              <section className="discovery-block discovery-block--manual">
                <h2 className="discovery-block-title">
                  {hasScanned ? "Add manually" : "Or add a source by hand"}
                </h2>
                <p className="discovery-block-desc">
                  Paste a URL, YouTube channel, subreddit, or email address.
                </p>
                <AddSourceForm variant="inline" onAdded={onSourceAdded} />
              </section>

              {error && <p className="form-error discovery-wizard-error">{error}</p>}
            </div>
          )}
        </div>

        {reviewReady && (
          <footer className="discovery-wizard-footer">
            <div className="discovery-wizard-footer-inner">
              <button
                type="button"
                className="discovery-wizard-confirm"
                disabled={!canConfirm || phase === "confirming"}
                onClick={handleConfirm}
              >
                {phase === "confirming" ? "Setting up your briefing…" : "Generate my first brief"}
              </button>
              <p className="discovery-wizard-footer-status">
                {canConfirm ? (
                  <>
                    <strong>{totalSelected}</strong> source{totalSelected === 1 ? "" : "s"} ready
                  </>
                ) : (
                  "Connect Gmail or add a source to continue"
                )}
              </p>
              {hasScanned && (
                <div className="discovery-wizard-secondary">
                  <button
                    type="button"
                    className="discovery-wizard-link-btn"
                    disabled={phase === "confirming"}
                    onClick={() => void runDiscovery()}
                  >
                    Re-scan
                  </button>
                  <span className="discovery-wizard-link-sep" aria-hidden>
                    ·
                  </span>
                  <button
                    type="button"
                    className="discovery-wizard-link-btn"
                    disabled={phase === "confirming"}
                    onClick={async () => {
                      await api.resetSourceDiscovery();
                      await runDiscovery();
                    }}
                  >
                    Full refresh
                  </button>
                </div>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
