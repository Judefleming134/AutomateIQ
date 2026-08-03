import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { secretsMatch } from "@/lib/security/timing-safe";
import { PRE_REPLY_STATUSES } from "@/lib/growth/autopilot";

/**
 * The inbound webhook told the truth about the message and lied about the
 * consequence.
 *
 * Two status updates on the reply path threw their errors away:
 *
 *   OPT-OUT   `.update({ status: "do_not_contact", next_follow_up_at: null })`
 *   REPLY     `.update({ status: "replied", next_follow_up_at: tomorrow })`
 *
 * Neither error was read. On failure the status never changed, the timeline
 * still said it had ("marked Do not contact, follow-ups cleared"), and the
 * webhook still answered ok.
 *
 * That matters here more than anywhere else in the engine, because those two
 * statuses are exactly what the 07:00 send gate reads. `do_not_contact` is
 * outside PRE_REPLY_STATUSES, which is what holds a queued cold touch; so is
 * `replied`. A silent failure therefore means:
 *
 *   - someone who asked to be left alone gets emailed anyway, the morning after
 *     the system recorded that it had honoured them. The route's own comment
 *     calls this "an ePrivacy obligation, not a courtesy".
 *   - someone who just wrote back gets a cold chase instead of an answer.
 *
 * And it was unrecoverable: the 15-minute duplicate check short-circuited
 * before the consequence could be re-applied, so the forwarder retry — the one
 * mechanism that could have fixed it — was the mechanism that guaranteed it
 * never would.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ROUTE = readFileSync(
  path.join(ROOT, "app", "api", "webhooks", "inbound-email", "route.ts"),
  "utf8"
);

describe("the gate these statuses feed", () => {
  it("do_not_contact and replied are both OUTSIDE the pre-reply set", () => {
    // This is the whole reason the failures mattered. If either were inside
    // it, a queued cold touch would send regardless and the bug would be a
    // reporting one rather than a delivery one.
    expect(PRE_REPLY_STATUSES).not.toContain("do_not_contact");
    expect(PRE_REPLY_STATUSES).not.toContain("replied");
    // …and the states a lead is actually in when a reply arrives ARE inside it.
    expect(PRE_REPLY_STATUSES).toContain("contacted");
    expect(PRE_REPLY_STATUSES).toContain("follow_up_sent");
  });
});

describe("an opt-out that could not be applied says so", () => {
  it("captures the error", () => {
    expect(ROUTE).toContain("const { error: optOutError } = await admin");
  });

  it("the timeline says it FAILED, not that it succeeded", () => {
    expect(ROUTE).toContain("BUT APPLYING IT FAILED");
    expect(ROUTE).toContain("queued outreach may still send");
    expect(ROUTE).toContain("Set this by hand now");
  });

  it("answers 5xx so the forwarder retries", () => {
    const branch = ROUTE.slice(ROUTE.indexOf("if (optOutError) {"));
    expect(branch.slice(0, 400)).toContain("status: 502");
  });

  it("still writes the honest success line when it worked", () => {
    expect(ROUTE).toContain("marked Do not contact, follow-ups cleared, no reply drafted");
  });

  it("still refuses to flip a won customer out of the pipeline", () => {
    // Destructive, and deliberately left as a loud log instead.
    expect(ROUTE).toContain('const closed = ["won", "do_not_contact"].includes(prospect.status)');
    expect(ROUTE).toContain("review this one by hand");
  });
});

describe("a reply whose status could not be moved says so", () => {
  it("captures the error", () => {
    expect(ROUTE).toContain("const { error: replyStatusError } = await admin");
    expect(ROUTE).toContain("statusError = replyStatusError?.message ?? null");
  });

  it("the timeline names the risk in plain words", () => {
    expect(ROUTE).toContain("the status could not be moved to Replied");
    expect(ROUTE).toContain("Queued cold outreach may still send to them");
  });

  it("answers 5xx rather than ok", () => {
    expect(ROUTE).toContain("reply captured but status not updated");
  });

  it("still only advances from a pre-reply status", () => {
    // A later stage must never be regressed by an inbound message.
    expect(ROUTE).toContain("if (PRE_REPLY_STATUSES.includes(prospect.status))");
  });
});

describe("a retry now converges instead of short-circuiting", () => {
  it("classifies BEFORE the duplicate check", () => {
    expect(ROUTE.indexOf("const kind = classifyInbound(")).toBeLessThan(
      ROUTE.indexOf("const { data: dupe }")
    );
  });

  it("a duplicate only returns early when the consequence is already in place", () => {
    expect(ROUTE).toContain("const consequenceApplied =");
    expect(ROUTE).toContain("if (dupe && consequenceApplied) {");
  });

  it("and does NOT re-insert the message when it falls through", () => {
    // Otherwise a retry doubles the thread.
    expect(ROUTE).toContain("const { error } = dupe\n    ? { error: null }");
  });

  /** The convergence rule, transcribed. */
  const applied = (kind: string, status: string) =>
    kind === "opt_out"
      ? status === "do_not_contact" || status === "won"
      : kind === "human"
        ? !PRE_REPLY_STATUSES.includes(status)
        : true;

  it("an unhonoured opt-out is retried", () => {
    expect(applied("opt_out", "contacted")).toBe(false);
  });

  it("an honoured one is not", () => {
    expect(applied("opt_out", "do_not_contact")).toBe(true);
    expect(applied("opt_out", "won")).toBe(true);
  });

  it("a reply left in a pre-reply status is retried", () => {
    for (const s of PRE_REPLY_STATUSES) expect(applied("human", s)).toBe(false);
  });

  it("one already moved on is not", () => {
    for (const s of ["replied", "qualified", "meeting_booked", "won"]) {
      expect(applied("human", s)).toBe(true);
    }
  });

  it("an auto-reply never falls through — it changes no status", () => {
    for (const s of ["contacted", "replied", "won"]) {
      expect(applied("auto_reply", s)).toBe(true);
    }
  });
});

describe("the shared secret is compared in constant time", () => {
  it("the route uses the helper, not `!==`", () => {
    expect(ROUTE).toContain("secretsMatch(provided, secret)");
    const code = ROUTE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toContain("provided !== secret");
  });

  it("matches only an exact secret", () => {
    expect(secretsMatch("hunter2", "hunter2")).toBe(true);
    expect(secretsMatch("hunter3", "hunter2")).toBe(false);
    expect(secretsMatch("hunter", "hunter2")).toBe(false);
    expect(secretsMatch("hunter22", "hunter2")).toBe(false);
  });

  it("never matches when nothing is configured", () => {
    // The route already 503s on an unset secret; this is belt and braces.
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch("anything", "")).toBe(false);
  });

  it("handles a missing header without throwing", () => {
    expect(secretsMatch("", "hunter2")).toBe(false);
    expect(secretsMatch(undefined as unknown as string, "hunter2")).toBe(false);
  });

  it("the other two webhooks were already doing this", () => {
    const resend = readFileSync(
      path.join(ROOT, "app", "api", "webhooks", "resend", "route.ts"),
      "utf8"
    );
    const ig = readFileSync(path.join(ROOT, "app", "api", "ig", "webhook", "route.ts"), "utf8");
    expect(resend).toContain("timingSafeEqual");
    expect(ig).toContain("timingSafeEqual");
  });
});

describe("nothing else on the reply path moved", () => {
  it("still escapes LIKE wildcards when matching the sender", () => {
    expect(ROUTE).toContain('senderEmail.replace(/([%_\\\\])/g, "\\\\$1")');
  });

  it("still returns matched:false for a stranger", () => {
    expect(ROUTE).toContain('{ ok: true, matched: false }');
  });

  it("still defers a chase to an out-of-office return date", () => {
    expect(ROUTE).toContain("kind.returnsOn");
    expect(ROUTE).toContain("Chase moved to");
  });

  it("still auto-drafts a suggested reply for a human one", () => {
    expect(ROUTE).toContain("autoDraftReply(admin, prospect, text, null)");
  });
});
