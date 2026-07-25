"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2, FileText } from "lucide-react";
import { createDocument } from "@/app/tradeos/actions";
import { computeTotals, formatEuro } from "@/lib/trades/core";

type Customer = { id: string; name: string };
type Line = { description: string; quantity: string; unitPrice: string };

const blankLine = (): Line => ({ description: "", quantity: "1", unitPrice: "" });

/**
 * Quote builder: pick or add a customer, add line items, watch the totals
 * (incl. VAT) update live. Line items are submitted as JSON so the server can
 * re-compute and store them authoritatively — the on-screen totals use the very
 * same computeTotals(), so what you see is what gets saved.
 */
export function QuoteEditor({
  customers,
  vatRate,
}: {
  customers: Customer[];
  vatRate: number;
}) {
  const [state, formAction, pending] = useActionState(createDocument, undefined);
  const [mode, setMode] = useState<"existing" | "new">(
    customers.length > 0 ? "existing" : "new"
  );
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>([blankLine()]);

  const totals = useMemo(
    () =>
      computeTotals(
        lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
        })),
        vatRate
      ),
    [lines, vatRate]
  );

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (i: number) =>
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, k) => k !== i)));

  const itemsJson = JSON.stringify(
    lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
    }))
  );

  return (
    <form action={formAction} className="panel panel-block">
      <input type="hidden" name="items" value={itemsJson} />

      <h2 className="panel-title">Customer</h2>
      {customers.length > 0 && (
        <div style={{ display: "flex", gap: 14, marginBottom: 10, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}>
            <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> Existing customer
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5 }}>
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New customer
          </label>
        </div>
      )}

      {mode === "existing" && customers.length > 0 ? (
        <>
          <input type="hidden" name="customerId" value={customerId} />
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ maxWidth: 360 }}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </>
      ) : (
        <div className="grid-2">
          <div>
            <label htmlFor="cn">Name *</label>
            <input id="cn" name="customerName" maxLength={160} placeholder="Customer or company" />
            <label htmlFor="ce">Email</label>
            <input id="ce" name="customerEmail" type="email" maxLength={200} placeholder="so you can email the quote" />
          </div>
          <div>
            <label htmlFor="cp">Phone</label>
            <input id="cp" name="customerPhone" maxLength={60} />
            <label htmlFor="ca">Address</label>
            <input id="ca" name="customerAddress" maxLength={400} />
          </div>
        </div>
      )}

      <h2 className="panel-title" style={{ marginTop: 22 }}>Line items</h2>
      <div className="table-wrap">
        <table style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ width: 80 }}>Qty</th>
              <th style={{ width: 120 }}>Unit €</th>
              <th style={{ width: 110, textAlign: "right" }}>Amount</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="e.g. Supply & fit boiler" style={{ width: "100%" }} />
                </td>
                <td>
                  <input value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} inputMode="decimal" style={{ width: "100%" }} />
                </td>
                <td>
                  <input value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} inputMode="decimal" placeholder="0.00" style={{ width: "100%" }} />
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {formatEuro(totals.lines[i]?.amount ?? 0)}
                </td>
                <td>
                  <button type="button" onClick={() => removeLine(i)} className="btn btn-ghost btn-sm" aria-label="Remove line" title="Remove line">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={addLine} className="btn btn-secondary btn-sm" style={{ marginTop: 10 }}>
        <Plus size={14} /> Add line
      </button>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <div style={{ minWidth: 240, fontSize: 14, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--faint)" }}>Subtotal</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatEuro(totals.subtotal)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--faint)" }}>VAT ({vatRate}%)</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatEuro(totals.vatAmount)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 16, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
            <span>Total</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatEuro(totals.total)}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <label htmlFor="notes">Notes (optional)</label>
        <textarea id="notes" name="notes" rows={2} maxLength={2000} placeholder="Anything the customer should know — terms, timing, what's included." />
      </div>

      {state?.error && (
        <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: "12px 0 0" }}>{state.error}</p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <FileText size={15} /> {pending ? "Creating…" : "Create quote"}
        </button>
      </div>
    </form>
  );
}
