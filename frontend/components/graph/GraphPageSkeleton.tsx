export function GraphPageSkeleton() {
  return (
    <div className="kg-stage kg-stage-skeleton" aria-busy="true" aria-label="Loading graph">
      <div className="kg-skeleton-orbit" aria-hidden />
    </div>
  );
}
