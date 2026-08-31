"use client";

import { useEffect } from "react";
import "@/styles/kage-scene.css";

const SANDBOX = [
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-popups",
  "allow-same-origin",
  "allow-scripts",
  "allow-top-navigation-by-user-activation",
].join(" ");

export function Scene() {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== "briefly:navigate") return;
      if (typeof data.href !== "string" || !data.href.startsWith("/")) return;
      window.location.assign(data.href);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="shader-frame">
      <div
        className="landing-page-frame"
        data-state="ready"
        style={{
          position: "relative",
          overflow: "hidden",
          background: "#0a0908",
          pointerEvents: "auto",
          width: "100%",
          height: "100%",
        }}
      >
        <iframe
          title="Briefly"
          src="/landing-pages/kage.html"
          sandbox={SANDBOX}
          loading="eager"
          style={{
            position: "absolute",
            inset: 0,
            display: "block",
            width: "100%",
            height: "100%",
            border: 0,
            background: "#0a0908",
          }}
        />
      </div>
    </div>
  );
}
