"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type BillingStatus } from "@/lib/api";
import type { UpgradeReason } from "@/lib/plans";
import { UpgradeModal } from "./UpgradeModal";

type OpenUpgradeOptions = {
  reason?: UpgradeReason;
};

type UpgradeContextValue = {
  billing: BillingStatus | null;
  billingLoading: boolean;
  refreshBilling: () => Promise<BillingStatus | null>;
  openUpgrade: (options?: OpenUpgradeOptions) => void;
  closeUpgrade: () => void;
};

const UpgradeContext = createContext<UpgradeContextValue | null>(null);

export function UpgradeProvider({ children }: { children: ReactNode }) {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [reason, setReason] = useState<UpgradeReason>("general");

  const refreshBilling = useCallback(async () => {
    try {
      const next = await api.getBillingStatus();
      setBilling(next);
      return next;
    } catch {
      return null;
    } finally {
      setBillingLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBilling();
  }, [refreshBilling]);

  const openUpgrade = useCallback((options?: OpenUpgradeOptions) => {
    setReason(options?.reason ?? "general");
    setModalOpen(true);
    void refreshBilling();
  }, [refreshBilling]);

  const closeUpgrade = useCallback(() => {
    setModalOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      billing,
      billingLoading,
      refreshBilling,
      openUpgrade,
      closeUpgrade,
    }),
    [billing, billingLoading, refreshBilling, openUpgrade, closeUpgrade],
  );

  return (
    <UpgradeContext.Provider value={value}>
      {children}
      <UpgradeModal
        open={modalOpen}
        reason={reason}
        billing={billing}
        onClose={closeUpgrade}
        onUpgraded={() => void refreshBilling()}
      />
    </UpgradeContext.Provider>
  );
}

export function useUpgrade() {
  const ctx = useContext(UpgradeContext);
  if (!ctx) {
    throw new Error("useUpgrade must be used within UpgradeProvider");
  }
  return ctx;
}

export function useUpgradeOptional() {
  return useContext(UpgradeContext);
}
