export function GraphPageSkeleton() {
  return (
    <div className="dash-page dash-page-graph">
      <header className="dash-page-header dash-page-header-skeleton">
        <span className="skeleton-block" style={{ width: 96, height: 12, display: "block" }} />
        <span className="skeleton-block" style={{ width: 240, height: 32, display: "block", marginTop: 12 }} />
        <span className="skeleton-block" style={{ width: 320, height: 14, display: "block", marginTop: 10 }} />
      </header>
      <div className="kg-canvas-wrap kg-canvas-skeleton">
        <div className="kg-skeleton-orbit" aria-hidden />
      </div>
    </div>
  );
}
