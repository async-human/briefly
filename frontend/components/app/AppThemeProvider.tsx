"use client";

import { flushSync } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  APP_THEME_STORAGE_KEY,
  readStoredAppTheme,
  resolveAppTheme,
  type AppTheme,
} from "@/lib/appTheme";

type AppThemeContextValue = {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

let _fallbackTimer: ReturnType<typeof setTimeout> | null = null;

function smoothApply(commit: () => void): void {
  if (typeof document === "undefined") {
    commit();
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = document as any;

  if (typeof d.startViewTransition === "function") {
    d.startViewTransition(commit);
    return;
  }

  if (_fallbackTimer) clearTimeout(_fallbackTimer);
  d.documentElement.classList.add("theme-switching");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      commit();
      _fallbackTimer = setTimeout(() => {
        d.documentElement.classList.remove("theme-switching");
        _fallbackTimer = null;
      }, 500);
    });
  });
}

function applyAppTheme(theme: AppTheme): void {
  document.body.dataset.appTheme = theme;
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>("light");
  const themeRef = useRef<AppTheme>("light");

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    const resolved = resolveAppTheme(readStoredAppTheme());
    setThemeState(resolved);
    themeRef.current = resolved;
    applyAppTheme(resolved);
    return () => {
      delete document.body.dataset.appTheme;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = useCallback((next: AppTheme) => {
    smoothApply(() => {
      flushSync(() => setThemeState(next));
      themeRef.current = next;
      localStorage.setItem(APP_THEME_STORAGE_KEY, next);
      applyAppTheme(next);
    });
  }, []);

  const toggleTheme = useCallback(() => {
    const next = themeRef.current === "light" ? "dark" : "light";
    setTheme(next);
  }, [setTheme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return ctx;
}
