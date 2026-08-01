import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseMoneyToCents,
  formatCents,
  sumLines,
  nextInvoiceNumber,
  dueDateFrom,
  outstandingCents,
  displayStatus,
  daysOverdue,
  coerceLines,
  buildInvoiceFromQuote,
  DEFAULT_TERMS_DAYS,
  type QuoteSource,
} from "@/lib/quote-agent/invoice";

/**
 * Invoicing — the half of QuoteIQ that was sold and never built.
 *
 * /products/tradeiq says "Quotes become invoices in one step" and "Chasing is
 * automatic rather than a job for a Sunday evening". A quote could be created,
 * sent, viewed and accepted, and then the trail stopped: the customer had
 * agreed to pay and there was no way to ask them for the money.
 *
 * The money arithmetic is the part that must never be wrong. An invoice a cent
 * out is an invoice a customer can dispute; an invoice for an invented amount
 * is worse than no invoice at all.
 */

describe("money is exact integer cents, never floating point", () => {
  it.each([
    ["€1,250.00", 125000],
    ["1250", 125000],
    ["€0.99", 99],
    ["0.1", 10],
    ["1,234.56", 123456],
    ["  €2,499.99  ", 249999],
    ["EUR 45", 4500],
    ["45.5", 4550],
  ])("%s → %i cents", (input, expected) => {
    expect(parseMoneyToCents(input)).toBe(expected);
  });

  it("does not lose a cent to floating point", () => {
    // 0.1 + 0.2 !== 0.3 in float. In cents it is exactly 30.
    const a = parseMoneyToCents("0.10")!;
    const b = parseMoneyToCents("0.20")!;
    expect(a + b).toBe(30);
    expect(formatCents(a + b)).toBe("€0.30");
  });

  it("reads both decimal conventions", () => {
    expect(parseMoneyToCents("1,234.56")).toBe(123456); // Irish/UK
    expect(parseMoneyToCents("1.234,56")).toBe(123456); // European
  });

  it("does not mistake a thousands separator for a decimal", () => {
    expect(parseMoneyToCents("1,234")).toBe(123400);
    expect(parseMoneyToCents("1.234")).toBe(123400);
  });

  it("rounds at the cent rather than truncating", () => {
    // A leading zero makes the separator unambiguously a decimal point, so
    // this is twelve-and-a-half cent and must round to 13 — not 125 euro.
    expect(parseMoneyToCents("0.125")).toBe(13);
    expect(parseMoneyToCents("0.129")).toBe(13);
  });

  it("still reads three trailing digits as a thousands group", () => {
    // "1.234" and "1,234" are one thousand two hundred and thirty-four in the
    // two conventions — not 1.23.
    expect(parseMoneyToCents("12.345")).toBe(1234500);
  });

  it.each(["TBC", "price on application", "", "   ", "€", "-"])(
    "refuses to guess at %s",
    (input) => {
      expect(parseMoneyToCents(input)).toBeNull();
    }
  );

  it("REFUSES a range — nobody can be billed for '900-1200'", () => {
    // The CRM sync takes the low end of a range because it's an estimate for a
    // pipeline. An invoice is a demand for an exact sum; guessing here bills a
    // real person the wrong amount.
    expect(parseMoneyToCents("900-1200")).toBeNull();
    expect(parseMoneyToCents("€900 – €1,200")).toBeNull();
    expect(parseMoneyToCents("900 to 1200")).toBeNull();
  });

  it("refuses a negative", () => {
    expect(parseMoneyToCents("-500")).toBeNull();
  });

  it("formats back for humans", () => {
    expect(formatCents(125000)).toBe("€1,250.00");
    expect(formatCents(99)).toBe("€0.99");
    expect(formatCents(0)).toBe("€0.00");
    expect(formatCents(100000000)).toBe("€1,000,000.00");
  });
});

describe("summing lines", () => {
  it("adds priced lines exactly", () => {
    const r = sumLines([
      { item: "Labour", price: "€450.00" },
      { item: "Materials", price: "€312.50" },
      { item: "Disposal", price: "€37.50" },
    ]);
    expect(r.totalCents).toBe(80000);
    expect(formatCents(r.totalCents)).toBe("€800.00");
    expect(r.unparseable).toEqual([]);
  });

  it("names the lines it could not read instead of failing silently", () => {
    // Treating an unreadable line as zero and showing a confident total is how
    // a customer gets under-billed.
    const r = sumLines([
      { item: "Labour", price: "€450" },
      { item: "Skip hire", price: "TBC" },
    ]);
    expect(r.totalCents).toBe(45000);
    expect(r.unparseable).toEqual(["Skip hire"]);
  });

  it("handles no lines", () => {
    expect(sumLines([])).toEqual({ totalCents: 0, unparseable: [] });
  });
});

describe("invoice numbering", () => {
  it("starts at INV-0001", () => {
    expect(nextInvoiceNumber([])).toBe("INV-0001");
  });

  it("continues from the highest, not the count", () => {
    // Counting would REUSE a number after a void or delete, and two documents
    // sharing a reference is an accounting problem, not a cosmetic one.
    expect(nextInvoiceNumber(["INV-0001", "INV-0002", "INV-0007"])).toBe("INV-0008");
  });

  it("is not fooled by a gap", () => {
    expect(nextInvoiceNumber(["INV-0001", "INV-0009"])).toBe("INV-0010");
  });

  it("ignores anything that isn't one of ours", () => {
    expect(nextInvoiceNumber(["2024-001", "", "INV-", "INV-0003", "draft"])).toBe("INV-0004");
  });

  it("pads so they sort correctly as text", () => {
    expect(nextInvoiceNumber(["INV-0099"])).toBe("INV-0100");
  });

  it("keeps counting past the padding width", () => {
    expect(nextInvoiceNumber(["INV-9999"])).toBe("INV-10000");
  });
});

describe("due dates and lateness", () => {
  it("defaults to 14-day terms", () => {
    expect(DEFAULT_TERMS_DAYS).toBe(14);
    expect(dueDateFrom("2026-08-01")).toBe("2026-08-15");
  });

  it("accepts other terms", () => {
    expect(dueDateFrom("2026-08-01", 30)).toBe("2026-08-31");
    expect(dueDateFrom("2026-08-01", 0)).toBe("2026-08-01");
  });

  it("crosses a month and a year end", () => {
    expect(dueDateFrom("2026-12-28", 7)).toBe("2027-01-04");
  });

  it("counts days late", () => {
    const inv = { status: "sent" as const, amount_cents: 1000, due_date: "2026-08-01" };
    expect(daysOverdue(inv, "2026-08-01")).toBe(0);
    expect(daysOverdue(inv, "2026-08-08")).toBe(7);
  });

  it("a paid or void invoice is never late", () => {
    const base = { amount_cents: 1000, due_date: "2026-07-01" };
    expect(daysOverdue({ ...base, status: "paid" }, "2026-08-01")).toBe(0);
    expect(daysOverdue({ ...base, status: "void" }, "2026-08-01")).toBe(0);
    expect(daysOverdue({ ...base, status: "draft" }, "2026-08-01")).toBe(0);
  });
});

describe("what the invoice says it is", () => {
  const base = { amount_cents: 100000, due_date: "2026-08-10" };

  it("is overdue once the due date has passed", () => {
    expect(displayStatus({ ...base, status: "sent" }, "2026-08-11")).toBe("overdue");
    expect(displayStatus({ ...base, status: "sent" }, "2026-08-10")).toBe("sent");
  });

  it("is part paid when something came in but not all of it", () => {
    // A part payment is real life and must not round up to 'paid'.
    expect(
      displayStatus({ ...base, status: "sent", paid_amount_cents: 40000 }, "2026-08-01")
    ).toBe("part_paid");
  });

  it("part paid beats overdue — the money is the more useful fact", () => {
    expect(
      displayStatus({ ...base, status: "sent", paid_amount_cents: 40000 }, "2026-09-01")
    ).toBe("part_paid");
  });

  it("a draft is never overdue, however old", () => {
    // It hasn't been sent, so nobody is late.
    expect(displayStatus({ ...base, status: "draft" }, "2027-01-01")).toBe("draft");
  });

  it("paid and void are terminal", () => {
    expect(displayStatus({ ...base, status: "paid" }, "2027-01-01")).toBe("paid");
    expect(displayStatus({ ...base, status: "void" }, "2027-01-01")).toBe("void");
  });

  it("without a due date it is simply awaiting payment", () => {
    expect(displayStatus({ status: "sent", amount_cents: 1000 }, "2030-01-01")).toBe("sent");
  });
});

describe("what is still owed", () => {
  it("is the full amount when nothing has been paid", () => {
    expect(outstandingCents({ status: "sent", amount_cents: 100000 })).toBe(100000);
  });

  it("subtracts a part payment", () => {
    expect(
      outstandingCents({ status: "sent", amount_cents: 100000, paid_amount_cents: 40000 })
    ).toBe(60000);
  });

  it("is zero once paid or voided", () => {
    expect(outstandingCents({ status: "paid", amount_cents: 100000 })).toBe(0);
    expect(outstandingCents({ status: "void", amount_cents: 100000 })).toBe(0);
  });

  it("never goes negative on an overpayment", () => {
    expect(
      outstandingCents({ status: "sent", amount_cents: 1000, paid_amount_cents: 1500 })
    ).toBe(0);
  });
});

describe("reading the quote's stored lines", () => {
  it("takes the shape the generator writes", () => {
    expect(coerceLines([{ item: "Labour", price: "€450" }])).toEqual([
      { item: "Labour", price: "€450" },
    ]);
  });

  it("survives junk in the jsonb column", () => {
    expect(coerceLines(null)).toEqual([]);
    expect(coerceLines("nonsense")).toEqual([]);
    expect(coerceLines([null, 5, "x"])).toEqual([]);
    expect(coerceLines([{}])).toEqual([]);
  });
});

describe("quotes become invoices in one step", () => {
  const quote = (over: Partial<QuoteSource> = {}): QuoteSource => ({
    id: "q1",
    business_id: "b1",
    customer_name: "Mary Byrne",
    customer_email: "mary@example.ie",
    quote_lines: [
      { item: "Labour", price: "€450.00" },
      { item: "Materials", price: "€312.50" },
    ],
    total: "€762.50",
    status: "accepted",
    ...over,
  });
  const opts = { existingNumbers: ["INV-0003"], today: "2026-08-01" };

  it("builds a draft invoice from the accepted quote", () => {
    const r = buildInvoiceFromQuote(quote(), opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toMatchObject({
      business_id: "b1",
      quote_id: "q1",
      number: "INV-0004",
      customer_name: "Mary Byrne",
      customer_email: "mary@example.ie",
      amount_cents: 76250,
      due_date: "2026-08-15",
      status: "draft",
    });
    expect(r.warnings).toEqual([]);
  });

  it("refuses a quote that hasn't been accepted", () => {
    for (const status of ["draft", "sent", "viewed", "declined"]) {
      const r = buildInvoiceFromQuote(quote({ status }), opts);
      expect(r.ok, status).toBe(false);
    }
  });

  it("falls back to the quote total when there are no priced lines", () => {
    const r = buildInvoiceFromQuote(
      quote({ quote_lines: [], total: "€1,250" }),
      opts
    );
    expect(r.ok && r.row.amount_cents).toBe(125000);
  });

  it("REFUSES when neither the lines nor the total give an exact figure", () => {
    // An invoice for an invented amount is worse than no invoice.
    const r = buildInvoiceFromQuote(
      quote({ quote_lines: [], total: "price on application" }),
      opts
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/enter the amount/i);
  });

  it("refuses a range total rather than billing one end of it", () => {
    const r = buildInvoiceFromQuote(quote({ quote_lines: [], total: "€900-€1,200" }), opts);
    expect(r.ok).toBe(false);
  });

  it("warns, but proceeds, when SOME lines are unreadable", () => {
    const r = buildInvoiceFromQuote(
      quote({
        quote_lines: [
          { item: "Labour", price: "€450" },
          { item: "Skip hire", price: "TBC" },
        ],
      }),
      opts
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.amount_cents).toBe(45000);
    expect(r.warnings[0]).toContain("Skip hire");
    expect(r.warnings[0]).toMatch(/check the amount/i);
  });

  it("gives a nameless customer a usable name", () => {
    const r = buildInvoiceFromQuote(quote({ customer_name: "  " }), opts);
    expect(r.ok && r.row.customer_name).toBe("Customer");
  });

  it("carries no email rather than an empty string", () => {
    const r = buildInvoiceFromQuote(quote({ customer_email: "" }), opts);
    expect(r.ok && r.row.customer_email).toBeNull();
  });

  it("always starts as a draft — nothing is billed without a human sending it", () => {
    const r = buildInvoiceFromQuote(quote(), opts);
    expect(r.ok && r.row.status).toBe("draft");
  });
});

describe("the product is actually wired together", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const ACTIONS = readFileSync(
    path.join(ROOT, "app", "portal", "instant-quote-agent", "invoice-actions.ts"),
    "utf8"
  );
  const PAGE = readFileSync(
    path.join(ROOT, "app", "portal", "instant-quote-agent", "page.tsx"),
    "utf8"
  );
  const PUBLIC = readFileSync(path.join(ROOT, "app", "i", "[token]", "page.tsx"), "utf8");

  it("only offers to invoice an ACCEPTED quote", () => {
    // Billing for work a customer hasn't agreed to is not a shortcut worth
    // offering, and the builder refuses it server-side too.
    expect(PAGE).toContain('quote.status === "accepted"');
  });

  it("scopes every invoice query to the caller's business", () => {
    const scoped = ACTIONS.match(/\.eq\("business_id", businessId\)/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(5);
  });

  it("treats a duplicate-key race as success rather than an error", () => {
    // The unique index on quote_id is what actually prevents double-billing;
    // a second click should land on the invoice that already exists.
    expect(ACTIONS).toContain('error.code === "23505"');
  });

  it("stamps sent_at only AFTER the email succeeded", () => {
    const sendFn = ACTIONS.slice(ACTIONS.indexOf("export async function sendInvoice"));
    const send = sendFn.indexOf("resend.emails.send");
    const stamp = sendFn.indexOf('status: "sent", sent_at');
    expect(send).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(send);
  });

  it("uses an idempotency key so a double-click can't double-email", () => {
    expect(ACTIONS).toContain("idempotencyKey: `inv-${invoice.id}`");
  });

  it("only lets a DRAFT be repriced", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function setInvoiceAmount"));
    expect(fn).toContain('.eq("status", "draft")');
  });

  it("never deletes an invoice — voiding keeps the record", () => {
    expect(ACTIONS).not.toMatch(/from\("qa_invoices"\)\s*\n?\s*\.delete\(/);
    expect(ACTIONS).toContain('.neq("status", "paid")');
  });

  it("refuses to send a zero-amount invoice", () => {
    expect(ACTIONS).toContain("if (!invoice.amount_cents)");
  });

  it("records a part payment without marking it paid", () => {
    expect(ACTIONS).toContain("const fullyPaid = total >= invoice.amount_cents");
    expect(ACTIONS).toContain('status: fullyPaid ? "paid" : "sent"');
  });

  it("tells ClientIQ when an invoice is actually paid", () => {
    // A paid invoice is the strongest signal there is about a customer.
    expect(ACTIONS).toContain('from("crm_activities")');
    expect(ACTIONS).toContain("paid in full");
  });

  it("degrades cleanly when the migration hasn't been run", () => {
    expect(PAGE).toContain("isMissingTableError(invoiceResult.error)");
    expect(PAGE).toContain("invoicingReady");
  });

  it("the public page needs no login but validates the token shape", () => {
    expect(PUBLIC).toMatch(/\/\^\[0-9a-f-\]\{36\}\$\/i/);
    expect(PUBLIC).toContain("notFound()");
  });

  it("the public page is never cached or indexed", () => {
    // A stale "unpaid" after they've paid is a bad phone call.
    expect(PUBLIC).toContain('export const dynamic = "force-dynamic"');
    expect(PUBLIC).toContain("index: false");
  });

  it("the public page shows a part payment, so nobody pays twice", () => {
    expect(PUBLIC).toContain("Already paid");
    expect(PUBLIC).toContain("Still due");
  });

  it("a voided invoice does not read as a demand for money", () => {
    expect(PUBLIC).toContain("has been cancelled");
  });
});

describe("migration 0037", () => {
  const SQL = readFileSync(
    path.resolve(import.meta.dirname, "..", "..", "supabase", "migrations", "0037_invoices.sql"),
    "utf8"
  );

  it("is idempotent", () => {
    expect(SQL).toContain("create table if not exists qa_invoices");
    expect(SQL).toContain("create index if not exists");
  });

  it("stores money as an integer, not text or float", () => {
    expect(SQL).toMatch(/amount_cents integer not null/);
    expect(SQL).toMatch(/check \(amount_cents >= 0\)/);
  });

  it("makes double-billing a quote impossible at the database level", () => {
    expect(SQL).toMatch(/create unique index if not exists qa_invoices_quote_idx/);
  });

  it("keeps invoice numbers unique per business", () => {
    expect(SQL).toMatch(/unique index if not exists qa_invoices_business_number_idx/);
  });

  it("constrains status to the four real states", () => {
    expect(SQL).toMatch(/check \(status in \('draft', 'sent', 'paid', 'void'\)\)/);
  });

  it("enables RLS and scopes it to tenant members", () => {
    expect(SQL).toContain("enable row level security");
    expect(SQL).toContain("is_active_tenant_member (business_id)");
  });
});
