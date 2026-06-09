"use client";

import { useEffect, useRef, useState } from "react";

/** Keep loading UI visible at least `minMs` so enter animations read clearly. */
export function useMinLoadTime(loading: boolean, minMs = 420): boolean {
  const [visible, setVisible] = useState(loading);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (loading) {
      startedAt.current = Date.now();
      setVisible(true);
      return;
    }

    const elapsed = startedAt.current ? Date.now() - startedAt.current : minMs;
    const wait = Math.max(0, minMs - elapsed);
    const timer = window.setTimeout(() => setVisible(false), wait);
    return () => window.clearTimeout(timer);
  }, [loading, minMs]);

  return visible;
}
