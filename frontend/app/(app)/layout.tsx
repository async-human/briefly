"use client";

import { AppThemeProvider } from "@/components/app/AppThemeProvider";
import { BriefingGenerationProvider } from "@/components/dashboard/BriefingGenerationProvider";
import { UpgradeProvider } from "@/components/billing/UpgradeProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppThemeProvider>
      <BriefingGenerationProvider>
        <UpgradeProvider>{children}</UpgradeProvider>
      </BriefingGenerationProvider>
    </AppThemeProvider>
  );
}
