"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary for the authenticated app. A crash in any dashboard panel
 * (briefing, graph, ask, settings…) is contained here as a recoverable card
 * instead of a white screen — the user can retry or fall back to the dashboard.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in the browser console; Sentry's client integration also captures this.
    console.error("App error boundary:", error);
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
      }}
    >
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            margin: "0 auto 18px",
            display: "grid",
            placeItems: "center",
            background: "color-mix(in srgb, var(--accent, #6b5cff) 14%, transparent)",
            color: "var(--accent, #8a7cff)",
            fontSize: 22,
          }}
          aria-hidden
        >
          !
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 600, margin: "0 0 8px" }}>
          This part of Briefly hit a snag
        </h1>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text-secondary, #a8a5b3)",
            margin: "0 0 22px",
          }}
        >
          The rest of your account is fine. Try this view again — your briefings and
          data are safe.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
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
          <Link
            href="/dashboard"
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--text-secondary, #a8a5b3)",
              border: "1px solid var(--border-strong, rgba(255,255,255,0.14))",
              borderRadius: 999,
              padding: "10px 20px",
              textDecoration: "none",
            }}
          >
            Back to dashboard
          </Link>
        </div>
        {error?.digest && (
          <p style={{ fontSize: 11, color: "var(--text-muted, #56535f)", marginTop: 20 }}>
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
