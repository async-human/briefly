"use client";

/**
 * Last-resort boundary — catches crashes in the root layout itself.
 * Must render its own <html>/<body> because it replaces the whole document.
 * No app chrome, no data dependencies: this has to render even when
 * everything else is broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0f0e13",
          color: "#e9e7ef",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#a8a5b3", margin: "0 0 24px" }}>
            Briefly hit an unexpected error. This has been logged — try reloading,
            and if it keeps happening, give it a few minutes.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#0f0e13",
              background: "#e9e7ef",
              border: "none",
              borderRadius: 999,
              padding: "10px 20px",
              cursor: "pointer",
            }}
          >
            Reload Briefly
          </button>
          {error?.digest && (
            <p style={{ fontSize: 11, color: "#56535f", marginTop: 20 }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
