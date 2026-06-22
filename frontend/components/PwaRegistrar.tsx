"use client";

import { useEffect } from "react";

import { playProactiveVoice } from "@/lib/proactiveVoice";

/** Registers a minimal service worker so the app is installable with Web Share Target support. */
export function PwaRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* non-fatal — share may still work when installed from Chrome */
    });

    // Jarvis-style proactive voice: the SW posts this when a voice-flagged push
    // arrives while a window is open. Play it (best-effort; autoplay may block).
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "briefly-voice") {
        void playProactiveVoice(event.data.voiceUrl);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);

    // Landed here from a notification click (a user gesture) — autoplay is allowed.
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("briefly_voice") === "1") {
        void playProactiveVoice();
        params.delete("briefly_voice");
        const qs = params.toString();
        window.history.replaceState(
          {},
          "",
          window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
        );
      }
    } catch {
      /* ignore */
    }

    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  return null;
}
