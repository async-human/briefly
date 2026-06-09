export type PageLoaderVariant = "dashboard" | "saved" | "history" | "settings" | "graph";

const CAPTIONS: Record<PageLoaderVariant, string> = {
  dashboard: "Preparing your briefing…",
  saved: "Loading your saves…",
  history: "Opening your archive…",
  settings: "Loading preferences…",
  graph: "Mapping your knowledge…",
};

function GraphLoaderArt() {
  return (
    <div className="app-graph-loader" aria-hidden>
      <svg className="app-graph-loader-svg" viewBox="0 0 240 200" fill="none">
        <g className="app-graph-loader-edges">
          <line x1="120" y1="52" x2="62" y2="108" className="app-graph-loader-edge" style={{ animationDelay: "0.1s" }} />
          <line x1="120" y1="52" x2="178" y2="96" className="app-graph-loader-edge" style={{ animationDelay: "0.22s" }} />
          <line x1="62" y1="108" x2="96" y2="158" className="app-graph-loader-edge" style={{ animationDelay: "0.34s" }} />
          <line x1="178" y1="96" x2="148" y2="152" className="app-graph-loader-edge" style={{ animationDelay: "0.46s" }} />
          <line x1="96" y1="158" x2="148" y2="152" className="app-graph-loader-edge" style={{ animationDelay: "0.58s" }} />
          <line x1="120" y1="52" x2="148" y2="152" className="app-graph-loader-edge app-graph-loader-edge-faint" style={{ animationDelay: "0.7s" }} />
        </g>
        <circle cx="120" cy="52" r="11" className="app-graph-loader-node app-graph-loader-node-topic" />
        <circle cx="62" cy="108" r="8" className="app-graph-loader-node app-graph-loader-node-item" style={{ animationDelay: "0.12s" }} />
        <circle cx="178" cy="96" r="9" className="app-graph-loader-node app-graph-loader-node-thread" style={{ animationDelay: "0.24s" }} />
        <circle cx="96" cy="158" r="7" className="app-graph-loader-node app-graph-loader-node-thought" style={{ animationDelay: "0.36s" }} />
        <circle cx="148" cy="152" r="8" className="app-graph-loader-node app-graph-loader-node-source" style={{ animationDelay: "0.48s" }} />
        <circle cx="152" cy="62" r="6" className="app-graph-loader-node app-graph-loader-node-item app-graph-loader-node-sm" style={{ animationDelay: "0.6s" }} />
      </svg>
      <span className="app-graph-loader-glow" />
    </div>
  );
}

function Block({
  w,
  h,
  mb = 0,
  delay = 0,
}: {
  w: number | string;
  h: number;
  mb?: number;
  delay?: number;
}) {
  return (
    <span
      className="skeleton-block app-loader-block"
      style={{
        width: w,
        height: h,
        marginBottom: mb,
        display: "block",
        animationDelay: `${delay}s`,
      }}
    />
  );
}

function LayoutSkeleton({ variant }: { variant: Exclude<PageLoaderVariant, "graph"> }) {
  if (variant === "dashboard") {
    return (
      <div className="dash-page app-loader-layout">
        <header className="dash-page-header dash-page-header-skeleton">
          <Block w={80} h={12} mb={12} delay={0.04} />
          <Block w={280} h={32} mb={8} delay={0.1} />
          <Block w={200} h={16} delay={0.16} />
        </header>
        <div className="dash-page-grid">
          <div className="dash-surface dash-surface-briefing app-loader-surface" style={{ animationDelay: "0.22s" }}>
            <div style={{ minHeight: 360 }} />
          </div>
          <div className="dash-surface dash-surface-sources app-loader-surface" style={{ animationDelay: "0.3s" }}>
            <div style={{ minHeight: 240 }} />
          </div>
        </div>
      </div>
    );
  }

  if (variant === "saved") {
    return (
      <div className="dash-page app-loader-layout">
        <header className="dash-page-header dash-page-header-skeleton">
          <Block w={72} h={12} delay={0.04} />
          <Block w={200} h={32} mb={10} delay={0.1} />
          <Block w={320} h={14} delay={0.16} />
        </header>
        <div className="dash-page-stack">
          <div className="dash-surface app-loader-surface" style={{ minHeight: 220, animationDelay: "0.22s" }} />
          <div className="dash-surface app-loader-surface" style={{ minHeight: 160, animationDelay: "0.3s" }} />
          <div className="dash-surface app-loader-surface" style={{ minHeight: 280, animationDelay: "0.38s" }} />
        </div>
      </div>
    );
  }

  if (variant === "history") {
    return (
      <div className="dash-page app-loader-layout">
        <header className="dash-page-header dash-page-header-skeleton">
          <Block w={72} h={12} delay={0.04} />
          <Block w={220} h={32} mb={10} delay={0.1} />
          <Block w={160} h={14} delay={0.16} />
        </header>
        <div className="dash-surface dash-surface-history app-loader-surface" style={{ minHeight: 480, animationDelay: "0.24s" }} />
      </div>
    );
  }

  return (
    <div className="dash-page app-loader-layout">
      <header className="dash-page-header dash-page-header-skeleton">
        <Block w={88} h={12} delay={0.04} />
        <Block w={240} h={32} mb={10} delay={0.1} />
        <Block w={300} h={14} delay={0.16} />
      </header>
      <div className="dash-page-stack">
        <div className="dash-surface app-loader-surface" style={{ minHeight: 200, animationDelay: "0.22s" }} />
        <div className="dash-surface app-loader-surface" style={{ minHeight: 260, animationDelay: "0.3s" }} />
        <div className="dash-surface app-loader-surface" style={{ minHeight: 220, animationDelay: "0.38s" }} />
      </div>
    </div>
  );
}

type AnimatedPageSkeletonProps = {
  variant: PageLoaderVariant;
};

export function AnimatedPageSkeleton({ variant }: AnimatedPageSkeletonProps) {
  const isGraph = variant === "graph";

  return (
    <div
      className={`app-page-loader${isGraph ? " app-page-loader-graph" : ""}`}
      aria-busy="true"
      aria-label={CAPTIONS[variant]}
    >
      <div className="app-page-loader-inner app-page-loader-enter">
        {isGraph ? <GraphLoaderArt /> : <LayoutSkeleton variant={variant} />}
        <p className="app-page-loader-caption">{CAPTIONS[variant]}</p>
      </div>
    </div>
  );
}
