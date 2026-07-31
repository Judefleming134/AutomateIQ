"use client";

import { useActionState, useState } from "react";
import { Mail, Copy } from "lucide-react";
import { draftExpenseEmail } from "@/app/tradeiq/actions";

/**
 * One-tap chase draft for a receivable record on the aging list — reuses the
 * same AI email drafting as the scan flow, shown inline so working the debtor
 * list never leaves the page. Nothing is auto-sent.
 */
export function ReceivableChase({ expenseId, stageLabel }: { expenseId: string; stageLabel: string }) {
  const [state, action, drafting] = useActionState(draftExpenseEmail, undefined);
  const [copied, setCopied] = useState(false);

  return (
    <div>
      <form action={action} style={{ display: "inline" }}>
        <input type="hidden" name="id" value={expenseId} />
        <input type="hidden" name="intent" value="chase" />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={drafting}>
          <Mail size={13} /> {drafting ? "Drafting…" : stageLabel}
        </button>
      </form>
      {state?.error && (
        <p style={{ color: "var(--red, #f87171)", fontSize: 12.5, margin: "6px 0 0" }}>{state.error}</p>
      )}
      {state?.subject && state.body && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          <strong>{state.subject}</strong>
          <p className="panel" style={{ whiteSpace: "pre-wrap", padding: "8px 10px", margin: "6px 0" }}>{state.body}</p>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() =>
                navigator.clipboard?.writeText(state.body!).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              <Copy size={13} /> {copied ? "Copied" : "Copy email"}
            </button>
            <a
              className="btn btn-ghost btn-sm"
              href={`mailto:?subject=${encodeURIComponent(state.subject)}&body=${encodeURIComponent(state.body)}`}
            >
              <Mail size={13} /> Open in email app
            </a>
          </span>
        </div>
      )}
    </div>
  );
}
