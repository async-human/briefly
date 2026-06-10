import { useId } from "react";

type BrieflyLogoProps = {
  /** Icon only, or icon + wordmark */
  variant?: "mark" | "full";
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
};

const MARK_PX = { xs: 20, sm: 22, md: 32, lg: 40 } as const;

function BrieflyMark({ sizePx }: { sizePx: number }) {
  const uid = useId().replace(/:/g, "");

  return (
    <svg
      width={sizePx}
      height={sizePx}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient
          id={`${uid}-gold`}
          x1="8"
          y1="7"
          x2="26"
          y2="25"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#DDB96A" />
          <stop offset="45%" stopColor="#C49A3C" />
          <stop offset="100%" stopColor="#8F6624" />
        </linearGradient>
      </defs>
      {/* Editorial margin */}
      <path
        d="M10.25 7.5v17"
        stroke={`url(#${uid}-gold)`}
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* Distilled lines — long → short */}
      <path
        d="M14 10.75h10.25"
        stroke={`url(#${uid}-gold)`}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeOpacity="0.95"
      />
      <path
        d="M14 15.5h7.75"
        stroke={`url(#${uid}-gold)`}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeOpacity="0.78"
      />
      <path
        d="M14 20.25h4.75"
        stroke={`url(#${uid}-gold)`}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeOpacity="0.58"
      />
    </svg>
  );
}

export function BrieflyLogo({ variant = "full", size = "sm", className = "" }: BrieflyLogoProps) {
  const markPx = MARK_PX[size];

  return (
    <span
      className={`briefly-logo briefly-logo--${variant} briefly-logo--${size}${className ? ` ${className}` : ""}`}
    >
      <BrieflyMark sizePx={markPx} />
      {variant === "full" ? <span className="briefly-logo-wordmark">Briefly</span> : null}
    </span>
  );
}
