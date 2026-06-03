"use client";

import { useLandingTheme } from "./LandingThemeContext";

// ── Sun icon — small filled circle + 8 short symmetric rays ─────────────────
function SunIcon() {
  // Precomputed ray endpoints (center 7,7; inner r=3.7; outer r=5.0; 8 rays)
  const rays = [
    [10.6, 7.0, 12.0, 7.0],
    [9.6, 9.6, 10.5, 10.5],
    [7.0, 10.6, 7.0, 12.0],
    [4.4, 9.6, 3.5, 10.5],
    [3.4, 7.0, 2.0, 7.0],
    [4.4, 4.4, 3.5, 3.5],
    [7.0, 3.4, 7.0, 2.0],
    [9.6, 4.4, 10.5, 3.5],
  ] as const;

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2.5" fill="currentColor" />
      {rays.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

// ── Moon icon — proper crescent via two arc segments ─────────────────────────
// Outer circle: center (7,7) r=5. Inner "bite" circle: center (9.5,4.5) r=4.2.
// Intersection points: ≈ (6.1, 2.1) and (11.9, 7.9).
// Outer arc (clockwise, large) traces the crescent's left/outer edge.
// Inner arc (counterclockwise, small) traces the concave inner edge.
function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      <path d="M6.1 2.1A5 5 0 1 1 11.9 7.9 4.2 4.2 0 0 0 6.1 2.1Z" />
    </svg>
  );
}

// ── Toggle ───────────────────────────────────────────────────────────────────

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useLandingTheme();

  return (
    <div
      className={`theme-seg${compact ? "" : " theme-seg--labeled"}`}
      role="group"
      aria-label="Color theme"
    >
      {/* Sliding indicator — translates to the active button position */}
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
