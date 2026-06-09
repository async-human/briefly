import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default function AskLoading() {
  return (
    <DashboardShell userName={null} avatarUrl={null}>
      <div className="dash-page dash-page-ask" aria-busy="true" />
    </DashboardShell>
  );
}
