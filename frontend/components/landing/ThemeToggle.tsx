"use client";

import { useLandingTheme } from "./LandingThemeContext";

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="2.75" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M7.5 1.2v1.5M7.5 12.3v1.5M1.2 7.5h1.5M12.3 7.5h1.5M3.05 3.05l1.06 1.06M10.89 10.89l1.06 1.06M3.05 11.95l1.06-1.06M10.89 4.11l1.06-1.06"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path
        d="M10.8 2.1a5.4 5.4 0 1 0 2.1 10.8 4.2 4.2 0 0 1-2.1-10.8Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { theme, setTheme } = useLandingTheme();

  return (
    <div
      className={`landing-theme-toggle${compact ? " landing-theme-toggle-compact" : ""}`}
      role="group"
      aria-label="Color theme"
    >
      <button
        type="button"
        className={`landing-theme-opt${theme === "light" ? " active" : ""}`}
        aria-pressed={theme === "light"}
        aria-label="Light theme"
        onClick={() => setTheme("light")}
      >
        <SunIcon />
        {!compact && <span>Light</span>}
      </button>
      <button
        type="button"
        className={`landing-theme-opt${theme === "dark" ? " active" : ""}`}
        aria-pressed={theme === "dark"}
        aria-label="Dark theme"
        onClick={() => setTheme("dark")}
      >
        <MoonIcon />
        {!compact && <span>Dark</span>}
      </button>
    </div>
  );
}
