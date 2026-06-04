"use client";

import "@/styles/study-linear.css";
import "@/styles/study-liner.css";

import { LandingThemeProvider } from "./LandingThemeContext";

export function LandingPageShell({ children }: { children: React.ReactNode }) {
  return <LandingThemeProvider>{children}</LandingThemeProvider>;
}
