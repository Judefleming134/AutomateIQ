"use client";

import { useActionState } from "react";
import { Check, Printer, CreditCard } from "lucide-react";
import { acceptQuoteByToken, startInvoicePayment } from "@/app/tradeos/actions";
import { formatEuro } from "@/lib/trades/core";

/**
 * The customer's side: accept a quote, pay an invoice online, or print/save any
 * document to PDF. Accept shows only for an open quote; Pay online shows only
 * for an unpaid invoice.
 */
export function PublicActions({
  token,
  kind,
  status,
  total,
}: {
  token: string;
  kind: "quote" | "invoice";
  status: string;
  total: number;
}) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptQuoteByToken, undefined);
  const [payState, payAction, paying] = useActionState(startInvoicePayment, undefined);

  const canAccept = kind === "quote" && (status === "sent" || status === "draft");
  const accepted = acceptState?.ok || status === "accepted";
  const canPay = kind === "invoice" && status !== "paid" && status !== "void";

  return (
    <div className="trades-noprint" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {canAccept && !accepted && (
        <form action={acceptAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn btn-primary" disabled={accepting}>
            <Check size={15} /> {accepting ? "Accepting…" : "Accept this quote"}
          </button>
        </form>
      )}
      {accepted && kind === "quote" && (
        <span style={{ color: "var(--green, #34d399)", fontWeight: 600, fontSize: 14 }}>
          <Check size={15} style={{ verticalAlign: "-2px" }} /> Quote accepted — thank you.
        </span>
      )}

      {canPay && (
        <form action={payAction}>
          <input type="hidden" name="token" value={token} />
          <button type="submit" className="btn btn-primary" disabled={paying}>
            <CreditCard size={15} /> {paying ? "Opening…" : `Pay ${formatEuro(total)} online`}
          </button>
        </form>
      )}
      {kind === "invoice" && status === "paid" && (
        <span style={{ color: "var(--green, #34d399)", fontWeight: 600, fontSize: 14 }}>
          <Check size={15} style={{ verticalAlign: "-2px" }} /> Paid — thank you.
        </span>
      )}

      <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
        <Printer size={15} /> Print / Save PDF
      </button>

      {acceptState?.error && <span style={{ color: "var(--red, #f87171)", fontSize: 13 }}>{acceptState.error}</span>}
      {payState?.error && <span style={{ color: "var(--red, #f87171)", fontSize: 13 }}>{payState.error}</span>}
    </div>
  );
}
