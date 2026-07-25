/**
 * Trades tool — pure quoting/invoicing logic, no I/O so it's trivially testable
 * and shared by the create form, the document view and the public page.
 *
 * Money is held as numbers of euro (matching the numeric(12,2) columns) and
 * every computed figure is rounded to cents, so the stored subtotal/VAT/total
 * always reconcile with what the customer sees on the page and the PDF.
 */

export type LineItemInput = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type DocumentTotals = {
  subtotal: number;
  vatAmount: number;
  total: number;
  lines: Array<LineItemInput & { amount: number }>;
};

/** Round to cents without binary-float drift (0.1 + 0.2 style errors). */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Totals for a document. Each line's amount = qty × unit price (rounded),
 * subtotal = Σ amounts, VAT applied to the subtotal, total = subtotal + VAT.
 * Non-finite / negative inputs are coerced to 0 so a half-typed row never
 * produces NaN on screen.
 */
export function computeTotals(
  items: LineItemInput[],
  vatRatePercent: number
): DocumentTotals {
  const rate = Number.isFinite(vatRatePercent) && vatRatePercent > 0 ? vatRatePercent : 0;
  const lines = items.map((it) => {
    const qty = Number.isFinite(it.quantity) && it.quantity > 0 ? it.quantity : 0;
    const price = Number.isFinite(it.unitPrice) && it.unitPrice > 0 ? it.unitPrice : 0;
    return { ...it, quantity: qty, unitPrice: price, amount: roundMoney(qty * price) };
  });
  const subtotal = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  const vatAmount = roundMoney((subtotal * rate) / 100);
  const total = roundMoney(subtotal + vatAmount);
  return { subtotal, vatAmount, total, lines };
}

/** €1,234.50 — Irish locale, always two decimals. */
export function formatEuro(n: number): string {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export type DocumentKind = "quote" | "invoice";

/**
 * The human-facing document number. `seq` is the account's last-used counter
 * for that kind, so the NEXT number is seq + 1, zero-padded to 4 (Q-0001,
 * INV-0042). Kept in code so the prefix stays consistent everywhere.
 */
export function nextDocumentNumber(kind: DocumentKind, seq: number): {
  number: string;
  nextSeq: number;
} {
  const nextSeq = (Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 0) + 1;
  const prefix = kind === "quote" ? "Q" : "INV";
  return { number: `${prefix}-${String(nextSeq).padStart(4, "0")}`, nextSeq };
}

export const DOCUMENT_STATUS_META: Record<
  string,
  { label: string; badge: string; tone: "neutral" | "info" | "good" | "warn" | "bad" }
> = {
  draft: { label: "Draft", badge: "badge-gray", tone: "neutral" },
  sent: { label: "Sent", badge: "badge-blue", tone: "info" },
  accepted: { label: "Accepted", badge: "badge-green", tone: "good" },
  declined: { label: "Declined", badge: "badge-red", tone: "bad" },
  paid: { label: "Paid", badge: "badge-green", tone: "good" },
  void: { label: "Void", badge: "badge-gray", tone: "neutral" },
};

/** Due date = issue date + the account's payment terms (days). */
export function dueDateFrom(issued: Date, termsDays: number): string {
  const d = new Date(issued);
  d.setUTCDate(d.getUTCDate() + (Number.isFinite(termsDays) ? termsDays : 0));
  return d.toISOString().slice(0, 10);
}

/** An invoice is overdue when it's still unpaid past its due date. */
export function isOverdue(doc: {
  kind: DocumentKind;
  status: string;
  due_at: string | null;
}): boolean {
  if (doc.kind !== "invoice" || doc.status === "paid" || doc.status === "void") return false;
  if (!doc.due_at) return false;
  return doc.due_at < new Date().toISOString().slice(0, 10);
}
