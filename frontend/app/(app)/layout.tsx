"use client";

import { BriefingGenerationProvider } from "@/components/dashboard/BriefingGenerationProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <BriefingGenerationProvider>{children}</BriefingGenerationProvider>;
}
