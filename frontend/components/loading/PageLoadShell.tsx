import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { AnimatedPageSkeleton, type PageLoaderVariant } from "./AnimatedPageSkeleton";

type PageLoadShellProps = {
  variant: PageLoaderVariant;
};

export function PageLoadShell({ variant }: PageLoadShellProps) {
  return (
    <DashboardShell userName={null} avatarUrl={null}>
      {variant === "graph" ? (
        <div className="dash-page-graph">
          <AnimatedPageSkeleton variant="graph" />
        </div>
      ) : (
        <AnimatedPageSkeleton variant={variant} />
      )}
    </DashboardShell>
  );
}
