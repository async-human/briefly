"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PlanComparison } from "@/components/billing/PlanComparison";
import { AnimatedPageSkeleton } from "@/components/loading/AnimatedPageSkeleton";
import { AppPageHeader } from "@/components/dashboard/AppPageHeader";
import { PageContentTransition } from "@/components/loading/PageContentTransition";

export default function UpgradePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [busy, setBusy] = useState<"monthly" | "yearly" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [me, billing] = await Promise.all([api.getMe(), api.getBillingStatus()]);
    setUserName(me.user.name);
    setAvatarUrl(me.user.avatar_url);
    setIsPro(billing.is_pro);
    return billing;
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login?next=/upgrade");
      return;
    }
    void refresh()
      .catch(() => router.replace("/login?next=/upgrade"))
      .finally(() => setLoading(false));
  }, [router, refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    window.history.replaceState({}, "", "/upgrade");
    setMessage("Payment received — unlocking Pro…");
    const poll = window.setInterval(() => {
      void refresh().then((billing) => {
        if (billing?.is_pro) {
          window.clearInterval(poll);
          setMessage("Welcome to Pro! Redirecting to settings…");
          window.setTimeout(() => router.replace("/settings#plan"), 1500);
        }
      });
    }, 2500);
    window.setTimeout(() => window.clearInterval(poll), 60000);
    return () => window.clearInterval(poll);
  }, [refresh, router]);

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
    return (
      <DashboardShell userName={null} avatarUrl={null}>
        <AnimatedPageSkeleton variant="settings" />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell userName={userName} avatarUrl={avatarUrl}>
      <div className="dash-page dash-page-upgrade">
        <AppPageHeader
          eyebrow="Billing"
          title="Choose your plan"
          subtitle="Start free, upgrade when Briefly becomes indispensable."
        />

        <PageContentTransition>
          {message && <p className="upgrade-page-banner">{message}</p>}
          {error && (
            <p className="upgrade-page-error" role="alert">
              {error}
            </p>
          )}

          {isPro ? (
            <div className="upgrade-page-pro dash-surface">
              <span className="settings-billing-badge">Pro</span>
              <p className="upgrade-page-pro-text">
                Your subscription is active. Manage billing in{" "}
                <Link href="/settings#plan">Settings</Link>.
              </p>
            </div>
          ) : (
            <>
              <PlanComparison variant="page" highlight="pro" />

              <div className="upgrade-page-cta dash-surface">
                <p className="upgrade-page-cta-title">Ready to upgrade?</p>
                <p className="upgrade-page-cta-sub">
                  First 200 founding members lock in $9/mo forever. Cancel anytime.
                </p>
                <div className="upgrade-page-actions">
                  <button
                    type="button"
                    className="btn-primary upgrade-page-btn"
                    disabled={busy !== null}
                    onClick={() => void startCheckout("monthly")}
                  >
                    {busy === "monthly" ? "Redirecting to checkout…" : "Get Pro — $9/month"}
                  </button>
                  <button
                    type="button"
                    className="upgrade-page-btn-secondary"
                    disabled={busy !== null}
                    onClick={() => void startCheckout("yearly")}
                  >
                    {busy === "yearly" ? "Redirecting…" : "Get Pro — $90/year"}
                  </button>
                </div>
                <p className="upgrade-page-foot">
                  Secure checkout via Dodo Payments. Your data stays yours — export anytime.
                </p>
              </div>
            </>
          )}
        </PageContentTransition>
      </div>
    </DashboardShell>
  );
}
