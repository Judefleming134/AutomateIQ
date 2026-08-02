import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The 07:00 dispatch's task order.
 *
 * The chain bookingSync → autoQueue → autoFollowups → emailAutopilot → brief
 * is LOAD-BEARING, and nothing in the code said so:
 *
 *   markMeetingBooked() (inside bookingSync) moves a prospect who booked a
 *   call overnight to status "meeting_booked". autoQueueTopDrafts selects on
 *   READY_STATUSES; autoQueueDueFollowups selects on ["contacted",
 *   "follow_up_sent"]. Run the sync concurrently with either and someone who
 *   has already booked a call gets picked up for a cold first touch or a
 *   chase — outreach sent hours after they booked.
 *
 * That is the exact class of send CLAUDE.md says costs a customer
 * permanently, and the only thing preventing it is statement order. This
 * pins it, so a future "let's Promise.all these" cannot land quietly.
 *
 * sendReviewReminders is the one task that CAN float: it touches only
 * ra_customers and businesses, while everything else touches ge_* and
 * strategy_bookings. Verified disjoint by reading both.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(
  path.join(ROOT, "app", "api", "cron", "dispatch", "route.ts"),
  "utf8"
);
/** Comments stripped — this file documents the constraint at length. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Position of a task's ASSIGNMENT, not the first mention — the imports at
 *  the top and the 401 early-return both contain these names. */
const at = (needle: string) => {
  const i = CODE.indexOf(needle);
  expect(i, `expected to find ${needle}`).toBeGreaterThan(-1);
  return i;
};
const task = (name: string) => at(`const ${name} = await isolated`);

describe("the ge_ chain stays in order", () => {
  it("syncs bookings before anything queues outreach", () => {
    // A prospect who booked overnight must be at meeting_booked BEFORE the
    // queue steps read the pipeline, or they get cold-emailed after booking.
    expect(task("bookingSync")).toBeLessThan(task("autoQueue"));
  });

  it("queues first touches before due follow-ups", () => {
    expect(task("autoQueue")).toBeLessThan(task("autoFollowups"));
  });

  it("queues everything before it sends", () => {
    expect(task("autoFollowups")).toBeLessThan(task("emailAutopilot"));
  });

  it("sends before the brief reports what went out", () => {
    expect(task("emailAutopilot")).toBeLessThan(task("jarvisBrief"));
  });

  it("awaits each step of the chain, so none of it runs concurrently", () => {
    for (const task of ["bookingSync", "autoQueue", "autoFollowups", "emailAutopilot", "jarvisBrief"]) {
      expect(CODE, task).toMatch(new RegExp(`const ${task} = await isolated`));
    }
  });

  it("never gathers the chain into a Promise.all", () => {
    expect(CODE).not.toMatch(/Promise\.all\(\s*\[[\s\S]{0,400}autoQueue/);
  });
});

describe("the disjoint task is off the critical path", () => {
  // The reminders now share a promise with the review autopilot — both write
  // ra_review_requests, so they are chained to each other rather than raced.
  // The constraint this block protects is unchanged: the review work starts
  // before the ge_ chain, is not awaited across it, and is settled before the
  // response.
  it("starts the review work without awaiting it", () => {
    expect(CODE).toMatch(/const reviewChainPromise = \(async \(\) => \{/);
    expect(CODE).toMatch(/isolated\("reviewReminders", sendReviewReminders\)/);
  });

  it("starts it before the chain, not after", () => {
    expect(at("const reviewChainPromise")).toBeLessThan(task("bookingSync"));
  });

  it("still settles it before responding, so a failure is reported", () => {
    // Abandoning it mid-flight would drop the outcome and could cut the sends
    // off when the function returns.
    expect(at("await reviewChainPromise")).toBeLessThan(at("ok: true,"));
  });

  it("runs the autopilot after the reminders, never alongside", () => {
    expect(at('isolated("reviewReminders"')).toBeLessThan(at('isolated("reviewAutopilot"'));
    // Both awaited inside the same async IIFE, so they cannot overlap.
    expect(CODE).toMatch(/await isolated\("reviewReminders"[\s\S]{0,200}await isolated\("reviewAutopilot"/);
  });

  it("still reports every task in the response", () => {
    for (const t of ["reviewReminders", "reviewAutopilot", "invoiceChaser", "bookingSync", "autoQueue", "autoFollowups", "emailAutopilot", "jarvisBrief"]) {
      expect(CODE, t).toContain(t);
    }
  });
});

describe("the chaser settles before the brief reads what it writes", () => {
  /**
   * The chaser WRITES qa_invoices.chase_count. The brief's money block READS
   * qa_invoices.chase_count and turns `>= 3` into the "📞 past automatic
   * chasing — needs a call" line, which is the handoff from the engine to a
   * human about money.
   *
   * The chaser was started without being awaited and only settled AFTER the
   * brief had gone out, so on the morning an invoice received its third and
   * final reminder, the line telling Jude to ring that customer might not
   * appear at all. Replayed across six chaser speeds: wrong at three of them
   * before, none unexplained after.
   *
   * Unlike the review chain — which writes ra_review_requests, a table the
   * brief never reads (verified: zero references) — this one genuinely
   * overlaps and cannot simply float.
   */
  it("waits for the chaser before sending the brief", () => {
    expect(at("await Promise.race([")).toBeLessThan(task("jarvisBrief"));
    expect(CODE).toMatch(/invoiceChasePromise\.then\(\(\) => true\)/);
  });

  it("still starts it early, so the wait is normally free", () => {
    // It has the whole sequential ge_ chain to finish in. Moving the START
    // down here would put its outbound emails back on the critical path.
    expect(at("const invoiceChasePromise")).toBeLessThan(task("bookingSync"));
  });

  it("BOUNDS the wait, so a hung chaser can never stop the 07:00 brief", () => {
    // The one thing CLAUDE.md says must never be left broken. Precision about
    // the chase figures is worth less than the brief going out at all.
    expect(CODE).toMatch(/const CHASER_SETTLE_MS = [\d_]+;/);
    expect(CODE).toMatch(/setTimeout\(\(\) => resolve\(false\), CHASER_SETTLE_MS\)/);
    // And the brief is NOT inside the race — it runs after it either way.
    expect(CODE).not.toMatch(/Promise\.race\(\[[\s\S]{0,300}jarvisBrief/);
  });

  it("clears the timer rather than leaving it pending", () => {
    expect(CODE).toMatch(/clearTimeout\(settleTimer\)/);
  });

  it("still awaits the real result, so nothing is abandoned or unreported", () => {
    // The bounded race must not become the only await — the actual outcome is
    // still collected before responding.
    expect(at("const invoiceChaser = await invoiceChasePromise")).toBeGreaterThan(
      task("jarvisBrief")
    );
    expect(at("const invoiceChaser = await invoiceChasePromise")).toBeLessThan(at("ok: true,"));
  });

  it("makes a timeout visible instead of silent", () => {
    // If the brief ever DOES go out with stale chase figures, that has to be
    // findable afterwards rather than a mystery.
    expect(CODE).toContain("invoiceChaserSettledBeforeBrief");
    expect(SRC).toMatch(/console\.warn\(/);
  });

  it("the brief really does read the column the chaser writes", () => {
    // If either side ever stops touching chase_count, this whole ordering
    // constraint is obsolete and should be reconsidered rather than cargo-culted.
    const money = readFileSync(path.join(ROOT, "lib", "cron", "money-block.ts"), "utf8");
    const chaser = readFileSync(path.join(ROOT, "lib", "cron", "invoice-chaser.ts"), "utf8");
    expect(money).toContain("chase_count");
    expect(chaser).toMatch(/update\(\{ last_chased_at: nowISO, chase_count:/);
  });

  it("the review chain still floats — it writes nothing the brief reads", () => {
    const brief = readFileSync(path.join(ROOT, "lib", "cron", "jarvis-morning-brief.ts"), "utf8");
    expect(brief).not.toContain("ra_review_requests");
    // So it is still settled after the brief, not before it.
    expect(at("await reviewChainPromise")).toBeGreaterThan(task("jarvisBrief"));
  });
});

describe("the whole dispatch is still authorised and isolated", () => {
  it("refuses an unauthorised caller before doing any work", () => {
    expect(at("if (!isAuthorizedCron")).toBeLessThan(at("const reviewChainPromise"));
  });

  it("wraps every task so one failure cannot take the others down", () => {
    expect((CODE.match(/isolated\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
