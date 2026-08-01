import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  decideAutoRequest,
  requestName,
  autoRequestSummary,
  MAX_JOB_AGE_DAYS,
  ASK_COOLDOWN_DAYS,
  PER_RUN_CAP,
  type AutoRequestInvoice,
  type AutoRequestContext,
} from "@/lib/review-agent/auto-request";

/**
 * ReputationIQ sells "ask while the job is still fresh — send the request the
 * day you finish, when goodwill is at its highest." Everything about that was
 * built except the part that matters: somebody had to remember to press Send,
 * on the day, for every job. On the evening of a long week nobody does.
 *
 * QuoteIQ knows when a job finished, because the business marks the invoice
 * paid. This decides whether that becomes a review request — and it sends
 * email from a customer's own identity to THEIR customers with no human in
 * the loop, so every rule below is a refusal.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const NOW = new Date("2026-08-10T07:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000).toISOString();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const invoice = (over: Partial<AutoRequestInvoice> = {}): AutoRequestInvoice => ({
  id: "inv-1",
  business_id: "biz-1",
  customer_name: "Mary Byrne",
  customer_email: "mary@example.ie",
  status: "paid",
  paid_at: daysAgo(1),
  review_requested_at: null,
  ...over,
});

const ctx = (over: Partial<AutoRequestContext> = {}): AutoRequestContext => ({
  optedIn: true,
  lastAskedAt: null,
  hasReviewed: false,
  ...over,
});

const why = (i: AutoRequestInvoice, c: AutoRequestContext = ctx()) => {
  const d = decideAutoRequest(i, c, NOW);
  return d.send ? "" : d.reason;
};

describe("the ordinary case", () => {
  it("asks about a job paid yesterday", () => {
    expect(decideAutoRequest(invoice(), ctx(), NOW)).toEqual({ send: true });
  });

  it("asks about a job paid this morning, once it is old enough", () => {
    expect(decideAutoRequest(invoice({ paid_at: hoursAgo(10) }), ctx(), NOW)).toEqual({
      send: true,
    });
  });
});

describe("switching it on cannot reach backwards", () => {
  it("REFUSES a job that finished before the window", () => {
    // THE guard. Without it, the first morning after a business ticks the box,
    // every customer they have ever invoiced gets an email at once — from
    // their address, about jobs from a year ago, unrecallable.
    expect(why(invoice({ paid_at: daysAgo(MAX_JOB_AGE_DAYS + 1) }))).toContain("too late to be fresh");
    expect(why(invoice({ paid_at: daysAgo(400) }))).toContain("too late to be fresh");
  });

  it("accepts one right on the edge of the window", () => {
    expect(decideAutoRequest(invoice({ paid_at: daysAgo(MAX_JOB_AGE_DAYS - 1) }), ctx(), NOW)).toEqual({
      send: true,
    });
  });

  it("does nothing at all when the business has not opted in", () => {
    // Default off. No existing customer's behaviour changes.
    expect(why(invoice(), ctx({ optedIn: false }))).toContain("switched off");
  });
});

describe("it waits before it acts", () => {
  it("REFUSES a job marked paid a minute ago", () => {
    // A mis-tapped "mark paid" is corrected within minutes. An email that has
    // already gone cannot be.
    expect(why(invoice({ paid_at: hoursAgo(0.02) }))).toContain("paid too recently");
    expect(why(invoice({ paid_at: hoursAgo(1) }))).toContain("paid too recently");
  });

  it("REFUSES a paid date in the future", () => {
    // Clock skew, or a hand-edited row. Never act on a job that hasn't
    // happened.
    expect(why(invoice({ paid_at: new Date(NOW.getTime() + 86_400_000).toISOString() }))).toContain(
      "in the future"
    );
  });
});

describe("it never asks the same person twice", () => {
  it("REFUSES an invoice already asked about", () => {
    expect(why(invoice({ review_requested_at: daysAgo(2) }))).toContain("already asked about this job");
  });

  it("REFUSES someone asked within the cooldown, even about a different job", () => {
    // A customer with three jobs in a month is the BEST customer, and asking
    // three times is how they stop being one.
    expect(why(invoice(), ctx({ lastAskedAt: daysAgo(10) }))).toContain("within the last");
    expect(why(invoice(), ctx({ lastAskedAt: daysAgo(ASK_COOLDOWN_DAYS - 1) }))).toContain(
      "within the last"
    );
  });

  it("asks again once the cooldown has passed", () => {
    expect(
      decideAutoRequest(invoice(), ctx({ lastAskedAt: daysAgo(ASK_COOLDOWN_DAYS + 1) }), NOW)
    ).toEqual({ send: true });
  });

  it("REFUSES anyone who has already left a review", () => {
    // The marketing promise, enforced: "never after they've already reviewed
    // you."
    expect(why(invoice(), ctx({ hasReviewed: true }))).toContain("already left a review");
  });

  it("treats an unreadable last-asked date as recently asked", () => {
    // The safe answer to "have we bothered this person lately?" is always yes.
    expect(why(invoice(), ctx({ lastAskedAt: "not a date" }))).toContain("within the last");
  });
});

describe("it refuses anything it cannot be sure about", () => {
  it("REFUSES an unpaid invoice", () => {
    for (const status of ["draft", "sent", "void"]) {
      expect(why(invoice({ status }))).toContain("not paid");
    }
  });

  it("REFUSES an invoice with no email", () => {
    expect(why(invoice({ customer_email: null }))).toContain("no customer email");
    expect(why(invoice({ customer_email: "   " }))).toContain("no customer email");
  });

  it("REFUSES an email that is not an email", () => {
    for (const bad of ["mary", "mary@", "@example.ie", "mary example.ie", "mary@example"]) {
      expect(why(invoice({ customer_email: bad })), bad).toContain("looks invalid");
    }
  });

  it("REFUSES a paid invoice with no paid date", () => {
    // Marked paid at some unknown time. Freshness is the whole premise, so
    // without a date there is nothing to judge.
    expect(why(invoice({ paid_at: null }))).toContain("no date");
    expect(why(invoice({ paid_at: "nonsense" }))).toContain("could not be read");
  });

  it("checks the opt-in before anything else", () => {
    // A business that has not opted in should never even be evaluated on the
    // rest, so a bad row cannot produce a confusing reason.
    expect(why(invoice({ customer_email: null, status: "void" }), ctx({ optedIn: false }))).toContain(
      "switched off"
    );
  });
});

describe("what the customer is called", () => {
  it("uses their name", () => {
    expect(requestName(invoice())).toBe("Mary Byrne");
  });

  it("falls back to 'there' rather than greeting nobody", () => {
    expect(requestName(invoice({ customer_name: null }))).toBe("there");
    expect(requestName(invoice({ customer_name: "  " }))).toBe("there");
  });
});

describe("what the morning brief is told", () => {
  it("reports a quiet run rather than staying silent", () => {
    // A routine that only speaks up on success is a routine you stop trusting.
    expect(autoRequestSummary({ sent: 0, skipped: 0, failed: 0 })).toContain("nothing to ask about");
    expect(autoRequestSummary({ sent: 0, skipped: 12, failed: 0 })).toContain("12 looked at");
  });

  it("reports what was sent, with the right plural", () => {
    expect(autoRequestSummary({ sent: 1, skipped: 0, failed: 0 })).toContain("1 review request sent");
    expect(autoRequestSummary({ sent: 4, skipped: 0, failed: 0 })).toContain("4 review requests sent");
  });

  it("never hides a failure", () => {
    expect(autoRequestSummary({ sent: 2, skipped: 0, failed: 1 })).toContain("1 failed");
    expect(autoRequestSummary({ sent: 0, skipped: 0, failed: 3 })).toContain("3 failed");
  });
});

describe("the runner and the migration", () => {
  const RUNNER = readFileSync(path.join(ROOT, "lib", "cron", "review-autopilot.ts"), "utf8");
  const MIGRATION = readFileSync(
    path.join(ROOT, "supabase", "migrations", "0041_review_autopilot.sql"),
    "utf8"
  );
  const DISPATCH = readFileSync(
    path.join(ROOT, "app", "api", "cron", "dispatch", "route.ts"),
    "utf8"
  );
  const SETTINGS = readFileSync(
    path.join(ROOT, "app", "portal", "review-agent", "settings", "actions.ts"),
    "utf8"
  );

  it("the opt-in defaults to off in the database, not just in the UI", () => {
    expect(MIGRATION).toContain("auto_review_requests boolean not null default false");
  });

  it("the age window is applied in the query as well as the decision", () => {
    // The decision function is the thing that must be right, but a query that
    // could return two years of invoices is a loaded gun sitting next to it.
    expect(RUNNER).toContain('.gte("paid_at", since)');
    expect(RUNNER).toContain("MAX_JOB_AGE_DAYS * 86_400_000");
  });

  it("marks the invoice only AFTER the email has gone", () => {
    const sendAt = RUNNER.indexOf("sendReviewRequestCore(");
    const markAt = RUNNER.indexOf("review_requested_at: new Date().toISOString()");
    expect(sendAt).toBeGreaterThan(-1);
    expect(markAt).toBeGreaterThan(sendAt);
    // And a failed send is explicitly NOT marked, so tomorrow retries.
    expect(RUNNER).toContain("NOT marked as asked");
  });

  it("says so when an email went but could not be recorded", () => {
    expect(RUNNER).toContain("sent but not recorded");
  });

  it("has a kill switch and a per-run cap", () => {
    expect(RUNNER).toContain("REPUTATIONIQ_AUTOREQUEST");
    expect(RUNNER).toContain("sent >= PER_RUN_CAP");
    expect(PER_RUN_CAP).toBeLessThanOrEqual(50);
  });

  it("scopes the ask history per business, not per address", () => {
    // Two businesses can legitimately share a customer, and one asking must
    // not silence the other.
    expect(RUNNER).toContain("`${businessId}:${email.trim().toLowerCase()}`");
  });

  it("goes idle rather than erroring before the migration is run", () => {
    expect(RUNNER).toContain("review autopilot idle");
  });

  it("is chained behind the review reminders, not raced against them", () => {
    // Both write ra_review_requests.
    expect(DISPATCH).toContain('isolated("reviewAutopilot", runReviewAutopilot)');
    const reminders = DISPATCH.indexOf('isolated("reviewReminders"');
    const autopilot = DISPATCH.indexOf('isolated("reviewAutopilot"');
    expect(autopilot).toBeGreaterThan(reminders);
  });

  it("does not disturb the tasks the 07:00 run already reports", () => {
    for (const task of [
      "reviewReminders",
      "invoiceChaser",
      "bookingSync",
      "autoQueue",
      "autoFollowups",
      "emailAutopilot",
      "jarvisBrief",
    ]) {
      expect(DISPATCH, task).toContain(task);
    }
  });

  it("refuses to switch on automatic requests with no review link", () => {
    // It would send customers to nothing.
    expect(SETTINGS).toContain("Add your review link before switching on automatic requests");
  });

  it("still saves the rest of the settings before the migration is run", () => {
    expect(SETTINGS).toContain("PGRST204");
  });
});
