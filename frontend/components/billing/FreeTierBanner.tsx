"use client";

import Link from "next/link";
import { useUpgrade } from "@/components/billing/UpgradeProvider";

export function FreeTierBanner() {
  const { billing, billingLoading, openUpgrade } = useUpgrade();

  if (billingLoading || !billing || billing.is_pro) return null;
  if (!billing.usage.free_limits_reached) return null;

  return (
    <div className="free-tier-banner" role="status">
      <div className="free-tier-banner-inner">
        <p className="free-tier-banner-text">
          <strong>Free plan limit reached</strong>
          {" — "}
          you&apos;ve used all {billing.usage.sources_limit} source slots. Upgrade to Pro for
          unlimited sources, brain dump, and full briefings.
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
    </div>
  );
}
