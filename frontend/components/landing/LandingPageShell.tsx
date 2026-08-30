"use client";

import "@/styles/market-intelligence-landing.css";

import { LandingThemeProvider } from "./LandingThemeContext";

export function LandingPageShell({ children }: { children: React.ReactNode }) {
  return <LandingThemeProvider>{children}</LandingThemeProvider>;
}
