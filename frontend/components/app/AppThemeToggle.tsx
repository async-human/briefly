"use client";

import { useAppTheme } from "./AppThemeProvider";

function SunIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export function AppThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useAppTheme();

  return (
    <div
      className={`theme-seg${compact ? "" : " theme-seg--labeled"}`}
      role="group"
      aria-label="Color theme"
    >
      <div
        className="theme-seg__indicator"
        style={{ transform: theme === "dark" ? "translateX(100%)" : "translateX(0%)" }}
        aria-hidden
      />

      <button
        type="button"
        className={`theme-seg__btn${theme === "light" ? " active" : ""}`}
        aria-pressed={theme === "light"}
        aria-label="Light theme"
        onClick={() => setTheme("light")}
      >
        <SunIcon />
        {!compact && <span>Light</span>}
      </button>

      <button
        type="button"
        className={`theme-seg__btn${theme === "dark" ? " active" : ""}`}
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
