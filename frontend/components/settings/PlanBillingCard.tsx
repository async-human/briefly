"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type BillingStatus } from "@/lib/api";

type Props = {
  onUpgraded?: () => void;
};

export function PlanBillingCard({ onUpgraded }: Props) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"monthly" | "yearly" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await api.getBillingStatus();
      setStatus(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load billing status");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    window.history.replaceState({}, "", "/settings");
    setMessage("Payment received — unlocking Pro…");
    const poll = window.setInterval(() => {
      void refresh().then((next) => {
        if (next?.is_pro) {
          window.clearInterval(poll);
          setMessage("You're on Pro. Enjoy unlimited sources and brain dump.");
          onUpgraded?.();
        }
      });
    }, 2500);
    window.setTimeout(() => window.clearInterval(poll), 60000);
    return () => window.clearInterval(poll);
  }, [refresh, onUpgraded]);

  async function startCheckout(plan: "monthly" | "yearly") {
    setBusy(plan);
    setError("");
    try {
      const { checkout_url } = await api.createCheckout(plan);
      window.location.href = checkout_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setBusy(null);
    }
  }

  if (loading) {
    return <p className="settings-billing-loading">Loading plan…</p>;
  }

  const isPro = status?.is_pro;

  return (
    <div className="settings-billing" id="plan">
      {message && <p className="settings-billing-banner">{message}</p>}
      {error && <p className="settings-billing-error" role="alert">{error}</p>}

      {isPro ? (
        <div className="settings-billing-pro">
          <div className="settings-billing-pro-head">
            <span className="settings-billing-badge">Pro</span>
            {status?.is_founding_member ? (
              <span className="settings-billing-founding">Founding member · $9/mo locked</span>
            ) : (
              <span className="settings-billing-founding">Active subscription</span>
            )}
          </div>
          <p className="settings-billing-desc">
            Unlimited sources, brain dump, audio briefs, and full intelligence profile.
          </p>
        </div>
      ) : (
        <div className="settings-billing-free">
          <p className="settings-billing-desc">
            Upgrade to Pro for unlimited sources, brain dump, audio briefs, and deeper intelligence.
          </p>
          <div className="settings-billing-actions">
            <button
              type="button"
              className="btn-primary settings-billing-btn"
              disabled={busy !== null}
              onClick={() => void startCheckout("monthly")}
            >
              {busy === "monthly" ? "Redirecting…" : "Pro — $9/month"}
            </button>
            <button
              type="button"
              className="settings-billing-btn settings-billing-btn-secondary"
              disabled={busy !== null}
              onClick={() => void startCheckout("yearly")}
            >
              {busy === "yearly" ? "Redirecting…" : "Pro — $90/year"}
            </button>
          </div>
          <p className="settings-billing-footnote">
            Secure checkout via Dodo Payments. Cancel anytime.
          </p>
        </div>
      )}
    </div>
  );
}
