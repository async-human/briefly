"use client";

import Link from "next/link";
import { FREE_FEATURES, PRO_FEATURES, PRO_MONTHLY_PRICE, PRO_YEARLY_PRICE, PRO_PRICING_HEADLINE, PRO_FOUNDING_NOTE } from "@/lib/plans";

type Props = {
  variant?: "settings" | "page";
  highlight?: "free" | "pro";
};

function FeatureCheck({ included }: { included: boolean }) {
  return (
    <span className={`plan-check${included ? "" : " plan-check-dim"}`} aria-hidden>
      {included ? "✓" : "—"}
    </span>
  );
}

export function PlanComparison({ variant = "settings", highlight = "pro" }: Props) {
  return (
    <div className={`plan-comparison plan-comparison-${variant}`}>
      <div
        className={`plan-comparison-card${highlight === "free" ? " plan-comparison-card-current" : ""}`}
      >
        <div className="plan-comparison-head">
          <p className="plan-comparison-name">Free</p>
          <p className="plan-comparison-price">
            $0 <span>forever</span>
          </p>
        </div>
        <ul className="plan-comparison-features">
          {FREE_FEATURES.map((f) => (
            <li key={f.text} className={f.included ? "" : "dim"}>
              <FeatureCheck included={f.included} />
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className={`plan-comparison-card plan-comparison-card-pro${highlight === "pro" ? " plan-comparison-card-current" : ""}`}
      >
        <div className="plan-comparison-head">
          <div className="plan-comparison-pro-top">
            <p className="plan-comparison-name">{PRO_PRICING_HEADLINE}</p>
            <span className="plan-comparison-badge">Recommended</span>
          </div>
          <p className="plan-comparison-price">
            ${PRO_MONTHLY_PRICE} <span>/ month</span>
          </p>
          <p className="plan-comparison-annual">or ${PRO_YEARLY_PRICE}/year</p>
          <p className="plan-comparison-annual">{PRO_FOUNDING_NOTE}</p>
        </div>
        <ul className="plan-comparison-features">
          {PRO_FEATURES.map((f) => (
            <li key={f.text}>
              <FeatureCheck included={f.included} />
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PlanUsageBar({
  used,
  limit,
  label,
}: {
  used: number;
  limit: number;
  label: string;
}) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const atLimit = used >= limit;

  return (
    <div className={`plan-usage${atLimit ? " plan-usage-at-limit" : ""}`}>
      <div className="plan-usage-head">
        <span className="plan-usage-label">{label}</span>
        <span className="plan-usage-count">
          {used} / {limit}
        </span>
      </div>
      <div className="plan-usage-track" aria-hidden>
        <div className="plan-usage-fill" style={{ width: `${pct}%` }} />
      </div>
      {atLimit && (
        <p className="plan-usage-limit-msg">
          Free limit reached.{" "}
          <Link href="/upgrade" className="plan-usage-link">
            Upgrade to Pro
          </Link>{" "}
          for unlimited sources.
        </p>
      )}
    </div>
  );
}
