import { useId } from "react";
import type { GreetingPeriod } from "@/lib/greeting";

type DaymarkIconProps = {
  period: GreetingPeriod;
  size?: "sm" | "md" | "lg";
};

function MorningMark({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-sun`} x1="16" y1="8" x2="16" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <line x1="6" y1="22" x2="26" y2="22" className="daymark-stroke daymark-horizon" />
      <path d="M10 22a6 6 0 0 1 12 0" fill={`url(#${id}-sun)`} stroke="none" className="daymark-orb" />
      <path d="M10 22a6 6 0 0 1 12 0" className="daymark-stroke daymark-orb-outline" />
      <line x1="16" y1="6" x2="16" y2="9.5" className="daymark-stroke daymark-ray daymark-ray-1" />
      <line x1="22.5" y1="9.5" x2="20.8" y2="11.8" className="daymark-stroke daymark-ray daymark-ray-2" />
      <line x1="9.5" y1="9.5" x2="11.2" y2="11.8" className="daymark-stroke daymark-ray daymark-ray-3" />
      <line x1="25" y1="16" x2="22.2" y2="16" className="daymark-stroke daymark-ray daymark-ray-4" />
      <line x1="7" y1="16" x2="9.8" y2="16" className="daymark-stroke daymark-ray daymark-ray-5" />
    </>
  );
}

function AfternoonMark({ id }: { id: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-disc`} cx="16" cy="16" r="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.7" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="10.5" className="daymark-stroke daymark-orbit" />
      <circle cx="16" cy="16" r="7" fill={`url(#${id}-disc)`} stroke="none" className="daymark-orb" />
      <circle cx="16" cy="16" r="7" className="daymark-stroke daymark-orb-outline" />
      <line x1="16" y1="3" x2="16" y2="5.5" className="daymark-stroke daymark-ray" />
      <line x1="16" y1="26.5" x2="16" y2="29" className="daymark-stroke daymark-ray" />
      <line x1="3" y1="16" x2="5.5" y2="16" className="daymark-stroke daymark-ray" />
      <line x1="26.5" y1="16" x2="29" y2="16" className="daymark-stroke daymark-ray" />
    </>
  );
}

function EveningMark({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-set`} x1="16" y1="14" x2="16" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <rect x="4" y="18" width="24" height="10" fill={`url(#${id}-set)`} opacity="0.12" className="daymark-sky" />
      <line x1="5" y1="22" x2="27" y2="22" className="daymark-stroke daymark-horizon" />
      <path d="M11 22a5 5 0 0 0 10 0" fill={`url(#${id}-set)`} stroke="none" className="daymark-orb" />
      <path d="M11 22a5 5 0 0 0 10 0" className="daymark-stroke daymark-orb-outline" />
    </>
  );
}

function NightMark({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-moon`} x1="18" y1="10" x2="12" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      <path
        d="M19 11.5a6.5 6.5 0 1 1-9.2 9.2A5 5 0 0 0 19 11.5Z"
        fill={`url(#${id}-moon)`}
        stroke="none"
        className="daymark-orb"
      />
      <path
        d="M19 11.5a6.5 6.5 0 1 1-9.2 9.2A5 5 0 0 0 19 11.5Z"
        className="daymark-stroke daymark-orb-outline"
      />
      <circle cx="22.5" cy="10" r="0.9" className="daymark-fill daymark-star daymark-star-1" />
      <circle cx="9" cy="13" r="0.65" className="daymark-fill daymark-star daymark-star-2" />
      <circle cx="24" cy="17" r="0.5" className="daymark-fill daymark-star daymark-star-3" />
    </>
  );
}

const MARKS: Record<GreetingPeriod, (props: { id: string }) => JSX.Element> = {
  morning: MorningMark,
  afternoon: AfternoonMark,
  evening: EveningMark,
  night: NightMark,
};

export function DaymarkIcon({ period, size = "sm" }: DaymarkIconProps) {
  const uid = useId().replace(/:/g, "");
  const Mark = MARKS[period];

  return (
    <span className={`daymark daymark--${period} daymark--${size}`} aria-hidden>
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <Mark id={uid} />
      </svg>
    </span>
  );
}
