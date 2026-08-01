import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  shouldChase,
  chaseMessage,
  overdueDays,
  FIRST_CHASE_AFTER_DAYS,
  CHASE_GAP_DAYS,
  MAX_CHASES,
  type ChaseCandidate,
} from "@/lib/quote-agent/chase-rules";

/**
 * Automatic chasing for overdue invoices.
 *
 * /products/tradeiq: "Chasing is automatic rather than a job for a Sunday
 * evening." 0037 made invoices real; nothing chased them. An invoice could go
 * out, sail past its due date, and sit there forever with the platform silent.
 *
 * This decides whether to email a real customer about money with no human in
 * the loop, so every rule that stops it is as important as the one that starts
 * it. The sequence STOPPING is the most important rule of the lot: a business
 * that emails someone every day about €300 does more damage to the
 * relationship than the debt is worth.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const NOW = "2026-08-20T07:00:00.000Z";

const inv = (over: Partial<ChaseCandidate> = {}): ChaseCandidate => ({
  status: "sent",
  due_date: "2026-08-01",
  customer_email: "mary@example.ie",
  amount_cents: 125000,
  paid_amount_cents: null,
  last_chased_at: null,
  chase_count: 0,
  ...over,
});

describe("what is never chased", () => {
  it.each(["draft", "paid", "void"])("a %s invoice", (status) => {
    // A draft was never delivered; a paid one is settled; a void one was
    // cancelled. Chasing any of them is indefensible.
    const d = shouldChase(inv({ status }), NOW);
    expect(d.chase).toBe(false);
    expect(d.chase === false && d.reason).toContain(status);
  });

  it("an invoice with no due date", () => {
    expect(shouldChase(inv({ due_date: null }), NOW).chase).toBe(false);
  });

  it("an invoice with no email address", () => {
    expect(shouldChase(inv({ customer_email: null }), NOW).chase).toBe(false);
  });

  it("one that has actually been covered in full by part payments", () => {
    expect(
      shouldChase(inv({ amount_cents: 100000, paid_amount_cents: 100000 }), NOW).chase
    ).toBe(false);
    expect(
      shouldChase(inv({ amount_cents: 100000, paid_amount_cents: 120000 }), NOW).chase
    ).toBe(false);
  });

  it("a zero-amount invoice", () => {
    expect(shouldChase(inv({ amount_cents: 0 }), NOW).chase).toBe(false);
  });
});

describe("the grace period", () => {
  it(`waits ${FIRST_CHASE_AFTER_DAYS} days past the due date`, () => {
    // Chasing the morning after is how you look like a debt collector for
    // something the post might still be delivering.
    expect(shouldChase(inv({ due_date: "2026-08-20" }), NOW).chase).toBe(false);
    expect(shouldChase(inv({ due_date: "2026-08-19" }), NOW).chase).toBe(false);
    expect(shouldChase(inv({ due_date: "2026-08-17" }), NOW).chase).toBe(true);
  });

  it("says how overdue it actually is when it declines", () => {
    const d = shouldChase(inv({ due_date: "2026-08-19" }), NOW);
    expect(d.chase === false && d.reason).toMatch(/1 day overdue/);
  });
});

describe("the sequence stops", () => {
  it(`sends at most ${MAX_CHASES} reminders, ever`, () => {
    expect(shouldChase(inv({ chase_count: MAX_CHASES - 1 }), NOW).chase).toBe(true);
    expect(shouldChase(inv({ chase_count: MAX_CHASES }), NOW).chase).toBe(false);
    expect(shouldChase(inv({ chase_count: MAX_CHASES + 5 }), NOW).chase).toBe(false);
  });

  it("says a human should take it from there", () => {
    const d = shouldChase(inv({ chase_count: MAX_CHASES }), NOW);
    expect(d.chase === false && d.reason).toMatch(/phone call/i);
  });
});

describe("the spacing widens each time", () => {
  it("leaves a gap after the first reminder", () => {
    const justChased = inv({ chase_count: 1, last_chased_at: "2026-08-19T07:00:00Z" });
    expect(shouldChase(justChased, NOW).chase).toBe(false);
  });

  it("chases again once the gap has passed", () => {
    const chasedLongAgo = inv({ chase_count: 1, last_chased_at: "2026-08-10T07:00:00Z" });
    expect(shouldChase(chasedLongAgo, NOW).chase).toBe(true);
  });

  it("widens as the count rises", () => {
    for (let i = 1; i < CHASE_GAP_DAYS.length; i++) {
      expect(CHASE_GAP_DAYS[i]).toBeGreaterThan(CHASE_GAP_DAYS[i - 1]);
    }
  });

  it("uses the wider gap for a second reminder than a first", () => {
    const at = (days: number) =>
      new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
    // 5 days since: past the 3-day gap for count 1, short of the 7 for count 2.
    expect(shouldChase(inv({ chase_count: 1, last_chased_at: at(5) }), NOW).chase).toBe(true);
    expect(shouldChase(inv({ chase_count: 2, last_chased_at: at(5) }), NOW).chase).toBe(false);
  });

  it("reports how recently it was chased when it declines", () => {
    const d = shouldChase(inv({ chase_count: 1, last_chased_at: "2026-08-19T07:00:00Z" }), NOW);
    expect(d.chase === false && d.reason).toMatch(/chased 1 day ago/);
  });
});

describe("the first chase", () => {
  it("goes out for a never-chased overdue invoice", () => {
    const d = shouldChase(inv(), NOW);
    expect(d).toEqual({ chase: true, nextCount: 1 });
  });

  it("increments the count", () => {
    const d = shouldChase(inv({ chase_count: 1, last_chased_at: "2026-08-01T07:00:00Z" }), NOW);
    expect(d.chase === true && d.nextCount).toBe(2);
  });

  it("treats a missing chase_count as never chased", () => {
    expect(shouldChase(inv({ chase_count: null }), NOW)).toEqual({ chase: true, nextCount: 1 });
  });
});

describe("what the customer reads", () => {
  const base = {
    customerName: "Mary",
    businessName: "Walsh Joinery",
    invoiceNumber: "INV-0007",
    amountLabel: "€1,250.00",
    daysOverdue: 12,
    link: "https://automateiq.ie/i/abc",
    partPaid: false,
  };

  it("is gentle first", () => {
    const m = chaseMessage({ ...base, chaseNumber: 1 });
    expect(m.text).toMatch(/gentle reminder/i);
    expect(m.text).toMatch(/it happens/i);
  });

  it("firms up, without turning rude", () => {
    const third = chaseMessage({ ...base, chaseNumber: 3 });
    expect(third.text).toMatch(/last automatic reminder/i);
    // The third message still has to be one you'd be happy to have forwarded.
    expect(third.text).not.toMatch(/immediately|legal|demand|failure to pay|debt collect/i);
    expect(third.text).toMatch(/quick call/i);
  });

  it("always carries the amount, the number and the link", () => {
    for (const n of [1, 2, 3]) {
      const m = chaseMessage({ ...base, chaseNumber: n });
      expect(m.text, `chase ${n}`).toContain("INV-0007");
      expect(m.text, `chase ${n}`).toContain("€1,250.00");
      expect(m.text, `chase ${n}`).toContain("https://automateiq.ie/i/abc");
      expect(m.subject, `chase ${n}`).toContain("INV-0007");
    }
  });

  it("thanks a customer who has already part paid", () => {
    const m = chaseMessage({ ...base, chaseNumber: 2, partPaid: true });
    expect(m.text).toMatch(/thanks for the payment already made/i);
    expect(m.text).toMatch(/remaining balance/i);
  });

  it("offers a way to say it's already paid", () => {
    // The commonest reason an invoice looks unpaid is that it was paid and
    // nobody recorded it.
    expect(chaseMessage({ ...base, chaseNumber: 2 }).text).toMatch(/already been paid/i);
  });

  it("invites a reply rather than being a no-reply blast", () => {
    expect(chaseMessage({ ...base, chaseNumber: 1 }).text).toMatch(/reply to this email/i);
  });
});

describe("counting days overdue", () => {
  it("counts whole days", () => {
    expect(overdueDays("2026-08-01", NOW)).toBe(19);
  });

  it("is never negative for a future due date", () => {
    expect(overdueDays("2026-12-01", NOW)).toBe(0);
  });
});

describe("the runner is safe with real customers' inboxes", () => {
  const SRC = readFileSync(path.join(ROOT, "lib", "cron", "invoice-chaser.ts"), "utf8");

  it("only ever looks at SENT invoices past their due date", () => {
    expect(SRC).toContain('.eq("status", "sent")');
    expect(SRC).toContain('.lt("due_date", today)');
  });

  it("records the chase only AFTER the email actually sent", () => {
    // Stamping first marks an invoice chased that nobody was emailed about,
    // and it is then never picked up again.
    const send = SRC.indexOf("resend.emails.send");
    const mark = SRC.indexOf("last_chased_at: nowISO");
    expect(send).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(send);
  });

  it("shouts when the email went but the record didn't", () => {
    // The next run would otherwise send it again — worse than not chasing.
    expect(SRC).toContain("sent but not recorded");
  });

  it("caps how many reminders one run can send", () => {
    expect(SRC).toContain("PER_RUN_CAP");
    expect(SRC).toMatch(/if \(chased >= PER_RUN_CAP\)/);
  });

  it("is idempotency-keyed per invoice AND per chase number", () => {
    expect(SRC).toContain("`chase-${invoice.id}-${decision.nextCount}`");
  });

  it("can be switched off without a deploy", () => {
    expect(SRC).toContain("QUOTEIQ_AUTOCHASE");
  });

  it("goes quiet rather than erroring when the migrations aren't run", () => {
    expect(SRC).toContain("isMissingTableError(error)");
    expect(SRC).toContain("run migrations 0037 and 0038");
  });

  it("delegates every decision to the shared rules", () => {
    expect(SRC).toContain("shouldChase(invoice, nowISO)");
  });
});

describe("the 07:00 dispatch stays safe", () => {
  const ROUTE = readFileSync(
    path.join(ROOT, "app", "api", "cron", "dispatch", "route.ts"),
    "utf8"
  );

  it("runs the chaser OFF the critical path", () => {
    // qa_invoices and businesses are disjoint from the ge_* tables every
    // sequential task uses, so there is nothing to race — and its outbound
    // emails must not eat the 60-second budget the brief also needs.
    expect(ROUTE).toContain('isolated("invoiceChaser", runInvoiceChaser)');
    expect(ROUTE).toContain("const invoiceChasePromise");
  });

  it("still settles it before responding, so a failure is reported", () => {
    expect(ROUTE).toContain("await invoiceChasePromise");
  });

  it("reports it alongside the other tasks", () => {
    expect(ROUTE).toMatch(/tasks: \{[^}]*invoiceChaser/);
  });

  it("leaves the load-bearing sequential order untouched", () => {
    const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const order = ["bookingSync", "autoQueue", "autoFollowups", "emailAutopilot", "jarvisBrief"]
      .map((t) => code.indexOf(`isolated("${t}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });
});

describe("migration 0038", () => {
  const SQL = readFileSync(
    path.join(ROOT, "supabase", "migrations", "0038_invoice_chasing.sql"),
    "utf8"
  );

  it("is idempotent", () => {
    expect(SQL).toContain("add column if not exists last_chased_at");
    expect(SQL).toContain("add column if not exists chase_count");
    expect(SQL).toContain("create index if not exists");
  });

  it("leaves every existing invoice reading as never chased", () => {
    expect(SQL).toMatch(/last_chased_at timestamptz;/);
    expect(SQL).toMatch(/chase_count integer not null default 0/);
  });

  it("indexes what the chaser orders by, partial on chaseable rows", () => {
    expect(SQL).toMatch(/\(due_date, last_chased_at nulls first\)/);
    expect(SQL).toMatch(/where status = 'sent'/);
  });
});
