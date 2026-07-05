"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { sendQuote } from "./actions";
import type { QuoteLine } from "@/lib/quote-agent/create-core";

type Quote = {
  id: string;
  customerName: string;
  customerEmail: string | null;
  jobDescription: string;
  lines: QuoteLine[];
  total: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
};

export function QuoteRow({ quote }: { quote: Quote }) {
  const router = useRouter();
  const [email, setEmail] = useState(quote.customerEmail ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (sending) return;
    setSending(true);
    setError(null);
    const res = await sendQuote(quote.id, email.trim() || undefined);
    setSending(false);
    if (res.ok) router.refresh();
    else setError(res.error);
  }

  const decided = quote.status === "accepted" || quote.status === "declined";
  const canSend = !decided;

  return (
    <details className="panel content-item">
      <summary>
        <span className={`quote-badge quote-badge-${quote.status}`}>
          {STATUS_LABEL[quote.status] ?? quote.status}
        </span>
        <span className="content-topic">
          {quote.customerName}
          {quote.total ? ` — ${quote.total}` : ""} · {quote.jobDescription.slice(0, 60)}
        </span>
        <span className="feed-time">
          {new Date(quote.createdAt).toLocaleDateString("en-IE", {
            day: "numeric",
            month: "short",
          })}
        </span>
      </summary>
      <div style={{ padding: "0 16px 16px" }}>
        <table className="quote-table">
          <tbody>
            {quote.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.item}</td>
                <td>{l.price}</td>
              </tr>
            ))}
            {quote.total && (
              <tr className="quote-total">
                <td>Total</td>
                <td>{quote.total}</td>
              </tr>
            )}
          </tbody>
        </table>
        {quote.notes && (
          <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--body)" }}>
            {quote.notes}
          </p>
        )}

        {canSend && (
          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <input
              type="email"
              placeholder="customer@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                flex: "1 1 200px",
                background: "var(--bg2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                padding: "9px 12px",
                color: "var(--heading)",
                fontSize: 13,
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={send}
              disabled={sending}
            >
              <Send size={13} />
              {sending ? "Sending…" : quote.status === "draft" ? "Send quote" : "Resend"}
            </button>
          </div>
        )}
        {decided && (
          <p
            style={{
              marginTop: 12,
              fontSize: 12.5,
              color: quote.status === "accepted" ? "var(--green, #34D399)" : "var(--faint)",
            }}
          >
            {quote.status === "accepted"
              ? "✓ Accepted by the customer online."
              : "Declined by the customer."}
          </p>
        )}
        {error && <p className="login-error">{error}</p>}
      </div>
    </details>
  );
}
