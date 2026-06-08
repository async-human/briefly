export function SavedPageSkeleton() {
  return (
    <div className="dash-page">
      <header className="dash-page-header dash-page-header-skeleton">
        <span className="skeleton-block" style={{ width: 72, height: 12, display: "block" }} />
        <span className="skeleton-block" style={{ width: 200, height: 32, display: "block", marginTop: 12 }} />
        <span className="skeleton-block" style={{ width: 320, height: 14, display: "block", marginTop: 10 }} />
      </header>
      <div className="dash-page-stack">
        <div className="dash-surface dash-surface-save-form" style={{ minHeight: 220 }} />
        <div className="dash-surface dash-surface-install-hint" style={{ minHeight: 160 }} />
        <div className="dash-surface dash-surface-saved" style={{ minHeight: 280 }} />
      </div>
    </div>
  );
}
