import type { CSSProperties } from "react";

type BriefLoaderArtProps = {
  /** sm = inline status · md = panel · lg = full-page */
  size?: "sm" | "md" | "lg";
};

const SIZE_CLASS = {
  sm: "hm-brief-loader--sm",
  md: "hm-brief-loader--md",
  lg: "hm-brief-loader--lg",
} as const;

export function BriefLoaderArt({ size = "md" }: BriefLoaderArtProps) {
  return (
    <div className={`hm-brief-loader ${SIZE_CLASS[size]}`} aria-hidden>
      <span className="hm-brief-loader-orbit" />
      <span className="hm-brief-loader-orbit hm-brief-loader-orbit-2" />
      <div className="hm-brief-loader-stack">
        <span className="hm-brief-loader-sheet hm-brief-loader-sheet-back" />
        <span className="hm-brief-loader-sheet hm-brief-loader-sheet-mid" />
        <span className="hm-brief-loader-sheet hm-brief-loader-sheet-front">
          <span
            className="hm-brief-loader-line"
            style={{ "--line-i": 0 } as CSSProperties}
          />
          <span
            className="hm-brief-loader-line hm-brief-loader-line-2"
            style={{ "--line-i": 1 } as CSSProperties}
          />
          <span
            className="hm-brief-loader-line hm-brief-loader-line-3"
            style={{ "--line-i": 2 } as CSSProperties}
          />
          <span
            className="hm-brief-loader-line hm-brief-loader-line-4"
            style={{ "--line-i": 3 } as CSSProperties}
          />
        </span>
      </div>
    </div>
  );
}
