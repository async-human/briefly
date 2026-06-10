"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrieflyLogo } from "@/components/BrieflyLogo";
import { PageContentTransition } from "@/components/loading/PageContentTransition";
import { AppSidebar } from "./AppSidebar";
import { BrainDumpFab } from "./BrainDumpFab";
import { LearnedToastProvider } from "./LearnedToast";

type DashboardShellProps = {
  children: React.ReactNode;
  userName: string | null;
  avatarUrl?: string | null;
};

export function DashboardShell({ children, userName, avatarUrl }: DashboardShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen]);

  return (
    <LearnedToastProvider>
    <div className="app-shell">
      <AppSidebar
        userName={userName}
        avatarUrl={avatarUrl}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="app-main">
        <header className="app-mobile-bar">
          <button
            type="button"
            className="app-mobile-menu"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span className="sr-only">Open menu</span>
          </button>
          <Link href="/dashboard" className="app-mobile-brand" onClick={() => setSidebarOpen(false)}>
            <BrieflyLogo variant="full" size="xs" />
          </Link>
        </header>
        <div className="app-main-scroll">
          <PageContentTransition key={pathname}>{children}</PageContentTransition>
        </div>
      </div>
      <BrainDumpFab />
    </div>
    </LearnedToastProvider>
  );
}
