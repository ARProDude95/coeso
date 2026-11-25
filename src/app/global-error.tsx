"use client";

import Link from "next/link";

/**
 * Last-resort boundary for errors in the root layout itself, where the normal
 * layout (and its stylesheet) is unavailable — so this page carries its own
 * `<html>`/`<body>` and inline styles matching the site's warm-dark theme.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#100d0a",
          color: "#f2ebdd",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <div style={{ padding: "2rem", textAlign: "center", maxWidth: "32rem" }}>
          <p
            style={{
              margin: 0,
              fontSize: "3rem",
              fontWeight: 600,
              color: "#57493a",
            }}
          >
            !
          </p>
          <h1
            style={{
              margin: "1rem 0 0",
              fontSize: "1.25rem",
              fontWeight: 600,
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              margin: "0.5rem 0 0",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#ab9d88",
            }}
          >
            The site failed to load. Try again, or come back in a moment.
          </p>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              marginTop: "1.5rem",
            }}
          >
            <button
              type="button"
              onClick={() => retry()}
              style={{
                background: "#d2a95f",
                color: "#1a1510",
                border: 0,
                borderRadius: "0.5rem",
                padding: "0.625rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <Link
              href="/offers"
              style={{
                background: "transparent",
                color: "#f2ebdd",
                border: "1px solid #40331f",
                borderRadius: "0.5rem",
                padding: "0.625rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Back to offers
            </Link>
          </div>
          {digest && (
            <p style={{ margin: "1.5rem 0 0", fontSize: "0.75rem", color: "#57493a" }}>
              Reference: {digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
