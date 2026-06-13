"use client";

import Link from "next/link";
import { useUpgradeOptional } from "@/components/billing/UpgradeProvider";

export function SidebarPlanBadge() {
  const upgrade = useUpgradeOptional();
  const billing = upgrade?.billing;

  if (upgrade?.billingLoading || !billing) {
    return (
      <div className="app-sidebar-plan app-sidebar-plan--loading" aria-hidden>
        <span className="app-sidebar-plan-badge app-sidebar-plan-badge--free">Free</span>
      </div>
    );
  }

  if (billing.is_pro) {
    return (
      <div className="app-sidebar-plan">
        <div className="app-sidebar-plan-row">
          <span className="app-sidebar-plan-badge app-sidebar-plan-badge--pro">Pro</span>
          {billing.is_founding_member ? (
            <span className="app-sidebar-plan-detail">Founding member</span>
          ) : (
            <span className="app-sidebar-plan-detail">Unlimited</span>
          )}
        </div>
        <Link href="/settings#plan" className="app-sidebar-plan-link">
          Manage plan
        </Link>
      </div>
    );
  }

  const { sources_used, sources_limit, free_limits_reached } = billing.usage;

  return (
    <div className="app-sidebar-plan">
      <div className="app-sidebar-plan-row">
        <span className="app-sidebar-plan-badge app-sidebar-plan-badge--free">Free</span>
        <span
          className={`app-sidebar-plan-detail${free_limits_reached ? " app-sidebar-plan-detail--limit" : ""}`}
        >
          {sources_used}/{sources_limit} connections
        </span>
      </div>
      <button
        type="button"
        className="app-sidebar-plan-link"
        onClick={() => upgrade?.openUpgrade({ reason: free_limits_reached ? "sources_limit" : "general" })}
      >
        {free_limits_reached ? "Upgrade to Pro" : "Compare plans"}
      </button>
    </div>
  );
}
