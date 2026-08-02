import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { reviewLinkStatus } from "@/lib/review-agent/review-hosts";

/**
 * The review autopilot's opt-in needed TWO things, and only said one of them.
 *
 * `runReviewAutopilot` gated on
 * `Boolean(auto_review_requests) && Boolean(google_review_link)`.
 *
 * `Boolean(...)` is true for ANY non-empty string. So a business that ticked
 * "Ask automatically when a job is paid" and had "ask me for it", or half a
 * pasted URL, in the review-link field got review requests emailed to its OWN
 * customers carrying a link that goes nowhere. Worse than not asking, and
 * unrecallable.
 *
 * And with the field genuinely EMPTY the automation silently never ran — every
 * morning, for ever, with the checkbox still showing "on". A setting that
 * reads as on and can never fire is a lie the UI tells once and then keeps.
 *
 * Both live as of today: 0041 was applied this afternoon, so this is the
 * toggle's first real week.
 *
 * Fixed in both places, with the SAME parser the customer-facing redirect
 * already uses, so the settings page and the morning run can never disagree
 * about what counts as a usable link.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const RUNNER = readFileSync(path.join(ROOT, "lib", "cron", "review-autopilot.ts"), "utf8");
const SETTINGS = readFileSync(
  path.join(ROOT, "app", "portal", "review-agent", "settings", "page.tsx"),
  "utf8"
);

/** The old gate and the new one, so the change is expressible, not described. */
const before = (opted: boolean, link: string) => opted && Boolean(link);
const after = (opted: boolean, link: string) => opted && reviewLinkStatus(link).ok;

describe("a link has to be somewhere a customer can actually be sent", () => {
  it.each([
    ["not a web address at all", "ask me for it"],
    ["a bare word", "google"],
    ["whitespace only", "   "],
  ])("%s no longer sends", (_label, link) => {
    expect(before(true, link)).toBe(true); // it used to
    expect(after(true, link)).toBe(false); // it no longer does
  });

  it("an empty field still doesn't send, and never did", () => {
    expect(before(true, "")).toBe(false);
    expect(after(true, "")).toBe(false);
  });

  it("a real Google review link still sends — nothing that worked stopped", () => {
    for (const link of [
      "https://g.page/r/CxYz/review",
      "g.page/r/CxYz/review",
      "https://maps.app.goo.gl/abc123",
      "https://www.trustpilot.com/review/example.ie",
    ]) {
      expect(after(true, link), link).toBe(true);
    }
  });

  it("an unrecognised but VALID host still sends", () => {
    // It genuinely works — the redirect just shows a confirmation first.
    // Blocking it would be the fix causing its own damage.
    const link = "https://my-own-site.ie/reviews";
    expect(reviewLinkStatus(link).ok).toBe(true);
    expect(reviewLinkStatus(link).known).toBe(false);
    expect(after(true, link)).toBe(true);
  });

  it("opting OUT still beats any link — the tick is still required", () => {
    expect(after(false, "https://g.page/r/CxYz/review")).toBe(false);
  });

  it("the change can only ever narrow, never widen", () => {
    // A fix to a send path must not be able to make MORE email go out.
    for (const link of ["", "  ", "x", "ask me", "g.page/r/a/review", "https://x.ie/r"]) {
      for (const opted of [true, false]) {
        if (after(opted, link)) expect(before(opted, link), link).toBe(true);
      }
    }
  });
});

describe("the runner is wired to the shared parser", () => {
  it("judges the link rather than testing it for non-emptiness", () => {
    expect(RUNNER).toContain('import { reviewLinkStatus } from "@/lib/review-agent/review-hosts"');
    expect(RUNNER).toContain("wants && link.ok");
  });

  it("no longer gates on Boolean(google_review_link)", () => {
    // The bug, in one expression.
    expect(RUNNER).not.toContain("Boolean(b.google_review_link)");
  });

  it("still requires the opt-in itself", () => {
    expect(RUNNER).toContain("const wants = Boolean(b.auto_review_requests)");
  });

  it("says WHY nothing was sent instead of skipping in silence", () => {
    // An opt-in that can never fire must not look like a quiet morning.
    expect(RUNNER).toContain("unusableLink");
    expect(RUNNER).toContain("opted in but the review link isn't a usable web address");
  });

  it("keeps every guard that was already there", () => {
    for (const guard of [
      "MAX_JOB_AGE_DAYS",
      "ASK_COOLDOWN_DAYS",
      "PER_RUN_CAP",
      "REPUTATIONIQ_AUTOREQUEST",
      "review_requested_at",
    ]) {
      expect(RUNNER, guard).toContain(guard);
    }
    // And the 14-day window is still applied in the query, not just in the
    // decision function — the guard the register calls load-bearing.
    expect(RUNNER).toContain('.gte("paid_at", since)');
  });
});

describe("the settings page tells the truth at the checkbox", () => {
  it("warns that the automation cannot run without a link", () => {
    expect(SETTINGS).toContain("This can&apos;t run yet.");
    const from = SETTINGS.indexOf("This can&apos;t run yet.");
    expect(SETTINGS.slice(from - 600, from)).toContain("!link.ok");
  });

  it("still saves the tick — it informs, it does not block", () => {
    // Blocking the save would lose the setting for someone filling the form
    // top to bottom. Additive over destructive.
    // Whitespace-insensitive: the point is the promise, not how the JSX wraps.
    expect(SETTINGS.replace(/\s+/g, " ")).toContain("the tick is saved either way");
    // Nothing added `disabled` or `required` to the checkbox.
    const box = SETTINGS.slice(
      SETTINGS.indexOf('id="autoRequests"'),
      SETTINGS.indexOf("</label>", SETTINGS.indexOf('id="autoRequests"'))
    );
    expect(box).toContain('defaultChecked={Boolean(business?.auto_review_requests)}');
    expect(box).not.toContain("disabled");
  });

  it("warns separately about a valid but unrecognised host", () => {
    // Different problem, different advice: this one DOES send.
    expect(SETTINGS).toContain("link.ok && !link.known");
    expect(SETTINGS).toContain("these emails go");
  });

  it("uses the same status object the runner now uses", () => {
    expect(SETTINGS).toContain("reviewLinkStatus(business?.google_review_link)");
  });

  it("keeps the explanation of the guards it already had", () => {
    expect(SETTINGS).toContain("{MAX_JOB_AGE_DAYS} days");
    expect(SETTINGS).toContain("{ASK_COOLDOWN_DAYS} days");
    expect(SETTINGS).toContain("does not reach back over older");
  });
});
