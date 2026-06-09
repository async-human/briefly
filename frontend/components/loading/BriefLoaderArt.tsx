import type { CSSProperties } from "react";

const LINES = [
  { y: 7, x1: 7, x2: 41 },
  { y: 16, x1: 7, x2: 34 },
  { y: 25, x1: 7, x2: 27 },
] as const;

export function BriefLoaderArt() {
  return (
    <div className="app-brief-loader" aria-hidden>
      <div className="app-brief-loader-visual">
        <span className="app-brief-loader-glow" />
        <svg className="app-brief-loader-svg" viewBox="0 0 48 32" fill="none">
          {LINES.map((line, i) => {
            const len = line.x2 - line.x1;
            return (
              <line
                key={line.y}
                x1={line.x1}
                y1={line.y}
                x2={line.x2}
                y2={line.y}
                className="app-brief-loader-stroke"
                strokeDasharray={len}
                style={
                  {
                    "--line-len": `${len}`,
                    animationDelay: `${i * 0.26}s`,
                  } as CSSProperties
                }
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
