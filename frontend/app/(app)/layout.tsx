"use client";

import { BriefingGenerationProvider } from "@/components/dashboard/BriefingGenerationProvider";
import { UpgradeProvider } from "@/components/billing/UpgradeProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <BriefingGenerationProvider>
      <UpgradeProvider>{children}</UpgradeProvider>
    </BriefingGenerationProvider>
  );
}
