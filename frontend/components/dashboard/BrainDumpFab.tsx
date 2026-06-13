"use client";

import { useState } from "react";
import { BrainDumpOverlay } from "./BrainDumpOverlay";
import { useUpgradeOptional } from "@/components/billing/UpgradeProvider";

export function BrainDumpFab() {
  const [open, setOpen] = useState(false);
  const upgrade = useUpgradeOptional();

  function handleOpen() {
    if (upgrade && !upgrade.billingLoading && upgrade.billing && !upgrade.billing.is_pro) {
      upgrade.openUpgrade({ reason: "brain_dump" });
      return;
    }
    setOpen(true);
  }

  const isProLocked = upgrade?.billing && !upgrade.billing.is_pro;

  return (
    <>
      <button
        type="button"
        className={`brain-dump-fab${isProLocked ? " brain-dump-fab-pro" : ""}`}
        onClick={handleOpen}
        aria-label={isProLocked ? "Upgrade for brain dump" : "Open brain dump"}
        title={isProLocked ? "Pro feature — upgrade to unlock" : "Dump your thoughts"}
      >
        <span className="brain-dump-fab-icon" aria-hidden>✦</span>
        <span className="brain-dump-fab-label">
          {isProLocked ? "Pro · Brain dump" : "Dump thoughts"}
        </span>
      </button>
      <BrainDumpOverlay open={open} onClose={() => setOpen(false)} />
    </>
  );
}
