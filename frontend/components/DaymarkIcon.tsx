import type { GreetingPeriod } from "@/lib/greeting";

type DaymarkIconProps = {
  period: GreetingPeriod;
  size?: "sm" | "md";
};

function MorningMark() {
  return (
    <>
      <line x1="5" y1="17" x2="19" y2="17" className="daymark-stroke daymark-horizon" />
      <path d="M7.5 17a4.5 4.5 0 0 1 9 0" className="daymark-stroke daymark-orb" />
      <line x1="12" y1="6" x2="12" y2="8.5" className="daymark-stroke daymark-ray daymark-ray-1" />
      <line x1="16.2" y1="8.3" x2="14.8" y2="10.1" className="daymark-stroke daymark-ray daymark-ray-2" />
      <line x1="7.8" y1="8.3" x2="9.2" y2="10.1" className="daymark-stroke daymark-ray daymark-ray-3" />
    </>
  );
}

function AfternoonMark() {
  return (
    <>
      <circle cx="12" cy="12" r="7.25" className="daymark-stroke daymark-orbit" />
      <circle cx="12" cy="12" r="4" className="daymark-stroke daymark-orb" />
    </>
  );
}

function EveningMark() {
  return (
    <>
      <line x1="5" y1="17" x2="19" y2="17" className="daymark-stroke daymark-horizon" />
      <path d="M8 17a4 4 0 0 0 8 0" className="daymark-stroke daymark-orb" />
      <path d="M6 17.5h12" className="daymark-stroke daymark-glow" />
    </>
  );
}

function NightMark() {
  return (
    <>
      <path
        d="M15.2 8.5a5.5 5.5 0 1 1-7.4 7.4A4.2 4.2 0 0 0 15.2 8.5Z"
        className="daymark-stroke daymark-orb"
      />
      <circle cx="17.5" cy="7.5" r="0.6" className="daymark-fill daymark-star" />
      <circle cx="8.5" cy="10" r="0.45" className="daymark-fill daymark-star daymark-star-2" />
    </>
  );
}

const MARKS: Record<GreetingPeriod, () => JSX.Element> = {
  morning: MorningMark,
  afternoon: AfternoonMark,
  evening: EveningMark,
  night: NightMark,
};

export function DaymarkIcon({ period, size = "sm" }: DaymarkIconProps) {
  const Mark = MARKS[period];

  return (
    <span className={`daymark daymark--${period} daymark--${size}`} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <Mark />
      </svg>
    </span>
  );
}
