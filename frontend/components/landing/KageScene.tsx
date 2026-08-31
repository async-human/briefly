"use client";

import { useEffect, useState } from "react";
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

const THEME_KEY = "briefly-kage-theme";
const FRAME = { dark: "#0a0908", light: "#f3eee6" } as const;

type KageTheme = "light" | "dark";

function readStoredTheme(): KageTheme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function Scene() {
  const [theme, setTheme] = useState<KageTheme>("dark");
  const bg = FRAME[theme];

  useEffect(() => {
    setTheme(readStoredTheme());
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "briefly:navigate") {
        if (typeof data.href !== "string" || !data.href.startsWith("/")) return;
        window.location.assign(data.href);
        return;
      }
      if (data.type === "briefly:theme" && (data.theme === "light" || data.theme === "dark")) {
        setTheme(data.theme);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="shader-frame" data-theme={theme} style={{ background: bg }}>
      <div
        className="landing-page-frame"
        data-state="ready"
        style={{
          position: "relative",
          overflow: "hidden",
          background: bg,
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
            background: bg,
          }}
        />
      </div>
    </div>
  );
}
