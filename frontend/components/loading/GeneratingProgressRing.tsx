"use client";

import type { CSSProperties } from "react";

type GeneratingProgressRingProps = {
  /** 0–1 progress estimate */
  progress: number;
};

export function GeneratingProgressRing({ progress }: GeneratingProgressRingProps) {
  const clamped = Math.min(1, Math.max(0, progress));
  const deg = Math.round(clamped * 360);

  return (
    <div className="hm-generating-ring" aria-hidden>
      <svg className="hm-generating-ring-svg" viewBox="0 0 120 120">
        <circle
          className="hm-generating-ring-track"
          cx="60"
          cy="60"
          r="52"
          fill="none"
        />
        <circle
          className="hm-generating-ring-progress"
          cx="60"
          cy="60"
          r="52"
          fill="none"
          style={{
            strokeDasharray: `${2 * Math.PI * 52}`,
            strokeDashoffset: `${2 * Math.PI * 52 * (1 - clamped)}`,
          }}
        />
      </svg>
      <span
        className="hm-generating-ring-fallback"
        style={{ "--ring-deg": `${deg}deg` } as CSSProperties}
        aria-hidden
      />
    </div>
  );
}
