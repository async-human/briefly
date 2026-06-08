import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { GraphPageSkeleton } from "@/components/graph/GraphPageSkeleton";

export default function GraphLoading() {
  return (
    <DashboardShell userName={null} avatarUrl={null}>
      <div className="dash-page-graph">
        <GraphPageSkeleton />
      </div>
    </DashboardShell>
  );
}
