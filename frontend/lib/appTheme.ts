export type AppTheme = "light" | "dark";

/** Shared with landing so theme preference persists across marketing + app. */
export const APP_THEME_STORAGE_KEY = "briefly-landing-theme";

export function readStoredAppTheme(): AppTheme | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(APP_THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return null;
}

export function resolveAppTheme(stored: AppTheme | null): AppTheme {
  if (stored) return stored;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}
