"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type BillingStatus } from "@/lib/api";
import { PRO_FEATURES, UPGRADE_COPY, type UpgradeReason } from "@/lib/plans";

type Props = {
  open: boolean;
  reason: UpgradeReason;
  billing: BillingStatus | null;
  onClose: () => void;
  onUpgraded?: () => void;
};

export function UpgradeModal({ open, reason, billing, onClose, onUpgraded }: Props) {
  const [busy, setBusy] = useState<"monthly" | "yearly" | null>(null);
  const [error, setError] = useState("");
  const copy = UPGRADE_COPY[reason];

  useEffect(() => {
    if (!open) return;
    setError("");
    setBusy(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  if (billing?.is_pro) {
    return (
      <div className="upgrade-modal-backdrop" onClick={onClose} role="presentation">
        <div
          className="upgrade-modal"
          role="dialog"
          aria-labelledby="upgrade-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="upgrade-modal-title" className="upgrade-modal-title">
            You&apos;re on Pro
          </h2>
          <p className="upgrade-modal-sub">Your subscription is active.</p>
          <button type="button" className="btn-primary upgrade-modal-btn" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    );
  }

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

  return (
    <div className="upgrade-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="upgrade-modal"
        role="dialog"
        aria-labelledby="upgrade-modal-title"
        aria-describedby="upgrade-modal-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="upgrade-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <p className="upgrade-modal-eyebrow">Upgrade to Pro</p>
        <h2 id="upgrade-modal-title" className="upgrade-modal-title">
          {copy.title}
        </h2>
        <p id="upgrade-modal-desc" className="upgrade-modal-sub">
          {copy.subtitle}
        </p>

        {billing?.usage.sources_at_limit && reason === "sources_limit" && (
          <div className="upgrade-modal-usage" role="status">
            <span className="upgrade-modal-usage-label">Sources used</span>
            <span className="upgrade-modal-usage-value">
              {billing.usage.sources_used} / {billing.usage.sources_limit}
            </span>
          </div>
        )}

        <ul className="upgrade-modal-features">
          {PRO_FEATURES.slice(0, 5).map((f) => (
            <li key={f.text}>{f.text}</li>
          ))}
        </ul>

        {error && (
          <p className="upgrade-modal-error" role="alert">
            {error}
          </p>
        )}

        <div className="upgrade-modal-actions">
          <button
            type="button"
            className="btn-primary upgrade-modal-btn"
            disabled={busy !== null}
            onClick={() => void startCheckout("monthly")}
          >
            {busy === "monthly" ? "Redirecting…" : "Continue — $9/month"}
          </button>
          <button
            type="button"
            className="upgrade-modal-btn-secondary"
            disabled={busy !== null}
            onClick={() => void startCheckout("yearly")}
          >
            {busy === "yearly" ? "Redirecting…" : "$90/year · save 17%"}
          </button>
        </div>

        <p className="upgrade-modal-foot">
          Secure checkout via Dodo Payments. Cancel anytime.{" "}
          <Link href="/upgrade" className="upgrade-modal-link" onClick={onClose}>
            Compare plans
          </Link>
        </p>
      </div>
    </div>
  );
}
