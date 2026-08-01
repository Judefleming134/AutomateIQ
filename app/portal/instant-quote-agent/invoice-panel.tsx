"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FileText, Send, Euro, Ban, ExternalLink } from "lucide-react";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  formatCents,
  displayStatus,
  daysOverdue,
  outstandingCents,
  STATUS_META,
  type InvoiceStatus,
} from "@/lib/quote-agent/invoice";
import {
  createInvoiceFromQuote,
  sendInvoice,
  recordPayment,
  voidInvoice,
  setInvoiceAmount,
} from "./invoice-actions";

export type InvoiceView = {
  id: string;
  number: string;
  customer_name: string;
  customer_email: string | null;
  amount_cents: number;
  paid_amount_cents: number | null;
  currency: string | null;
  status: InvoiceStatus;
  due_date: string | null;
  view_token: string;
};

/** One row of feedback shared by every action on this panel. */
function Feedback({ state }: { state?: { ok?: boolean; error?: string; notice?: string } }) {
  if (!state?.error && !state?.notice) return null;
  return (
    <p
      role={state.error ? "alert" : undefined}
      style={{
        margin: "8px 0 0",
        fontSize: 12.5,
        color: state.error ? "var(--orange, #fb923c)" : "var(--green, #34d399)",
      }}
    >
      {state.error ?? state.notice}
    </p>
  );
}

/**
 * "Create invoice" on an accepted quote — the one step the TradeIQ page has
 * been selling. Only rendered for accepted quotes: billing for work a customer
 * hasn't agreed to is not a shortcut worth offering.
 */
export function CreateInvoiceButton({ quoteId }: { quoteId: string }) {
  const [state, action] = useActionState(createInvoiceFromQuote, undefined);
  return (
    <form action={action} style={{ display: "inline-block" }}>
      <input type="hidden" name="quote_id" value={quoteId} />
      <SubmitButton className="btn btn-primary btn-sm" pendingText="Raising…">
        <FileText size={13} /> Create invoice
      </SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

/**
 * The invoice itself: what it's for, what's owed, and the three things you can
 * do about it — send it, record money, or void it.
 */
export function InvoiceCard({ invoice, today }: { invoice: InvoiceView; today: string }) {
  const [sendState, sendAction] = useActionState(sendInvoice, undefined);
  const [payState, payAction] = useActionState(recordPayment, undefined);
  const [voidState, voidAction] = useActionState(voidInvoice, undefined);
  const [amountState, amountAction] = useActionState(setInvoiceAmount, undefined);

  const shown = displayStatus(invoice, today);
  const meta = STATUS_META[shown];
  const late = daysOverdue(invoice, today);
  const owed = outstandingCents(invoice);
  const currency = invoice.currency ?? "EUR";
  const isDraft = invoice.status === "draft";
  const settled = invoice.status === "paid" || invoice.status === "void";

  return (
    <div className="panel panel-block" style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <strong>{invoice.number}</strong>
        <span className={`badge ${meta.badge}`}>{meta.label}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {formatCents(invoice.amount_cents, currency)}
        </span>
        {owed > 0 && owed !== invoice.amount_cents && (
          <span style={{ fontSize: 12.5, color: "var(--faint)" }}>
            {formatCents(owed, currency)} still due
          </span>
        )}
        {late > 0 && (
          <span style={{ fontSize: 12.5, color: "var(--orange, #fb923c)" }}>
            {late} day{late === 1 ? "" : "s"} late
          </span>
        )}
        <Link
          href={`/i/${invoice.view_token}`}
          target="_blank"
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: "auto" }}
        >
          What the customer sees <ExternalLink size={12} />
        </Link>
      </div>

      {/* Only a draft can be repriced — changing the amount on an invoice a
          customer already holds is a different document, not an edit. */}
      {isDraft && (
        <form action={amountAction} style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input type="hidden" name="invoice_id" value={invoice.id} />
          <input
            name="amount"
            placeholder={`Amount (currently ${formatCents(invoice.amount_cents, currency)})`}
            aria-label="Invoice amount"
            style={{ flex: "1 1 200px", margin: 0 }}
            maxLength={40}
          />
          <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
            Set amount
          </SubmitButton>
        </form>
      )}
      <Feedback state={amountState} />

      {!settled && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start", marginTop: 10 }}>
          <form action={sendAction}>
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…">
              <Send size={13} /> {invoice.status === "sent" ? "Send again" : "Send invoice"}
            </SubmitButton>
          </form>

          <form action={payAction} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <input
              name="amount"
              placeholder="Amount (blank = paid in full)"
              aria-label="Payment received"
              style={{ width: 200, margin: 0 }}
              maxLength={40}
            />
            <SubmitButton className="btn btn-secondary btn-sm" pendingText="Recording…">
              <Euro size={13} /> Record payment
            </SubmitButton>
          </form>

          <form action={voidAction}>
            <input type="hidden" name="invoice_id" value={invoice.id} />
            <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
              <Ban size={13} /> Void
            </SubmitButton>
          </form>
        </div>
      )}

      <Feedback state={sendState} />
      <Feedback state={payState} />
      <Feedback state={voidState} />

      {invoice.status === "draft" && (
        <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "8px 0 0" }}>
          Nothing has been sent yet — the customer sees this only once you send it.
        </p>
      )}
    </div>
  );
}
