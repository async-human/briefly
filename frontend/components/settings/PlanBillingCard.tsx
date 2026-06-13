"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, type BillingStatus } from "@/lib/api";
import { PlanComparison, PlanUsageBar } from "@/components/billing/PlanComparison";
import { useUpgradeOptional } from "@/components/billing/UpgradeProvider";
import { FREE_DIGEST_ITEMS, FREE_HISTORY_DAYS } from "@/lib/plans";

type Props = {
  onUpgraded?: () => void;
};

export function PlanBillingCard({ onUpgraded }: Props) {
  const upgradeCtx = useUpgradeOptional();
  const [status, setStatus] = useState<BillingStatus | null>(
    upgradeCtx?.billing ?? null,
  );
  const [loading, setLoading] = useState(!upgradeCtx?.billing);
  const [busy, setBusy] = useState<"monthly" | "yearly" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = upgradeCtx
        ? await upgradeCtx.refreshBilling()
        : await api.getBillingStatus();
      if (next) setStatus(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load billing status");
      return null;
    } finally {
      setLoading(false);
    }
  }, [upgradeCtx]);

  useEffect(() => {
    if (upgradeCtx?.billing) {
      setStatus(upgradeCtx.billing);
      setLoading(false);
    } else {
      void refresh();
    }
  }, [upgradeCtx?.billing, refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    window.history.replaceState({}, "", "/settings#plan");
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
  const usage = status?.usage;

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
          {usage && usage.sources_used > 0 && (
            <p className="settings-billing-meta">
              {usage.sources_used} source{usage.sources_used === 1 ? "" : "s"} connected
            </p>
          )}
        </div>
      ) : (
        <div className="settings-billing-free">
          <div className="settings-billing-current">
            <span className="settings-billing-badge settings-billing-badge-free">Free</span>
            <span className="settings-billing-current-label">Current plan</span>
          </div>

          {usage?.sources_limit != null && (
            <PlanUsageBar
              used={usage.sources_used}
              limit={usage.sources_limit}
              label="Source connections"
            />
          )}

          {usage?.free_limits_reached && (
            <div className="settings-billing-limit-alert" role="alert">
              <strong>Free tier limit reached.</strong> You&apos;ve used all{" "}
              {usage.sources_limit} source slots. Upgrade to Pro to add more sources and unlock
              brain dump, full briefings, and Ask Briefly.
            </div>
          )}

          <p className="settings-billing-free-summary">
            Your free plan includes {usage?.sources_limit ?? 3} sources, {FREE_DIGEST_ITEMS}{" "}
            items per briefing, and {FREE_HISTORY_DAYS}-day history.
          </p>

          <PlanComparison variant="settings" highlight="free" />

          <div className="settings-billing-actions">
            <button
              type="button"
              className="btn-primary settings-billing-btn"
              disabled={busy !== null}
              onClick={() => void startCheckout("monthly")}
            >
              {busy === "monthly" ? "Redirecting to checkout…" : "Upgrade — $9/month"}
            </button>
            <button
              type="button"
              className="settings-billing-btn settings-billing-btn-secondary"
              disabled={busy !== null}
              onClick={() => void startCheckout("yearly")}
            >
              {busy === "yearly" ? "Redirecting…" : "$90/year · save 17%"}
            </button>
            <Link href="/upgrade" className="settings-billing-link">
              Full plan comparison
            </Link>
          </div>
          <p className="settings-billing-footnote">
            Secure checkout via Dodo Payments. Cancel anytime.
          </p>
        </div>
      )}
    </div>
  );
}
