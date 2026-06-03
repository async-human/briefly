"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  LANDING_THEME_STORAGE_KEY,
  readStoredLandingTheme,
  resolveLandingTheme,
  type LandingTheme,
} from "@/lib/landingTheme";

type LandingThemeContextValue = {
  theme: LandingTheme;
  setTheme: (theme: LandingTheme) => void;
  toggleTheme: () => void;
};

const LandingThemeContext = createContext<LandingThemeContextValue | null>(null);

// Temporarily add a class to <html> that enables cross-element transitions
// during the ~350 ms of a theme switch. Removed immediately after so
// hover / animation transitions elsewhere on the page are unaffected.
let _transitionTimer: ReturnType<typeof setTimeout> | null = null;
function _startTransition() {
  if (typeof document === "undefined") return;
  if (_transitionTimer) clearTimeout(_transitionTimer);
  document.documentElement.classList.add("theme-switching");
  _transitionTimer = setTimeout(() => {
    document.documentElement.classList.remove("theme-switching");
    _transitionTimer = null;
  }, 400);
}

export function LandingThemeProvider({ children }: { children: React.ReactNode }) {
  // Always start with "light" on the server so SSR and the initial client
  // render match — no hydration mismatch.  After mount we immediately read
  // localStorage and apply the stored preference.
  const [theme, setThemeState] = useState<LandingTheme>("light");

  // Read stored preference after hydration (one-time, no deps)
  useEffect(() => {
    const resolved = resolveLandingTheme(readStoredLandingTheme());
    setThemeState(resolved);
    document.body.dataset.landingTheme = resolved;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = useCallback((next: LandingTheme) => {
    _startTransition();
    setThemeState(next);
    localStorage.setItem(LANDING_THEME_STORAGE_KEY, next);
    document.body.dataset.landingTheme = next;
  }, []);

  const toggleTheme = useCallback(() => {
    _startTransition();
    setThemeState((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem(LANDING_THEME_STORAGE_KEY, next);
      document.body.dataset.landingTheme = next;
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  return (
    <LandingThemeContext.Provider value={value}>
      {/* suppressHydrationWarning: data-theme is intentionally set after mount */}
      <div className="landing-page" data-theme={theme} suppressHydrationWarning>
        {children}
      </div>
    </LandingThemeContext.Provider>
  );
}

export function useLandingTheme() {
  const ctx = useContext(LandingThemeContext);
  if (!ctx) {
    throw new Error("useLandingTheme must be used within LandingThemeProvider");
  }
  return ctx;
}
