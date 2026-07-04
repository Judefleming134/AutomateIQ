"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Copy, Check } from "lucide-react";
import { createQuote } from "./actions";
import type { QuoteLine } from "@/lib/quote-agent/create-core";

export function QuoteGenerator({ hasPriceGuide }: { hasPriceGuide: boolean }) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    lines: QuoteLine[];
    total: string;
    notes: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setResult(null);

    const res = await createQuote(customerName.trim(), jobDescription.trim());
    setPending(false);
    if (res.ok) {
      setResult({ lines: res.lines, total: res.total, notes: res.notes });
      router.refresh();
    } else {
      setError(res.error);
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
        </div>
      )}
    </div>
  );
}
