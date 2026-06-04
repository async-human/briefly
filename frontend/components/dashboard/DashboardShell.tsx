"use client";

import { DashboardNav } from "./DashboardNav";
import { BrainDumpFab } from "./BrainDumpFab";

type DashboardShellProps = {
  children: React.ReactNode;
  userName: string | null;
  avatarUrl?: string | null;
};

export function DashboardShell({ children, userName, avatarUrl }: DashboardShellProps) {
  return (
    <div className="dash-shell dash-hallmark">
      <DashboardNav userName={userName} avatarUrl={avatarUrl} />
      <main className="dash-main">{children}</main>
      <BrainDumpFab />
    </div>
  );
}
