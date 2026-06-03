"use client";

import { type ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

// Hallmark redesign: content below the fold just exists — no scroll-triggered entrance.
// Hero animations (direct motion.div) are unaffected.
export function Reveal({ children, className }: RevealProps) {
  return <div className={className}>{children}</div>;
}
