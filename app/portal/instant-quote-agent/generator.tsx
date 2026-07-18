"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Copy, Check, Send } from "lucide-react";
import { createQuote, sendQuote } from "./actions";
import type { QuoteLine } from "@/lib/quote-agent/create-core";

export function QuoteGenerator({ hasPriceGuide }: { hasPriceGuide: boolean }) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    quoteId: string | null;
    lines: QuoteLine[];
    total: string;
    notes: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent">("idle");
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setResult(null);
    setSendState("idle");
    setSendError(null);

    // try/finally: a network blip mid-call must never leave the button stuck
    // on "Building the quote…" — pending always clears.
    try {
      const res = await createQuote(
        customerName.trim(),
        jobDescription.trim(),
        customerEmail.trim() || undefined
      );
      if (res.ok) {
        setResult({
          quoteId: res.quoteId,
          lines: res.lines,
          total: res.total,
          notes: res.notes,
        });
        router.refresh();
      } else {
        setError(res.error);
      }
    } catch {
      setError("Connection hiccup — nothing was lost. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function handleSend() {
    if (!result?.quoteId || sendState === "sending") return;
    setSendState("sending");
    setSendError(null);
    // Same guard: the send is idempotency-keyed server-side, so a retry
    // after a dropped connection can't double-send the quote.
    try {
      const res = await sendQuote(result.quoteId, customerEmail.trim() || undefined);
      if (res.ok) {
        setSendState("sent");
        router.refresh();
      } else {
        setSendState("idle");
        setSendError(res.error);
      }
    } catch {
      setSendState("idle");
      setSendError("Connection hiccup — check the quote list before retrying.");
    }
  }

  async function copy() {
    if (!result) return;
    const text = [
      `Quote for ${customerName}:`,
      ...result.lines.map((l) => `- ${l.item}: ${l.price}`),
      result.total ? `Total: ${result.total}` : null,
      result.notes ? `Notes: ${result.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable.
    }
  }

  return (
    <div className="panel form-card">
      <h2 className="panel-title" style={{ marginBottom: 14 }}>
        <span>
          <span className="sys-index">01 /</span>New quote
        </span>
      </h2>
      {!hasPriceGuide && (
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--orange, #FB923C)" }}>
          Add your price guide (right) before quoting — the agent only ever
          uses YOUR prices.
        </p>
      )}
      <form onSubmit={handleCreate}>
        <div className="field">
          <label htmlFor="quoteCustomer">Customer name</label>
          <input
            id="quoteCustomer"
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="quoteEmail">Customer email (to send the quote)</label>
          <input
            id="quoteEmail"
            type="email"
            placeholder="optional — add it to email the quote for online acceptance"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="quoteJob">Job description</label>
          <textarea
            id="quoteJob"
            rows={4}
            placeholder="Replace bathroom sink, re-seal the bath, and fix the slow drain in the en-suite…"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            required
            minLength={5}
          />
        </div>
        <div className="form-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={pending || !hasPriceGuide}
          >
            <Calculator size={15} />
            {pending ? "Pricing…" : "Create quote"}
          </button>
        </div>
      </form>

      {error && <p className="login-error">{error}</p>}

      {result && (
        <div className="gen-result">
          <div className="gen-result-bar">
            <span className="sys-label">QUOTE</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <table className="quote-table">
            <tbody>
              {result.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.item}</td>
                  <td>{l.price}</td>
                </tr>
              ))}
              {result.total && (
                <tr className="quote-total">
                  <td>Total</td>
                  <td>{result.total}</td>
                </tr>
              )}
            </tbody>
          </table>
          {result.notes && (
            <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--body)" }}>
              {result.notes}
            </p>
          )}

          {/* Quote-to-close: send the branded quote for online acceptance */}
          {result.quoteId && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              {sendState === "sent" ? (
                <p style={{ margin: 0, fontSize: 13, color: "var(--green, #34D399)" }}>
                  ✓ Sent — your customer can now view and accept it online.
                </p>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSend}
                    disabled={sendState === "sending"}
                  >
                    <Send size={14} />
                    {sendState === "sending" ? "Sending…" : "Send to customer"}
                  </button>
                  <span style={{ marginLeft: 10, fontSize: 12, color: "var(--faint)" }}>
                    Emails a branded quote they can accept online.
                  </span>
                </>
              )}
              {sendError && <p className="login-error">{sendError}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
