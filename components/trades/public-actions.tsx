"use client";

import { useActionState } from "react";
import { Check, Printer } from "lucide-react";
import { acceptQuoteByToken } from "@/app/tradeos/actions";

/**
 * The customer's side: accept a quote, or print/save any document to PDF.
 * Accept only shows for a quote that's still open.
 */
export function PublicActions({
  token,
  kind,
  status,
}: {
  token: string;
  kind: "quote" | "invoice";
  status: string;
}) {
  const [state, action, pending] = useActionState(acceptQuoteByToken, undefined);
  const canAccept = kind === "quote" && (status === "sent" || status === "draft");
  const accepted = state?.ok || status === "accepted";

  return (
    <div className="trades-noprint" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {canAccept && !accepted && (
        <form action={action}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn btn-primary" disabled={pending}>
            <Check size={15} /> {pending ? "Accepting…" : "Accept this quote"}
          </button>
        </form>
      )}
      {accepted && kind === "quote" && (
        <span style={{ color: "var(--green, #34d399)", fontWeight: 600, fontSize: 14 }}>
          <Check size={15} style={{ verticalAlign: "-2px" }} /> Quote accepted — thank you.
        </span>
      )}
      <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
        <Printer size={15} /> Print / Save PDF
      </button>
      {state?.error && <span style={{ color: "var(--red, #f87171)", fontSize: 13 }}>{state.error}</span>}
    </div>
  );
}
