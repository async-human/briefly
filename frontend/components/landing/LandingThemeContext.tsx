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

export function LandingThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<LandingTheme>(() => {
    if (typeof window === "undefined") return "light";
    return resolveLandingTheme(readStoredLandingTheme());
  });

  const setTheme = useCallback((next: LandingTheme) => {
    setThemeState(next);
    localStorage.setItem(LANDING_THEME_STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem(LANDING_THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.body.dataset.landingTheme = theme;
    return () => {
      delete document.body.dataset.landingTheme;
    };
  }, [theme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  return (
    <LandingThemeContext.Provider value={value}>
      <div className="landing-page" data-theme={theme}>
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
