"use client";

import { AppThemeProvider } from "@/components/app/AppThemeProvider";
import { BriefingGenerationProvider } from "@/components/dashboard/BriefingGenerationProvider";
import { LearnedToastProvider } from "@/components/dashboard/LearnedToast";
import { GraphHubProvider } from "@/components/graph/GraphHubContext";
import { UpgradeProvider } from "@/components/billing/UpgradeProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppThemeProvider>
      <BriefingGenerationProvider>
        <UpgradeProvider>
          <LearnedToastProvider>
            <GraphHubProvider>{children}</GraphHubProvider>
          </LearnedToastProvider>
        </UpgradeProvider>
      </BriefingGenerationProvider>
    </AppThemeProvider>
  );
}
