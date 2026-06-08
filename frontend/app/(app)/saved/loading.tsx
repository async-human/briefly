import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SavedPageSkeleton } from "@/components/saved/SavedPageSkeleton";

export default function SavedLoading() {
  return (
    <DashboardShell userName={null} avatarUrl={null}>
      <SavedPageSkeleton />
    </DashboardShell>
  );
}
