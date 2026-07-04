"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="login-page">
      <div className="login-card" style={{ textAlign: "center" }}>
        <div className="login-brand" style={{ justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" className="brand-logo" />
        </div>
        <p
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            letterSpacing: "0.14em",
            color: "var(--faint)",
            margin: "0 0 6px",
          }}
        >
          SYSTEM / ERROR
        </p>
        <h1 style={{ marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ fontSize: 13.5, color: "var(--body)", margin: "0 0 20px" }}>
          A temporary glitch on our side — your data is safe. Try again, and
          if it keeps happening email hello@automateiq.ie.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={reset} className="btn btn-primary">
            Try again
          </button>
          <a href="/portal" className="btn btn-secondary">
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
