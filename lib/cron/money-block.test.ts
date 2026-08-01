import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { summariseMoney, formatMoneyBlock, type MoneyInvoice } from "@/lib/cron/money-block";

/**
 * Money in the morning brief.
 *
 * The brief has always covered leads, replies and overnight fixes and said
 * NOTHING about money. Jude reads it at 07:00 every day and it could not tell
 * him a customer had paid, that thousands were sitting unpaid, or that the
 * oldest invoice was six weeks late.
 *
 * Worse since the chaser shipped: the engine now emails real customers about
 * overdue money every morning and the brief said nothing about that either.
 * Automated machinery that contacts customers while being invisible to the
 * person responsible for those customers is how a relationship gets damaged
 * before anyone notices.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const NOW = "2026-08-20T07:00:00.000Z";

const inv = (over: Partial<MoneyInvoice> = {}): MoneyInvoice => ({
  number: "INV-0001",
  customer_name: "Mary Byrne",
  amount_cents: 100000,
  paid_amount_cents: null,
  currency: "EUR",
  status: "sent",
  due_date: "2026-08-01",
  paid_at: null,
  chase_count: 0,
  ...over,
});

describe("what counts as outstanding", () => {
  it("sums sent, unpaid invoices", () => {
    const s = summariseMoney([inv(), inv({ number: "INV-2", amount_cents: 50000 })], NOW);
    expect(s.outstandingCents).toBe(150000);
    expect(s.outstandingCount).toBe(2);
  });

  it("ignores drafts — nothing was ever delivered", () => {
    const s = summariseMoney([inv({ status: "draft" })], NOW);
    expect(s.outstandingCount).toBe(0);
  });

  it("ignores voided invoices — they were cancelled", () => {
    const s = summariseMoney([inv({ status: "void" })], NOW);
    expect(s.outstandingCount).toBe(0);
  });

  it("counts only the BALANCE of a part-paid invoice", () => {
    const s = summariseMoney([inv({ amount_cents: 100000, paid_amount_cents: 60000 })], NOW);
    expect(s.outstandingCents).toBe(40000);
  });

  it("drops one that part payments have fully covered", () => {
    const s = summariseMoney([inv({ amount_cents: 100000, paid_amount_cents: 100000 })], NOW);
    expect(s.outstandingCount).toBe(0);
  });
});

describe("overdue is a subset, not a separate list", () => {
  it("counts only what is past its due date", () => {
    const s = summariseMoney(
      [inv({ due_date: "2026-08-01" }), inv({ number: "INV-2", due_date: "2026-09-01" })],
      NOW
    );
    expect(s.outstandingCount).toBe(2);
    expect(s.overdueCount).toBe(1);
    expect(s.overdueCents).toBe(100000);
  });

  it("picks the LONGEST overdue as the one worth naming", () => {
    const s = summariseMoney(
      [
        inv({ number: "INV-A", due_date: "2026-08-15", customer_name: "Recent" }),
        inv({ number: "INV-B", due_date: "2026-07-01", customer_name: "Ancient" }),
      ],
      NOW
    );
    expect(s.worst?.number).toBe("INV-B");
    expect(s.worst?.customer).toBe("Ancient");
    expect(s.worst?.days).toBe(50);
  });

  it("has no worst when nothing is late", () => {
    expect(summariseMoney([inv({ due_date: "2026-12-01" })], NOW).worst).toBeNull();
  });
});

describe("payments are news only while they are news", () => {
  it("counts one paid in the last 24 hours", () => {
    const s = summariseMoney(
      [inv({ status: "paid", paid_at: "2026-08-19T18:00:00Z", paid_amount_cents: 100000 })],
      NOW
    );
    expect(s.paidCount).toBe(1);
    expect(s.paidCents).toBe(100000);
  });

  it("ignores one paid last month", () => {
    // An invoice paid in July is not this morning's good news.
    const s = summariseMoney([inv({ status: "paid", paid_at: "2026-07-01T10:00:00Z" })], NOW);
    expect(s.paidCount).toBe(0);
  });

  it("a paid invoice is never also counted as outstanding", () => {
    const s = summariseMoney(
      [inv({ status: "paid", paid_at: "2026-08-19T18:00:00Z" })],
      NOW
    );
    expect(s.outstandingCount).toBe(0);
  });
});

describe("the handover to a human", () => {
  it("flags invoices the engine has stopped chasing", () => {
    // The chaser stops at three reminders on purpose. Without this line those
    // invoices go quiet forever and nobody ever picks up the phone.
    const s = summariseMoney([inv({ chase_count: 3 })], NOW);
    expect(s.needsCall).toHaveLength(1);
    expect(s.needsCall[0].customer).toBe("Mary Byrne");
  });

  it("does not flag one still inside the sequence", () => {
    expect(summariseMoney([inv({ chase_count: 2 })], NOW).needsCall).toHaveLength(0);
  });

  it("does not flag one that isn't overdue at all", () => {
    expect(
      summariseMoney([inv({ chase_count: 3, due_date: "2026-12-01" })], NOW).needsCall
    ).toHaveLength(0);
  });
});

describe("the block only appears when it has something to say", () => {
  it("is empty when there is no money news at all", () => {
    // A heading over "€0 outstanding" is noise, and noise in a daily email is
    // how the whole brief stops being read.
    expect(formatMoneyBlock(summariseMoney([], NOW))).toBe("");
    expect(formatMoneyBlock(summariseMoney([inv({ status: "draft" })], NOW))).toBe("");
  });

  it("leads with getting paid", () => {
    const block = formatMoneyBlock(
      summariseMoney(
        [
          inv({ status: "paid", paid_at: "2026-08-19T18:00:00Z", paid_amount_cents: 100000 }),
          inv({ number: "INV-2", amount_cents: 50000 }),
        ],
        NOW
      )
    );
    const lines = block.split("\n");
    expect(lines[0]).toContain("MONEY");
    expect(lines[1]).toContain("paid in the last 24h");
  });

  it("shows real money, formatted", () => {
    const block = formatMoneyBlock(summariseMoney([inv({ amount_cents: 125050 })], NOW));
    expect(block).toContain("€1,250.50");
  });

  it("says plainly when nothing is overdue", () => {
    const block = formatMoneyBlock(summariseMoney([inv({ due_date: "2026-12-01" })], NOW));
    expect(block).toContain("none overdue");
  });

  it("names the oldest debt, with how late it is", () => {
    const block = formatMoneyBlock(summariseMoney([inv({ due_date: "2026-07-01" })], NOW));
    expect(block).toMatch(/Oldest: INV-0001 — Mary Byrne/);
    expect(block).toMatch(/50 days late/);
  });

  it("reports what the chaser did this morning", () => {
    const block = formatMoneyBlock(summariseMoney([inv()], NOW), {
      chased: 4,
      detail: "chased 4",
    });
    expect(block).toContain("Chased 4 automatically this morning");
  });

  it("appears for chaser activity even with nothing else to report", () => {
    expect(formatMoneyBlock(summariseMoney([], NOW), { chased: 2, detail: "" })).toContain(
      "MONEY"
    );
  });

  it("asks for a phone call on the ones it gave up on", () => {
    const block = formatMoneyBlock(summariseMoney([inv({ chase_count: 3 })], NOW));
    expect(block).toMatch(/needs a call/i);
    expect(block).toContain("Mary Byrne");
  });

  it("truncates a long call list rather than dumping it", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      inv({ number: `INV-${i}`, customer_name: `Cust ${i}`, chase_count: 3 })
    );
    const block = formatMoneyBlock(summariseMoney(many, NOW));
    expect(block).toContain("6 past automatic chasing");
    expect(block).toContain("…");
  });
});

describe("it is wired into the brief without disturbing it", () => {
  const BRIEF = readFileSync(path.join(ROOT, "lib", "cron", "jarvis-morning-brief.ts"), "utf8");

  it("loads and renders the block", () => {
    expect(BRIEF).toContain("loadMoneySummary(admin");
    expect(BRIEF).toContain("formatMoneyBlock(moneySummary)");
  });

  it("appears in BOTH the weekday and the weekend brief", () => {
    // Money owed doesn't stop mattering on a Saturday.
    expect(BRIEF.match(/moneyBlock,/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("vanishes entirely when invoicing isn't set up", () => {
    // Reporting zeros would read as "nothing is owed to you", which is a very
    // different and much worse statement than "not configured".
    expect(BRIEF).toContain("moneySummary ? formatMoneyBlock");
    const SRC = readFileSync(path.join(ROOT, "lib", "cron", "money-block.ts"), "utf8");
    expect(SRC).toContain("if (isMissingTableError(error)) return null");
  });

  it("leaves the existing blocks in place — nothing was removed", () => {
    for (const marker of [
      "nightlyBlock",
      "deliveryBlock",
      "OVERNIGHT REPLIES",
      "STILL WAITING ON YOU",
    ]) {
      expect(BRIEF, marker).toContain(marker);
    }
  });
});
