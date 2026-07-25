"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { runFinanceAudit } from "@/app/tradeos/actions";

/**
 * The one-tap cost-saving audit: reads the account's real bills + invoices and
 * writes ranked, hedged recommendations. Read-only over their own data —
 * complete transparency, nothing changed by running it.
 */
export function FinanceAudit() {
  const [state, action, running] = useActionState(runFinanceAudit, undefined);
  return (
    <section className="panel panel-block" style={{ borderLeft: "3px solid var(--ac1, #8b5cf6)" }}>
      <h2 className="panel-title">
        <Sparkles size={16} style={{ verticalAlign: "-3px" }} /> Cost-saving audit
      </h2>
      <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
        Reads your real bills and invoices, shows where the money goes, and
        recommends savings — with the evidence for every claim. Nothing is
        changed by running it.
      </p>
      <form action={action}>
        <button type="submit" className="btn btn-primary" disabled={running}>
          <Sparkles size={15} /> {running ? "Reading your numbers (15–30s)…" : "Run the audit"}
        </button>
      </form>
      {state?.error && (
        <p style={{ color: "var(--orange, #fb923c)", fontSize: 13, margin: "10px 0 0" }}>{state.error}</p>
      )}
      {state?.report && (
        <p
          className="panel"
          style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.65, padding: "14px 16px", margin: "14px 0 0" }}
        >
          {state.report}
        </p>
      )}
    </section>
  );
}
