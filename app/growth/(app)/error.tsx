"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * Growth-scoped error boundary. Nested under the (app) layout, so a failure
 * on one screen keeps the sidebar and topbar — Jude can jump straight to
 * another part of the engine instead of losing navigation entirely and being
 * offered the CUSTOMER portal as the only way out (what the root boundary
 * does). Shows the digest code, which is the one thing that pins a
 * server-side failure in the Vercel logs.
 */
export default function GrowthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Growth Engine error:", error);
  }, [error]);

  return (
    <section
      className="panel panel-block"
      style={{ borderLeft: "3px solid var(--orange, #fb923c)", maxWidth: 620 }}
    >
      <h2 className="panel-title">
        <AlertTriangle size={16} style={{ verticalAlign: "-3px" }} /> This screen
        didn&apos;t load
      </h2>
      <p style={{ fontSize: 14, margin: "0 0 4px" }}>
        A temporary glitch reading your data — <strong>nothing was lost and
        nothing was sent</strong>. Try again; it usually works second time.
      </p>
      <p style={{ fontSize: 12.5, color: "var(--faint)", margin: "0 0 14px" }}>
        The rest of the engine is still working — the 8am send and your
        overnight routines are unaffected by this.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={reset} className="btn btn-primary btn-sm">
          <RotateCw size={13} /> Try again
        </button>
        <Link href="/growth" className="btn btn-secondary btn-sm">
          Growth dashboard
        </Link>
        <Link href="/growth/prospects?phone=1" className="btn btn-secondary btn-sm">
          Dial list
        </Link>
      </div>

      {error.digest && (
        <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "14px 0 0" }}>
          If it keeps happening, send Claude this code:{" "}
          <code style={{ fontSize: 11.5 }}>{error.digest}</code>
        </p>
      )}
    </section>
  );
}
