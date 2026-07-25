"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ScanLine, Save, Mail, Copy, Check } from "lucide-react";
import {
  scanInvoice,
  saveScannedExpense,
  draftExpenseEmail,
  type ScannedFields,
} from "@/app/tradeos/actions";

/**
 * Scan → review → email, on one screen.
 * 1. Upload a photo/PDF of any invoice; the AI reads it.
 * 2. Every extracted field is shown EDITABLE before anything is saved —
 *    the tradesperson always confirms what the scanner read.
 * 3. Once saved, one tap drafts the right email (pay/query a supplier,
 *    send/chase a customer) — reviewed and sent from their own mail app.
 */
export function ScanFlow({ financeHref = "/tradeos/finance" }: { financeHref?: string }) {
  const [scanState, scanAction, scanning] = useActionState(scanInvoice, undefined);
  const [saveState, saveAction, saving] = useActionState(saveScannedExpense, undefined);
  const [draftState, draftAction, drafting] = useActionState(draftExpenseEmail, undefined);
  const [fileName, setFileName] = useState("");
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);
  const emailRef = useRef<HTMLDivElement>(null);

  const fields = scanState?.fields;
  const savedId = saveState?.savedId;

  // Bring the email panel into view once the record is saved.
  useEffect(() => {
    if (savedId) emailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [savedId]);

  const copy = (what: "subject" | "body", text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const F = (name: keyof ScannedFields) => (fields ? String(fields[name] ?? "") : "");

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Step 1 — upload */}
      <form action={scanAction} className="panel panel-block">
        <h2 className="panel-title">
          <ScanLine size={16} style={{ verticalAlign: "-3px" }} /> 1. Scan the invoice
        </h2>
        <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
          Photo or PDF of any invoice or receipt — a supplier bill you have to
          pay, or one of your own paper invoices. The AI reads it; you confirm
          before anything is saved.
        </p>
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
          aria-label="Invoice photo or PDF"
        />
        {fileName && (
          <p style={{ fontSize: 12.5, color: "var(--faint)", margin: "6px 0 0" }}>{fileName}</p>
        )}
        {scanState?.error && (
          <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: "10px 0 0" }}>{scanState.error}</p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={scanning}>
            <ScanLine size={15} /> {scanning ? "Reading the document (10–30s)…" : "Scan it"}
          </button>
        </div>
      </form>

      {/* Step 2 — review + save */}
      {fields && !savedId && (
        <form action={saveAction} className="panel panel-block">
          <h2 className="panel-title">2. Check what it read</h2>
          <p style={{ fontSize: 12.5, color: fields.confidence === "high" ? "var(--green, #34d399)" : "var(--orange, #fb923c)", marginTop: 0 }}>
            Scanner confidence: {fields.confidence} — every field below is editable before saving.
          </p>
          <input type="hidden" name="extracted" value={JSON.stringify(fields)} />
          <div className="grid-2">
            <div>
              <label htmlFor="sc-dir">This document is…</label>
              <select id="sc-dir" name="direction" defaultValue={fields.direction}>
                <option value="payable">A bill I have to pay (supplier)</option>
                <option value="receivable">My invoice to a customer</option>
              </select>
              <label htmlFor="sc-cp">From / to *</label>
              <input id="sc-cp" name="counterparty" defaultValue={F("counterparty")} required maxLength={160} />
              <label htmlFor="sc-em">Their email</label>
              <input id="sc-em" name="counterpartyEmail" type="email" defaultValue={F("counterparty_email")} maxLength={200} placeholder="for the email draft" />
              <label htmlFor="sc-doc">Invoice / ref number</label>
              <input id="sc-doc" name="docNumber" defaultValue={F("doc_number")} maxLength={80} />
              <label htmlFor="sc-cat">Category</label>
              <input id="sc-cat" name="category" defaultValue={F("category")} maxLength={60} placeholder="materials, fuel, insurance…" />
            </div>
            <div>
              <label htmlFor="sc-iss">Issued</label>
              <input id="sc-iss" name="issuedAt" type="date" defaultValue={F("issued_at")} />
              <label htmlFor="sc-due">Due</label>
              <input id="sc-due" name="dueAt" type="date" defaultValue={F("due_at")} />
              <label htmlFor="sc-sub">Subtotal (€)</label>
              <input id="sc-sub" name="subtotal" inputMode="decimal" defaultValue={String(fields.subtotal)} />
              <label htmlFor="sc-vat">VAT (€)</label>
              <input id="sc-vat" name="vatAmount" inputMode="decimal" defaultValue={String(fields.vat_amount)} />
              <label htmlFor="sc-tot">Total (€) *</label>
              <input id="sc-tot" name="total" inputMode="decimal" defaultValue={String(fields.total)} required />
            </div>
          </div>
          <label htmlFor="sc-sum">What it&apos;s for</label>
          <input id="sc-sum" name="summary" defaultValue={F("summary")} maxLength={300} />
          {saveState?.error && (
            <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: "10px 0 0" }}>{saveState.error}</p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Save size={15} /> {saving ? "Saving…" : "Save to Finance"}
            </button>
          </div>
        </form>
      )}

      {/* Step 3 — draft the email */}
      {savedId && (
        <div ref={emailRef} className="panel panel-block" style={{ borderLeft: "3px solid var(--green, #34d399)" }}>
          <h2 className="panel-title">
            <Check size={16} style={{ verticalAlign: "-3px", color: "var(--green, #34d399)" }} /> Saved — 3. now draft the email
          </h2>
          <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
            One tap writes it from the invoice details. You review it and send it
            from your own email — nothing goes out by itself.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(
              [
                ["remittance", "I'm paying this — remittance"],
                ["query", "Query this bill"],
                ["send", "Send to my customer"],
                ["chase", "Chase payment"],
              ] as const
            ).map(([intent, label]) => (
              <form key={intent} action={draftAction}>
                <input type="hidden" name="id" value={savedId} />
                <input type="hidden" name="intent" value={intent} />
                <button type="submit" className="btn btn-secondary btn-sm" disabled={drafting}>
                  <Mail size={14} /> {label}
                </button>
              </form>
            ))}
          </div>
          {drafting && <p style={{ fontSize: 13, color: "var(--faint)", margin: "10px 0 0" }}>Writing the email…</p>}
          {draftState?.error && (
            <p style={{ color: "var(--red, #f87171)", fontSize: 13, margin: "10px 0 0" }}>{draftState.error}</p>
          )}
          {draftState?.subject && draftState.body && (
            <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong style={{ fontSize: 14 }}>{draftState.subject}</strong>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy("subject", draftState.subject!)}>
                  <Copy size={13} /> {copied === "subject" ? "Copied" : "Copy subject"}
                </button>
              </div>
              <p className="panel" style={{ whiteSpace: "pre-wrap", fontSize: 14, padding: "12px 14px", margin: 0 }}>
                {draftState.body}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => copy("body", draftState.body!)}>
                  <Copy size={14} /> {copied === "body" ? "Copied" : "Copy email"}
                </button>
                <a
                  className="btn btn-secondary btn-sm"
                  href={`mailto:?subject=${encodeURIComponent(draftState.subject)}&body=${encodeURIComponent(draftState.body)}`}
                >
                  <Mail size={14} /> Open in my email app
                </a>
              </div>
            </div>
          )}
          <p style={{ fontSize: 12.5, color: "var(--faint)", margin: "14px 0 0" }}>
            <Link href={financeHref}>See it in Finance →</Link> · or scan the next one above.
          </p>
        </div>
      )}
    </div>
  );
}
