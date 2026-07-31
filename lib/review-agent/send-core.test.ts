import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Review requests and duplicate customers (register item K4 — and a second,
 * worse bug found sitting beside it).
 *
 * K4 as recorded: `ra_customers` had no dedupe, so a new row was inserted on
 * every send. The Customers page listed the same person once per review
 * request ever sent to them, and the per-customer request and click counts
 * underneath were split across those rows — so nobody's real history was
 * visible anywhere. Recorded as "annoyance, looks sloppy".
 *
 * WHAT WAS ALSO THERE: the duplicate-send guard matched the email with a
 * plain `.eq()`, which is byte-for-byte. Re-typing "Mary.Byrne@gmail.com" a
 * minute after "mary.byrne@gmail.com" walked straight past it and sent a
 * SECOND review request — from the tradesperson's own sending identity, to
 * their own customer. That is not an annoyance. It is the same hole already
 * closed in /api/book and /api/lead, still open here.
 */

const SRC = readFileSync(
  path.resolve(import.meta.dirname, "send-core.ts"),
  "utf8"
);

describe("the duplicate-send guard", () => {
  it("matches the email case-insensitively", () => {
    expect(SRC).toMatch(/\.ilike\("ra_customers\.email", escapeLike\(customerEmail\)\)/);
  });

  it("no longer compares byte-for-byte", () => {
    expect(SRC).not.toMatch(/\.eq\("ra_customers\.email"/);
  });

  it("escapes the wildcards, because % and _ are legal in a local part", () => {
    expect(SRC).toContain("escapeLike");
  });

  it("still only blocks a genuinely recent request", () => {
    // A guard that blocked forever would stop a business asking the same
    // customer for a review after a second job months later.
    expect(SRC).toContain("fiveMinutesAgo");
    expect(SRC).toMatch(/created_at > fiveMinutesAgo/);
  });

  it("still only blocks one that is pending or sent", () => {
    // A failed send must be retryable.
    expect(SRC).toMatch(/\["pending", "sent"\]\.includes\(recentRequest\.status\)/);
  });
});

describe("the customer row is reused, not duplicated", () => {
  it("looks for an existing customer before inserting", () => {
    expect(SRC).toMatch(/from\("ra_customers"\)[\s\S]{0,200}\.eq\("business_id", businessId\)/);
    expect(SRC).toMatch(/\.ilike\("email", escapeLike\(customerEmail\)\)/);
  });

  it("scopes the lookup by business, because the table is multi-tenant", () => {
    // Two businesses can legitimately have the same customer, and matching on
    // email alone would hand one tenant's row to another.
    const lookup = SRC.slice(SRC.indexOf("existingCustomer"), SRC.indexOf("let customer"));
    expect(lookup).toContain('eq("business_id", businessId)');
  });

  it("takes the oldest match, so the row a customer's history hangs off is stable", () => {
    expect(SRC).toMatch(/order\("created_at", \{ ascending: true \}\)/);
  });

  it("only inserts when there is genuinely no existing row", () => {
    expect(SRC).toMatch(/} else \{[\s\S]{0,200}\.from\("ra_customers"\)[\s\S]{0,120}\.insert\(/);
  });

  it("lets a corrected name stick on a later send", () => {
    // Otherwise the review email keeps greeting them by the name that was
    // wrong the first time.
    expect(SRC).toMatch(/customerName !== existingCustomer\.name/);
    expect(SRC).toMatch(/\.update\(\{ name: customerName \}\)/);
  });

  it("still fails loudly if the customer cannot be saved at all", () => {
    // Sending a review request with no customer row would leave a request
    // pointing at nothing.
    expect(SRC).toContain('Could not save customer.');
  });
});

describe("the replay that made the case", () => {
  // Six sends to two real people over ten days, with the address typed as it
  // came to hand. Kept as an executable statement of the behaviour.
  const SENDS = [
    ["2026-07-06T09:02", "mary.byrne@gmail.com"],
    ["2026-07-06T09:03", "Mary.Byrne@gmail.com"],
    ["2026-07-07T11:40", "tom@walshjoinery.ie"],
    ["2026-07-10T16:20", "mary.byrne@gmail.com"],
    ["2026-07-13T08:15", "TOM@walshjoinery.ie"],
    ["2026-07-15T14:00", "MARY.BYRNE@GMAIL.COM"],
  ] as const;
  const FIVE_MIN = 5 * 60 * 1000;

  function replay(opts: { caseInsensitive: boolean; reuseRow: boolean }) {
    const customers: string[] = [];
    const requests: { email: string; at: number }[] = [];
    let sent = 0;
    const norm = (e: string) => (opts.caseInsensitive ? e.toLowerCase() : e);
    for (const [t, email] of SENDS) {
      const at = Date.parse(`${t}:00Z`);
      const prior = requests
        .filter((r) => norm(r.email) === norm(email))
        .sort((a, b) => b.at - a.at)[0];
      if (prior && at - prior.at < FIVE_MIN) continue;
      const known = opts.reuseRow
        ? customers.some((c) => c.toLowerCase() === email.toLowerCase())
        : false;
      if (!known) customers.push(email);
      requests.push({ email, at });
      sent++;
    }
    return { rows: customers.length, sent };
  }

  it("collapsed six customer rows into the two real people", () => {
    expect(replay({ caseInsensitive: false, reuseRow: false }).rows).toBe(6);
    expect(replay({ caseInsensitive: true, reuseRow: true }).rows).toBe(2);
  });

  it("blocked the one-minute re-send, and only that one", () => {
    expect(replay({ caseInsensitive: false, reuseRow: false }).sent).toBe(6);
    expect(replay({ caseInsensitive: true, reuseRow: true }).sent).toBe(5);
  });

  it("still sends to the same customer again days later", () => {
    // The fix must not turn a duplicate guard into a permanent block.
    const late = replay({ caseInsensitive: true, reuseRow: true });
    expect(late.sent).toBeGreaterThan(late.rows);
  });
});
