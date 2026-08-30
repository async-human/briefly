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

// ── Smooth theme switching ────────────────────────────────────────────────────
//
// Primary path: View Transitions API (Chrome 111+, Safari 18+).
//   Takes a full-page screenshot before the DOM update, applies the update,
//   then cross-fades old ↔ new. Zero timing gymnastics required.
//
// Fallback: double-rAF + blanket CSS transitions.
//   Frame 1: add .theme-switching so every element has transition: * set.
//   Frame 2: browser records the computed "before" values.
//   Then:    commit the DOM update — transitions fire from before → after.
//   500 ms:  remove the class so hover/animation performance is restored.
//
let _fallbackTimer: ReturnType<typeof setTimeout> | null = null;

function smoothApply(commit: () => void): void {
  if (typeof document === "undefined") {
    commit();
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = document as any;

  // ── View Transitions API (primary) ────────────────────────────────────────
  // Takes a screenshot before the DOM update and cross-fades old ↔ new.
  // Chrome 111+, Safari 18+. Zero timing gymnastics required.
  if (typeof d.startViewTransition === "function") {
    d.startViewTransition(commit);
    return;
  }

  // ── CSS double-rAF fallback ───────────────────────────────────────────────
  // Frame 1: add .theme-switching so every element has transition: * applied.
  // Frame 2: browser records computed "before" values. Then commit fires.
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

// ── Provider ─────────────────────────────────────────────────────────────────

export function LandingThemeProvider({ children }: { children: React.ReactNode }) {
  // Stable SSR default prevents hydration mismatch.
  // Stored preference is applied in the mount effect below.
  const [theme, setThemeState] = useState<LandingTheme>("light");

  // Keep a ref so toggleTheme can read the latest value without a stale closure.
  const themeRef = useRef<LandingTheme>("light");
  useEffect(() => { themeRef.current = theme; }, [theme]);

  // One-time: apply stored preference after hydration.
  useEffect(() => {
    const resolved = resolveLandingTheme(readStoredLandingTheme());
    setThemeState(resolved);
    themeRef.current = resolved;
    document.body.dataset.landingTheme = resolved;
    document.body.classList.add("market-landing-body");
    return () => {
      document.body.classList.remove("market-landing-body");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = useCallback((next: LandingTheme) => {
    smoothApply(() => {
      // flushSync forces React to update the DOM synchronously inside the
      // View Transition callback so the API captures the correct new frame.
      flushSync(() => setThemeState(next));
      themeRef.current = next;
      localStorage.setItem(LANDING_THEME_STORAGE_KEY, next);
      document.body.dataset.landingTheme = next;
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
    <LandingThemeContext.Provider value={value}>
      {/* suppressHydrationWarning: data-theme is intentionally set after mount */}
      <div className="landing-page market-landing" data-theme={theme} suppressHydrationWarning>
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
