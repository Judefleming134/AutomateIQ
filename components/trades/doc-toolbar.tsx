"use client";

import { useActionState, useState } from "react";
import { Send, FileCheck2, CheckCircle2, XCircle, Link2, Printer, ExternalLink } from "lucide-react";
import { sendDocument, convertToInvoice, setDocumentStatus } from "@/app/tradeiq/actions";

/**
 * Everything you do to a quote/invoice, in one bar: email it, mark it
 * accepted/paid, turn a quote into an invoice, copy the customer link, or
 * print to PDF. Hidden when printing.
 */
export function DocToolbar({
  docId,
  kind,
  status,
  publicUrl,
  convertedTo,
}: {
  docId: string;
  kind: "quote" | "invoice";
  status: string;
  publicUrl: string;
  convertedTo: string | null;
}) {
  const [sendState, sendAction, sending] = useActionState(sendDocument, undefined);
  const [convState, convAction, converting] = useActionState(convertToInvoice, undefined);
  const [statusState, statusAction, updatingStatus] = useActionState(setDocumentStatus, undefined);
  const [copied, setCopied] = useState(false);

  const isQuote = kind === "quote";
  const done = status === "paid" || status === "void" || status === "declined";

  return (
    <div className="trades-noprint" style={{ display: "grid", gap: 10, marginBottom: 18 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <form action={sendAction}>
          <input type="hidden" name="id" value={docId} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={sending}>
            <Send size={14} /> {sending ? "Sending…" : status === "draft" ? "Send to customer" : "Resend"}
          </button>
        </form>

        {isQuote && !convertedTo && (
          <form action={convAction}>
            <input type="hidden" name="id" value={docId} />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={converting}>
              <FileCheck2 size={14} /> {converting ? "Converting…" : "Convert to invoice"}
            </button>
          </form>
        )}

        {isQuote && (status === "sent" || status === "draft") && (
          <form action={statusAction}>
            <input type="hidden" name="id" value={docId} />
            <input type="hidden" name="status" value="accepted" />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={updatingStatus}>
              <CheckCircle2 size={14} /> Mark accepted
            </button>
          </form>
        )}

        {!isQuote && status !== "paid" && (
          <form action={statusAction}>
            <input type="hidden" name="id" value={docId} />
            <input type="hidden" name="status" value="paid" />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={updatingStatus}>
              <CheckCircle2 size={14} /> Mark paid
            </button>
          </form>
        )}

        {!done && (
          <form action={statusAction}>
            <input type="hidden" name="id" value={docId} />
            <input type="hidden" name="status" value={isQuote ? "declined" : "void"} />
            <button type="submit" className="btn btn-ghost btn-sm" disabled={updatingStatus}>
              <XCircle size={14} /> {isQuote ? "Mark declined" : "Void"}
            </button>
          </form>
        )}

        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(publicUrl).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            <Link2 size={14} /> {copied ? "Copied" : "Copy link"}
          </button>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            <ExternalLink size={14} /> Preview
          </a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
            <Printer size={14} /> Print / PDF
          </button>
        </span>
      </div>

      {sendState?.error && <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: 0 }}>{sendState.error}</p>}
      {sendState?.ok && <p style={{ color: "var(--green, #34d399)", fontSize: 13, margin: 0 }}>✓ Sent to the customer.</p>}
      {convState?.error && <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: 0 }}>{convState.error}</p>}
      {statusState?.error && <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: 0 }}>{statusState.error}</p>}
    </div>
  );
}
