"use client";

import { useEffect } from "react";

const SELECTOR =
  ".capability-card, .trust-source-card, .compare-verdict, .pricing-v2-card, .memory-node";

/**
 * Mounted once. Delegates a single pointermove listener that writes the cursor
 * position into CSS vars on whichever card is under the pointer, so the cards
 * carry a violet glow that follows the mouse. Pure CSS does the rest.
 * No-ops on touch / reduced-motion.
 */
export function CardSpotlight() {
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      window.matchMedia("(hover: none)").matches
    ) {
      return;
    }

    const onMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const card = target?.closest?.(SELECTOR) as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  return null;
}
