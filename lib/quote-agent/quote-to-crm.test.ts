import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseQuoteTotal,
  decisionNote,
  syncQuoteDecisionToCrm,
  type QuoteForCrm,
} from "@/lib/quote-agent/quote-to-crm";

/**
 * A customer accepting a quote used to produce nothing.
 *
 * The status flipped to 'accepted', an email told the owner "time to get the
 * job booked in", and that was the end of it. The single highest-value event
 * in the platform — a customer saying YES to a price — left no record anywhere
 * except the quote row.
 *
 * So ClientIQ, sold as "every customer and lead in one place, searchable and
 * up to date", did not know about the customer who had just agreed to pay. Win
 * five jobs in a week and the CRM showed nothing. That is the difference
 * between a set of separate tools and a platform, and it sat on the one event
 * that matters most.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const quote = (over: Partial<QuoteForCrm> = {}): QuoteForCrm => ({
  id: "q1",
  business_id: "b1",
  customer_name: "Mary Byrne",
  customer_email: "mary@example.ie",
  total: "€1,250.00",
  job_description: "Bathroom refit",
  ...over,
});

/** Minimal fake of the two tables this touches. */
function fakeDb(opts: { existing?: Record<string, unknown> | null } = {}) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        ilike: self,
        is: self,
        maybeSingle: async () => {
          calls.push({ table, op: "select" });
          return { data: table === "crm_contacts" ? (opts.existing ?? null) : null };
        },
        insert(payload: unknown) {
          calls.push({ table, op: "insert", payload });
          return {
            select: () => ({ single: async () => ({ data: { id: "new-contact" }, error: null }) }),
            then: undefined,
            // crm_activities inserts are awaited directly
            ...(table === "crm_activities" ? {} : {}),
          } as never;
        },
        update(payload: unknown) {
          calls.push({ table, op: "update", payload });
          return { eq: async () => ({ error: null }) } as never;
        },
      });
      // crm_activities.insert() is awaited directly, not .select()ed
      if (table === "crm_activities") {
        chain.insert = (payload: unknown) => {
          calls.push({ table, op: "insert", payload });
          return Promise.resolve({ error: null }) as never;
        };
      }
      return chain as never;
    },
  };
  return { admin: admin as never, calls };
}

describe("reading a money figure out of free text", () => {
  it.each([
    ["€1,250.00", 1250],
    ["1250", 1250],
    ["€900", 900],
    ["  €2,499.99  ", 2499.99],
    ["from €900", 900],
    ["1,000,000", 1000000],
  ])("%s → %s", (input, expected) => {
    expect(parseQuoteTotal(input)).toBe(expected);
  });

  it("takes the low end of a range", () => {
    // Understating the pipeline is the safe direction; overstating it makes
    // every dashboard that sums value quietly wrong.
    expect(parseQuoteTotal("900-1200")).toBe(900);
    expect(parseQuoteTotal("€900 - €1,200")).toBe(900);
  });

  it.each([null, undefined, "", "   ", "TBC", "on application", "-"])(
    "returns null rather than guessing for %s",
    (input) => {
      expect(parseQuoteTotal(input)).toBeNull();
    }
  );

  it("refuses a negative total", () => {
    expect(parseQuoteTotal("-500")).toBeNull();
  });
});

describe("what lands on the customer's timeline", () => {
  it("says it was won, with the amount", () => {
    const note = decisionNote("accepted", { total: "€1,250", job_description: "Bathroom refit" });
    expect(note).toContain("accepted");
    expect(note).toContain("€1,250");
    expect(note).toContain("Bathroom refit");
    expect(note).toContain("QuoteIQ");
  });

  it("records a decline too", () => {
    expect(decisionNote("declined", { total: "€400", job_description: null })).toContain("declined");
  });

  it("survives a missing total and job", () => {
    const note = decisionNote("accepted", { total: null, job_description: null });
    expect(note).toContain("accepted");
    expect(note).not.toContain("undefined");
    expect(note).not.toContain("null");
  });

  it("truncates a rambling job description", () => {
    const note = decisionNote("accepted", { total: null, job_description: "x".repeat(400) });
    expect(note.length).toBeLessThan(200);
    expect(note).toContain("…");
  });
});

describe("a won quote becomes a real customer record", () => {
  it("creates the contact when there isn't one", async () => {
    const { admin, calls } = fakeDb({ existing: null });
    const res = await syncQuoteDecisionToCrm(admin, quote(), "accepted");
    expect(res).toMatchObject({ ok: true, created: true, stage: "won" });
    const insert = calls.find((c) => c.table === "crm_contacts" && c.op === "insert");
    expect(insert?.payload).toMatchObject({
      business_id: "b1",
      name: "Mary Byrne",
      email: "mary@example.ie",
      stage: "won",
      value: 1250,
      source: "QuoteIQ",
    });
  });

  it("updates an existing contact instead of duplicating them", async () => {
    const { admin, calls } = fakeDb({
      existing: { id: "c1", stage: "contacted", notes: "", value: 0 },
    });
    const res = await syncQuoteDecisionToCrm(admin, quote(), "accepted");
    expect(res).toMatchObject({ ok: true, created: false, stage: "won" });
    expect(calls.some((c) => c.table === "crm_contacts" && c.op === "insert")).toBe(false);
  });

  it("writes the decision to the timeline", async () => {
    const { admin, calls } = fakeDb({ existing: null });
    await syncQuoteDecisionToCrm(admin, quote(), "accepted");
    const activity = calls.find((c) => c.table === "crm_activities");
    expect(activity?.payload).toMatchObject({ business_id: "b1", type: "won" });
  });

  it("still records a customer who was quoted without an email", async () => {
    // Losing the record of a won job because nobody typed an address would be
    // the worst possible trade.
    const { admin, calls } = fakeDb({ existing: null });
    const res = await syncQuoteDecisionToCrm(
      admin,
      quote({ customer_email: null }),
      "accepted"
    );
    expect(res.ok).toBe(true);
    const insert = calls.find((c) => c.table === "crm_contacts" && c.op === "insert");
    expect(insert?.payload).toMatchObject({ email: null, stage: "won" });
  });

  it("falls back to a usable name when none was given", async () => {
    const { admin, calls } = fakeDb({ existing: null });
    await syncQuoteDecisionToCrm(admin, quote({ customer_name: "  " }), "accepted");
    const insert = calls.find((c) => c.table === "crm_contacts" && c.op === "insert");
    expect((insert?.payload as { name: string }).name).toBe("Customer");
  });
});

describe("a decline never erases a won customer", () => {
  it("marks a fresh contact lost", async () => {
    const { admin } = fakeDb({ existing: { id: "c1", stage: "contacted", notes: "", value: 0 } });
    const res = await syncQuoteDecisionToCrm(admin, quote(), "declined");
    expect(res).toMatchObject({ ok: true, stage: "lost" });
  });

  it("leaves an already-WON contact won", async () => {
    // Accepted a bathroom in March, declines a boiler in June — still a won
    // customer. Flipping them to 'lost' would delete that fact from the only
    // place it is recorded.
    const { admin } = fakeDb({ existing: { id: "c1", stage: "won", notes: "", value: 3000 } });
    const res = await syncQuoteDecisionToCrm(admin, quote(), "declined");
    expect(res).toMatchObject({ ok: true, stage: "won" });
  });

  it("does not lower a recorded value on a smaller later job", async () => {
    const { admin, calls } = fakeDb({ existing: { id: "c1", stage: "won", notes: "", value: 5000 } });
    await syncQuoteDecisionToCrm(admin, quote({ total: "€500" }), "accepted");
    const update = calls.find((c) => c.table === "crm_contacts" && c.op === "update");
    expect((update?.payload as { value: number }).value).toBe(5000);
  });

  it("raises the value when the new job is bigger", async () => {
    const { admin, calls } = fakeDb({ existing: { id: "c1", stage: "won", notes: "", value: 500 } });
    await syncQuoteDecisionToCrm(admin, quote({ total: "€5,000" }), "accepted");
    const update = calls.find((c) => c.table === "crm_contacts" && c.op === "update");
    expect((update?.payload as { value: number }).value).toBe(5000);
  });
});

describe("it can never break the customer's acceptance", () => {
  it("returns a failure instead of throwing", async () => {
    const exploding = {
      from() {
        throw new Error("database on fire");
      },
    } as never;
    const res = await syncQuoteDecisionToCrm(exploding, quote(), "accepted");
    expect(res).toEqual({ ok: false, reason: "database on fire" });
  });

  it("reports a write failure rather than claiming a clean sync", async () => {
    const failing = {
      from: () => ({
        select: function () { return this; },
        eq: function () { return this; },
        ilike: function () { return this; },
        is: function () { return this; },
        maybeSingle: async () => ({ data: null }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: "permission denied" } }),
          }),
        }),
      }),
    } as never;
    const res = await syncQuoteDecisionToCrm(failing, quote(), "accepted");
    expect(res.ok).toBe(false);
  });
});

describe("the accept endpoint is wired to it", () => {
  const ROUTE = readFileSync(
    path.join(ROOT, "app", "api", "q", "[token]", "route.ts"),
    "utf8"
  );

  it("calls the sync after the decision is committed", () => {
    const decide = ROUTE.indexOf('.update({ status: newStatus');
    const sync = ROUTE.indexOf("syncQuoteDecisionToCrm(admin, quote, newStatus)");
    expect(sync).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(decide);
  });

  it("selects the fields the sync needs", () => {
    // customer_email and job_description weren't fetched before — without them
    // the contact would have been created blank.
    expect(ROUTE).toContain("customer_email");
    expect(ROUTE).toContain("job_description");
  });

  it("logs a failure but does not fail the request", () => {
    expect(ROUTE).toMatch(/if \(!crmSync\.ok\)/);
    expect(ROUTE).toContain("console.error");
    const sync = ROUTE.indexOf("crmSync");
    const errorReturn = ROUTE.indexOf('return NextResponse.json({ error: "Update failed" }');
    // The only error return is the one for the quote update itself, above.
    expect(errorReturn).toBeLessThan(sync);
  });

  it("still returns the decision to the customer", () => {
    expect(ROUTE).toMatch(/return NextResponse\.json\(\{ ok: true/);
  });
});
