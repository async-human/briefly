"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type DiscoveryCandidate, type Source } from "@/lib/api";
import { AddSourceForm } from "./AddSourceForm";
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
  onConfirmed: (sources: Source[]) => void;
  onSourceAdded: (source: Source) => void;
};

export function SourceDiscoveryWizard({
  existingSources,
  gmailConnected,
  onConfirmed,
  onSourceAdded,
}: SourceDiscoveryWizardProps) {
  const [phase, setPhase] = useState<"scanning" | "review" | "confirming">("scanning");
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connectedAccounts, setConnectedAccounts] = useState<string[]>([]);
  const [scanMeta, setScanMeta] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");

  const runDiscovery = useCallback(async () => {
    setPhase("scanning");
    setError("");
    try {
      const result = await api.runSourceDiscovery();
      setCandidates(result.candidates);
      setConnectedAccounts(result.connected_accounts);
      setScanMeta(result.meta ?? {});
      setSelected(new Set(result.candidates.filter((c) => c.selected).map((c) => c.id)));
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
      setPhase("review");
    }
  }, []);

  useEffect(() => {
    void runDiscovery();
  }, [runDiscovery]);

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
          {scanMeta?.gmail_messages_scanned != null && gmailConnected && (
            <p className="discovery-connected">
              Scanned {scanMeta.gmail_messages_scanned} emails · found {scanMeta.gmail_senders_found ?? 0} newsletter senders
            </p>
          )}
          {connectedAccounts.length > 0 && (
            <p className="discovery-connected">
              Connected: {connectedAccounts.join(" · ")}
              {!gmailConnected && " · Add Gmail for richer discovery"}
            </p>
          )}
        </header>

        {phase === "scanning" && (
          <div className="discovery-scanning">
            <span className="btn-spinner" />
            <p>Scanning inbox metadata and matching to your profile…</p>
          </div>
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
