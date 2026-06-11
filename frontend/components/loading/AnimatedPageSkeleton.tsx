import { BriefLoaderArt } from "./BriefLoaderArt";
import { GraphLoaderArt } from "./GraphLoaderArt";

export type PageLoaderVariant = "dashboard" | "saved" | "history" | "settings" | "graph" | "intelligence";

const CAPTIONS: Record<PageLoaderVariant, string> = {
  dashboard: "Preparing your briefing…",
  saved: "Loading your saves…",
  history: "Opening your archive…",
  settings: "Loading preferences…",
  graph: "Mapping your knowledge graph…",
  intelligence: "Loading your intelligence profile…",
};

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

function LayoutSkeleton({ variant }: { variant: Exclude<PageLoaderVariant, "graph" | "dashboard"> }) {

  if (variant === "intelligence") {
    return (
      <div className="dash-page app-loader-layout">
        <header className="dash-page-header dash-page-header-skeleton">
          <Block w={96} h={12} delay={0.04} />
          <Block w={280} h={32} mb={10} delay={0.1} />
          <Block w={360} h={14} delay={0.16} />
        </header>
        <div className="dash-surface app-loader-surface" style={{ minHeight: 520, animationDelay: "0.24s" }} />
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
  const isDashboard = variant === "dashboard";

  return (
    <div
      className={`app-page-loader${isGraph ? " app-page-loader-graph" : ""}${isDashboard ? " app-page-loader-dashboard" : ""}`}
      aria-busy="true"
      aria-label={CAPTIONS[variant]}
    >
      <div
        className={`app-page-loader-inner app-page-loader-enter${isGraph ? " app-page-loader-enter-graph" : ""}${isDashboard ? " app-page-loader-enter-dashboard" : ""}`}
      >
        {isGraph ? (
          <GraphLoaderArt />
        ) : isDashboard ? (
          <BriefLoaderArt size="lg" />
        ) : (
          <LayoutSkeleton variant={variant} />
        )}
        <p
          className={`app-page-loader-caption${isGraph ? " app-page-loader-caption-graph" : ""}${isDashboard ? " app-page-loader-caption-dashboard" : ""}`}
        >
          {CAPTIONS[variant]}
        </p>
      </div>
    </div>
  );
}
