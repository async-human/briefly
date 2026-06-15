"use client";

import { useEffect } from "react";

/**
 * Error boundary for public routes (landing, login, onboarding). Keeps a
 * render crash from showing a blank page to a first-time visitor — the worst
 * possible first impression.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route error boundary:", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "var(--bg, #0f0e13)",
        color: "var(--text, #e9e7ef)",
        fontFamily:
          "var(--font-sans, system-ui), -apple-system, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
          Something went wrong
        </h1>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text-secondary, #a8a5b3)",
            margin: "0 0 24px",
          }}
        >
          This page hit an unexpected error. Reloading usually fixes it.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--bg, #0f0e13)",
            background: "var(--text, #e9e7ef)",
            border: "none",
            borderRadius: 999,
            padding: "10px 20px",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
