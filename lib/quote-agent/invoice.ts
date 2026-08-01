/**
 * Invoicing — the half of QuoteIQ that was sold and never built.
 *
 * /products/tradeiq says "Quotes become invoices in one step" and "Chasing is
 * automatic rather than a job for a Sunday evening". A quote could be created,
 * sent, viewed and accepted, and then the trail stopped: the customer had
 * agreed to pay and there was no way to ask them for the money.
 *
 * Everything in this file is pure. The money arithmetic, the numbering and the
 * status rules are the parts that must never be wrong, so they are testable
 * without a database and without a browser.
 *
 * MONEY IS INTEGER CENTS, EVERYWHERE.
 * `qa_quotes.total` is free text because a quote is a human sentence ("from
 * €900"). An invoice is a demand for an exact sum. Floating point is not
 * allowed near it: 0.1 + 0.2 is famously not 0.3, and an invoice that is a
 * cent out is an invoice a customer can dispute and an accountant has to chase.
 */

export type InvoiceLine = { item: string; price: string };

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

/** What the UI shows, which is not the same as what the column stores. */
export type DisplayStatus = InvoiceStatus | "overdue" | "part_paid";

export type InvoiceRecord = {
  status: InvoiceStatus;
  amount_cents: number;
  paid_amount_cents?: number | null;
  due_date?: string | null;
};

/** Default payment terms. 14 days is the norm for Irish trades. */
export const DEFAULT_TERMS_DAYS = 14;

/**
 * Parses a money string into exact integer cents.
 *
 * Returns null rather than guessing. That is the whole point: an unparseable
 * quote total ("TBC", "price on application", "from €900") must force a human
 * to type the number, because inventing one produces a legally-meaningless
 * invoice that a customer is being asked to pay.
 *
 * Handles: currency symbols, thousands separators, both decimal conventions,
 * and surrounding words. Rejects: negatives, ranges, and anything with no
 * digits at all.
 */
export function parseMoneyToCents(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = String(input).trim();
  if (!text) return null;
  // A range is ambiguous by definition — "900-1200" is not a sum anyone can be
  // billed for, so it is refused rather than resolved to one end. The separator
  // may carry spaces and a currency symbol ("€900 – €1,200"), which an earlier
  // digit-dash-digit pattern missed entirely and then happily concatenated
  // into 900120000 cents.
  if (/\d\s*(?:-|–|—|to)\s*[^\d]{0,3}\d/i.test(text)) return null;
  // A negative has to be caught BEFORE the cleaning pass, which strips the
  // minus sign along with every other non-digit — "-500" was becoming 50000.
  if (/^\s*[-–—]/.test(text)) return null;
  // Strip everything that isn't a digit or a separator.
  const cleaned = text.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf(".");
  const lastComma = cleaned.lastIndexOf(",");
  let normalised: string;
  if (lastDot === -1 && lastComma === -1) {
    normalised = cleaned;
  } else {
    // Whichever separator comes LAST is the decimal point, provided it is
    // followed by one or two digits. "1.234,56" (European) and "1,234.56"
    // (Irish/UK) both resolve correctly; "1,234" stays 1234, not 12.34.
    const decimalPos = Math.max(lastDot, lastComma);
    const decimals = cleaned.length - decimalPos - 1;
    // Three digits after the separator is overwhelmingly a thousands group
    // ("1,234", "1.234") — EXCEPT when the part in front is just a zero, where
    // it can only be a decimal. "0.125" is twelve and a half cent, not 125
    // euro, and reading it as thousands overcharged by a factor of a thousand.
    const wholePart = cleaned.slice(0, decimalPos).replace(/[.,]/g, "");
    const looksDecimal =
      decimals === 1 || decimals === 2 || wholePart === "" || wholePart === "0";
    if (looksDecimal) {
      normalised = `${wholePart || "0"}.${cleaned.slice(decimalPos + 1)}`;
    } else {
      normalised = cleaned.replace(/[.,]/g, "");
    }
  }

  const value = Number(normalised);
  if (!Number.isFinite(value) || value < 0) return null;
  // Round at the cent, not before — 12.345 becomes 1235, never 1234.
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

/** Cents back to a display string. */
export function formatCents(cents: number, currency = "EUR"): string {
  const symbol = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-IE");
  const part = String(abs % 100).padStart(2, "0");
  return `${sign}${symbol}${whole}.${part}`;
}

/**
 * Sums invoice lines into exact cents.
 *
 * Returns the total plus any lines that could not be read, so the caller can
 * say WHICH line is the problem instead of failing with a shrug. A line that
 * doesn't parse contributes nothing — silently treating it as zero and
 * presenting a confident total is how a customer gets under-billed.
 */
export function sumLines(lines: InvoiceLine[]): {
  totalCents: number;
  unparseable: string[];
} {
  let totalCents = 0;
  const unparseable: string[] = [];
  for (const line of lines) {
    const cents = parseMoneyToCents(line.price);
    if (cents === null) unparseable.push(line.item);
    else totalCents += cents;
  }
  return { totalCents, unparseable };
}

/**
 * The next invoice number for a business.
 *
 * Sequential and human-readable, because a customer quotes it back to you on
 * the phone and an accountant sorts by it. Derived from the highest existing
 * number rather than a count: deleting or voiding an invoice must never cause
 * a number to be reused, since two different documents sharing a reference is
 * an accounting problem, not a cosmetic one.
 */
export function nextInvoiceNumber(existing: string[], prefix = "INV"): string {
  let highest = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  for (const value of existing) {
    const match = pattern.exec((value ?? "").trim());
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return `${prefix}-${String(highest + 1).padStart(4, "0")}`;
}

/** Due date as a plain YYYY-MM-DD, `days` after the issue date. */
export function dueDateFrom(issuedOn: string, days = DEFAULT_TERMS_DAYS): string {
  const base = new Date(`${issuedOn.slice(0, 10)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** What is still owed. Never negative — an overpayment is not a debt. */
export function outstandingCents(invoice: InvoiceRecord): number {
  if (invoice.status === "paid" || invoice.status === "void") return 0;
  const paid = invoice.paid_amount_cents ?? 0;
  return Math.max(0, invoice.amount_cents - paid);
}

/**
 * What the invoice should SAY it is, which is richer than the stored status.
 *
 * `overdue` and `part_paid` are derived rather than stored: a stored flag has
 * to be kept in step by something, and the something is always a cron job that
 * eventually doesn't run. Derivation cannot drift.
 */
export function displayStatus(invoice: InvoiceRecord, today: string): DisplayStatus {
  if (invoice.status === "paid" || invoice.status === "void") return invoice.status;
  if (invoice.status === "draft") return "draft";
  const paid = invoice.paid_amount_cents ?? 0;
  if (paid > 0 && paid < invoice.amount_cents) return "part_paid";
  if (invoice.due_date && invoice.due_date.slice(0, 10) < today.slice(0, 10)) {
    return "overdue";
  }
  return "sent";
}

/** How many days late, or 0. Used for the chase copy. */
export function daysOverdue(invoice: InvoiceRecord, today: string): number {
  if (!invoice.due_date) return 0;
  if (invoice.status === "paid" || invoice.status === "void") return 0;
  if (invoice.status === "draft") return 0;
  const due = Date.parse(`${invoice.due_date.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((now - due) / 86_400_000));
}

export const STATUS_META: Record<DisplayStatus, { label: string; badge: string }> = {
  draft: { label: "Draft", badge: "badge-gray" },
  sent: { label: "Awaiting payment", badge: "badge-blue" },
  part_paid: { label: "Part paid", badge: "badge-orange" },
  overdue: { label: "Overdue", badge: "badge-orange" },
  paid: { label: "Paid", badge: "badge-green" },
  void: { label: "Void", badge: "badge-gray" },
};

export type QuoteSource = {
  id: string;
  business_id: string;
  customer_name: string;
  customer_email: string | null;
  quote_lines: unknown;
  total: string | null;
  status?: string | null;
};

export type BuildInvoiceResult =
  | {
      ok: true;
      row: {
        business_id: string;
        quote_id: string;
        number: string;
        customer_name: string;
        customer_email: string | null;
        lines: InvoiceLine[];
        amount_cents: number;
        due_date: string;
        status: "draft";
      };
      /** Lines whose price couldn't be read — shown so they can be fixed. */
      warnings: string[];
    }
  | { ok: false; error: string };

/** Coerces the jsonb quote_lines into the shape we can bill from. */
export function coerceLines(raw: unknown): InvoiceLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map((l) => ({
      item: String(l.item ?? "").slice(0, 300),
      price: String(l.price ?? ""),
    }))
    .filter((l) => l.item || l.price);
}

/**
 * Builds the invoice row from an accepted quote. The "one step" the marketing
 * has been promising.
 *
 * Refuses rather than guesses when the money can't be established: the lines
 * are the source of truth, the quote's free-text total is the fallback, and if
 * neither yields an exact figure the caller is told to enter one. An invoice
 * for an invented amount is worse than no invoice.
 */
export function buildInvoiceFromQuote(
  quote: QuoteSource,
  opts: { existingNumbers: string[]; today: string; termsDays?: number }
): BuildInvoiceResult {
  if (quote.status && quote.status !== "accepted") {
    return {
      ok: false,
      error: "Only an accepted quote can be invoiced — send it and get it accepted first.",
    };
  }
  const lines = coerceLines(quote.quote_lines);
  const { totalCents, unparseable } = sumLines(lines);

  // Prefer the summed lines; fall back to the quote's own total text.
  let amount_cents = totalCents;
  const warnings: string[] = [];
  if (lines.length === 0 || unparseable.length === lines.length) {
    const fromTotal = parseMoneyToCents(quote.total);
    if (fromTotal === null) {
      return {
        ok: false,
        error:
          "This quote has no priced lines and its total isn't a clear figure, so the amount can't be worked out. Open the invoice and enter the amount.",
      };
    }
    amount_cents = fromTotal;
  } else if (unparseable.length > 0) {
    warnings.push(
      `${unparseable.length} line${unparseable.length === 1 ? "" : "s"} had no readable price and ${unparseable.length === 1 ? "was" : "were"} left out of the total: ${unparseable.slice(0, 3).join(", ")}. Check the amount before sending.`
    );
  }

  return {
    ok: true,
    row: {
      business_id: quote.business_id,
      quote_id: quote.id,
      number: nextInvoiceNumber(opts.existingNumbers),
      customer_name: quote.customer_name?.trim() || "Customer",
      customer_email: quote.customer_email?.trim() || null,
      lines,
      amount_cents,
      due_date: dueDateFrom(opts.today, opts.termsDays ?? DEFAULT_TERMS_DAYS),
      status: "draft",
    },
    warnings,
  };
}
