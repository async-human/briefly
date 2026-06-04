"use client";

import "@/styles/hallmark-landing.css";

import { LandingThemeProvider } from "./LandingThemeContext";

export function LandingPageShell({ children }: { children: React.ReactNode }) {
  return <LandingThemeProvider>{children}</LandingThemeProvider>;
}
