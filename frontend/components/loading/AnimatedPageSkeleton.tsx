import type { CSSProperties } from "react";

export type PageLoaderVariant = "dashboard" | "saved" | "history" | "settings" | "graph";

const CAPTIONS: Record<PageLoaderVariant, string> = {
  dashboard: "Preparing your briefing…",
  saved: "Loading your saves…",
  history: "Opening your archive…",
  settings: "Loading preferences…",
  graph: "Mapping your knowledge graph…",
};

const GRAPH_NODES = [
  { id: "hub", cx: 100, cy: 100, r: 10, delay: "0s" },
  { id: "n1", cx: 100, cy: 38, r: 6, delay: "0.08s" },
  { id: "n2", cx: 154, cy: 72, r: 5.5, delay: "0.14s" },
  { id: "n3", cx: 140, cy: 138, r: 6, delay: "0.2s" },
  { id: "n4", cx: 60, cy: 138, r: 5.5, delay: "0.26s" },
  { id: "n5", cx: 46, cy: 72, r: 5, delay: "0.32s" },
  { id: "n6", cx: 168, cy: 118, r: 4, delay: "0.38s" },
] as const;

const GRAPH_EDGES: Array<[number, number, string]> = [
  [0, 1, "0.05s"],
  [0, 2, "0.12s"],
  [0, 3, "0.18s"],
  [0, 4, "0.24s"],
  [0, 5, "0.3s"],
  [2, 6, "0.36s"],
  [3, 6, "0.42s"],
  [1, 2, "0.48s"],
  [4, 5, "0.54s"],
];

function GraphLoaderArt() {
  return (
    <div className="app-graph-loader" aria-hidden>
      <span className="app-graph-loader-ring app-graph-loader-ring-outer" />
      <span className="app-graph-loader-ring app-graph-loader-ring-inner" />
      <svg className="app-graph-loader-svg" viewBox="0 0 200 200" fill="none">
        <defs>
          <linearGradient id="graph-loader-edge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5e6ad2" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#5e6ad2" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#5e6ad2" stopOpacity="0.15" />
          </linearGradient>
          <radialGradient id="graph-loader-node-grad" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#5e6ad2" stopOpacity="0.9" />
          </radialGradient>
          <filter id="graph-loader-soft-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="app-graph-loader-constellation">
          <g className="app-graph-loader-edges">
            {GRAPH_EDGES.map(([from, to, delay], i) => {
              const a = GRAPH_NODES[from];
              const b = GRAPH_NODES[to];
              return (
                <line
                  key={`${from}-${to}-${i}`}
                  x1={a.cx}
                  y1={a.cy}
                  x2={b.cx}
                  y2={b.cy}
                  className="app-graph-loader-edge"
                  style={{ animationDelay: delay }}
                />
              );
            })}
          </g>
          <g className="app-graph-loader-nodes" filter="url(#graph-loader-soft-glow)">
            {GRAPH_NODES.map((node) => (
              <g
                key={node.id}
                className={`app-graph-loader-node-wrap${node.id === "hub" ? " is-hub" : ""}`}
                transform={`translate(${node.cx} ${node.cy})`}
                style={
                  {
                    "--node-delay": node.delay,
                    "--float-duration": node.id === "hub" ? "6s" : `${4.2 + (node.r % 3) * 0.4}s`,
                  } as CSSProperties
                }
              >
                <circle cx={0} cy={0} r={node.r + 3} className="app-graph-loader-node-halo" />
                <circle cx={0} cy={0} r={node.r} className="app-graph-loader-node" />
              </g>
            ))}
          </g>
        </g>
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
      <div
        className={`app-page-loader-inner app-page-loader-enter${isGraph ? " app-page-loader-enter-graph" : ""}`}
      >
        {isGraph ? <GraphLoaderArt /> : <LayoutSkeleton variant={variant} />}
        <p className={`app-page-loader-caption${isGraph ? " app-page-loader-caption-graph" : ""}`}>
          {CAPTIONS[variant]}
        </p>
      </div>
    </div>
  );
}
