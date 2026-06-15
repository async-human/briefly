"use client";

import { useEffect } from "react";

/** Registers a minimal service worker so the app is installable with Web Share Target support. */
export function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* non-fatal — share may still work when installed from Chrome */
    });
  }, []);

  return null;
}
