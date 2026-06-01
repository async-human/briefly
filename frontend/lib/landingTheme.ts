export type LandingTheme = "light" | "dark";

export const LANDING_THEME_STORAGE_KEY = "briefly-landing-theme";

export function readStoredLandingTheme(): LandingTheme | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(LANDING_THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return null;
}

export function resolveLandingTheme(stored: LandingTheme | null): LandingTheme {
  if (stored) return stored;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}
