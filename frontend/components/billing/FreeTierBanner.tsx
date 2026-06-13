"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useUpgrade } from "@/components/billing/UpgradeProvider";
import type { BillingStatus } from "@/lib/api";

const DISMISS_KEY = "briefly_free_limit_banner_dismissed";

function bannerDismissToken(billing: BillingStatus): string {
  const u = billing.usage;
  return `${u.sources_used}:${u.sources_limit}:${u.free_limits_reached}`;
}

export function FreeTierBanner() {
  const { billing, billingLoading, openUpgrade } = useUpgrade();
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);

  useEffect(() => {
    setDismissedToken(localStorage.getItem(DISMISS_KEY));
  }, []);

  if (billingLoading || !billing || billing.is_pro) return null;
  if (!billing.usage.free_limits_reached) return null;

  const token = bannerDismissToken(billing);
  if (dismissedToken === token) return null;

  function handleDismiss() {
    localStorage.setItem(DISMISS_KEY, token);
    setDismissedToken(token);
  }

  return (
    <div className="free-tier-banner" role="status">
      <div className="free-tier-banner-inner">
        <p className="free-tier-banner-text">
          <strong>Free plan limit reached</strong>
          {" — "}
          you&apos;ve used all {billing.usage.sources_limit} connections. Remove one above or
          upgrade to Pro for unlimited connections, brain dump, and full briefings.
        </p>
        <div className="free-tier-banner-actions">
          <button
            type="button"
            className="btn-primary free-tier-banner-btn"
            onClick={() => openUpgrade({ reason: "sources_limit" })}
          >
            Upgrade to Pro
          </button>
          <Link href="/upgrade" className="free-tier-banner-link">
            Compare plans
          </Link>
        </div>
      </div>
      <button
        type="button"
        className="free-tier-banner-dismiss"
        aria-label="Dismiss banner"
        onClick={handleDismiss}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M3 3l8 8M11 3l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
