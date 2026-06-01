"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type DiscoveryCandidate, type DiscoveryMeta, type DiscoveryProgress, type Source } from "@/lib/api";
import { AddSourceForm } from "./AddSourceForm";
import { DiscoveryScanning } from "./DiscoveryScanning";
import { SourceIcon } from "@/components/SourceIcon";

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
  connectBanner?: string | null;
  onConfirmed: (sources: Source[]) => void;
  onSourceAdded: (source: Source) => void;
};

export function SourceDiscoveryWizard({
  existingSources,
  gmailConnected,
  connectBanner,
  onConfirmed,
  onSourceAdded,
}: SourceDiscoveryWizardProps) {
  const [phase, setPhase] = useState<"scanning" | "review" | "confirming">("scanning");
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connectedAccounts, setConnectedAccounts] = useState<string[]>([]);
  const [scanMeta, setScanMeta] = useState<DiscoveryMeta>({});
  const [error, setError] = useState("");
  const [gmailLoading, setGmailLoading] = useState(false);
  const [scanProgress, setScanProgress] = useState<DiscoveryProgress | null>(null);
  const prevGmailRef = useRef(gmailConnected);

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
    }
  }, [pollDiscovery]);

  useEffect(() => {
    void runDiscovery();
  }, [runDiscovery]);

  useEffect(() => {
    if (gmailConnected && !prevGmailRef.current) {
      void runDiscovery();
    }
    prevGmailRef.current = gmailConnected;
  }, [gmailConnected, runDiscovery]);

  async function handleConnectGmail() {
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

  const canConfirm =
    selected.size > 0 ||
    existingSources.length > 0;

  return (
    <div className="discovery-wizard">
      <div className="discovery-wizard-inner">
        <header className="discovery-wizard-head">
          <p className="dash-card-label">Before your first briefing</p>
          <h1 className="discovery-wizard-title">Review your sources</h1>
          <p className="discovery-wizard-desc">
            {gmailConnected
              ? "We scanned your Gmail inbox for newsletters you actually receive. Every source below was found in your email — not guessed from your profile keywords."
              : "We scanned your connected accounts for sources you follow. Confirm what to include — nothing is added without your approval."}
          </p>
          {scanMeta?.gmail_messages_scanned != null && gmailConnected && !scanMeta.gmail_scan_error && (
            <p className="discovery-connected">
              Scanned {scanMeta.gmail_messages_scanned} emails · found {scanMeta.gmail_senders_found ?? 0} newsletter senders
            </p>
          )}
          {connectedAccounts.length > 0 && (
            <p className="discovery-connected">
              Connected: {connectedAccounts.join(" · ")}
            </p>
          )}
        </header>

        {connectBanner && !scanMeta.gmail_scan_error && (
          <div className="discovery-connect-banner">{connectBanner}</div>
        )}

        {gmailConnected && scanMeta.gmail_scan_error && (
          <div className="discovery-gmail-error">
            <div className="discovery-gmail-error-icon">
              <SourceIcon type="gmail" size={22} />
            </div>
            <div className="discovery-gmail-error-body">
              <p className="discovery-gmail-error-title">Couldn&apos;t read your Gmail inbox</p>
              <p className="discovery-gmail-error-desc">
                {scanMeta.gmail_scan_error_message ||
                  "Google blocked inbox access. Reconnect and approve read access to scan newsletters."}
              </p>
              <button
                type="button"
                className="discovery-gmail-error-btn"
                onClick={() => void handleConnectGmail()}
                disabled={gmailLoading || phase === "confirming"}
              >
                {gmailLoading ? (
                  <>
                    <span className="btn-spinner btn-spinner-dark" />
                    Redirecting to Google…
                  </>
                ) : (
                  <>
                    <SourceIcon type="gmail" size={16} />
                    Reconnect Gmail
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {!gmailConnected && (
          <div className="discovery-gmail-callout">
            <div className="discovery-gmail-callout-icon">
              <SourceIcon type="gmail" size={22} />
            </div>
            <div className="discovery-gmail-callout-body">
              <p className="discovery-gmail-callout-title">Connect Gmail for richer discovery</p>
              <p className="discovery-gmail-callout-desc">
                We scan newsletter senders from your inbox — Substack, Beehiiv, and more — so your
                briefing reflects what you actually read, not just keyword guesses.
              </p>
              <button
                type="button"
                className="discovery-gmail-callout-btn"
                onClick={() => void handleConnectGmail()}
                disabled={gmailLoading || phase === "confirming"}
              >
                {gmailLoading ? (
                  <>
                    <span className="btn-spinner btn-spinner-dark" />
                    Redirecting to Google…
                  </>
                ) : (
                  <>
                    <SourceIcon type="gmail" size={16} />
                    Connect Gmail
                  </>
                )}
              </button>
              <p className="discovery-gmail-callout-hint">
                Read-only access to newsletter metadata — never your personal mail.
              </p>
            </div>
          </div>
        )}

        {phase === "scanning" && (
          <DiscoveryScanning progress={scanProgress} gmailConnected={gmailConnected} />
        )}

        {phase !== "scanning" && (
          <>
            {existingSources.length > 0 && (
              <section className="discovery-section">
                <h2 className="discovery-section-title">Already connected</h2>
                <ul className="discovery-existing-list">
                  {existingSources.map((s) => (
                    <li key={s.id} className="discovery-existing-item">
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
                <section key={layer} className="discovery-section">
                  <h2 className="discovery-section-title">{LAYER_LABELS[layer]}</h2>
                  <ul className="discovery-candidate-list">
                    {items.map((c) => (
                      <li key={c.id}>
                        <label className="discovery-candidate-row">
                          <input
                            type="checkbox"
                            checked={selected.has(c.id)}
                            onChange={() => toggle(c.id)}
                          />
                          <div className="discovery-candidate-body">
                            <div className="discovery-candidate-top">
                              <span className="discovery-candidate-name">{c.name}</span>
                              <span className="discovery-score">
                                {Math.round(c.relevance_score * 100)}% match
                              </span>
                            </div>
                            <p className="discovery-candidate-reason">{c.reason}</p>
                            <p className="discovery-candidate-id">{c.identifier}</p>
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}

            {candidates.length === 0 && !error && (
              <p className="discovery-empty">
                {gmailConnected
                  ? "No newsletters were detected in your Gmail yet. Try forwarding a few to your ingestion address, or add a feed manually below."
                  : "No sources discovered automatically. Connect Gmail for the richest scan, or add feeds manually below."}
              </p>
            )}

            <section className="discovery-section">
              <h2 className="discovery-section-title">Add anything we missed</h2>
              <AddSourceForm onAdded={onSourceAdded} />
            </section>

            {error && <p className="form-error">{error}</p>}

            <div className="discovery-actions">
              <button
                type="button"
                className="btn-primary discovery-confirm-btn"
                disabled={!canConfirm || phase === "confirming"}
                onClick={handleConfirm}
              >
                {phase === "confirming"
                  ? "Setting up your briefing…"
                  : `Confirm ${selected.size} source${selected.size === 1 ? "" : "s"} & generate briefing`}
              </button>
              <button
                type="button"
                className="onboard-ghost"
                disabled={phase === "confirming"}
                onClick={() => void runDiscovery()}
              >
                Re-scan
              </button>
              <button
                type="button"
                className="onboard-ghost"
                disabled={phase === "confirming"}
                onClick={async () => {
                  await api.resetSourceDiscovery();
                  await runDiscovery();
                }}
              >
                Full refresh
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
