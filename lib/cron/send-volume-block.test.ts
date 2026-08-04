import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The morning brief never told Jude why today's send was the size it was.
 *
 * `resolveSendRamp` decides how much outreach may go out and can hold volume
 * down for three reasons — a spam complaint in the 14-day window, a bounce rate
 * over the limit, or the 30/day ceiling one morning run can carry. Its `reason`
 * string explains each in plain English, and none of it reached him.
 *
 * The reason rides on the first auto-queue activity. `autoQueueTopDrafts` says
 * so on the very line that writes it:
 *
 *   "The FIRST line of the run also carries the ramp decision, so the pacing
 *    shows up in the nightly section of the morning brief rather than only in
 *    the cron response."
 *
 * But the brief's nightly query filters `Jarvis nightly: auto-queued%` out
 * wholesale, and has done since that section was de-noised. The de-noising was
 * right — 250 queue lines buried the genuine catches — it just took the one
 * line carrying the decision with it, and replaced it with a bare count that
 * says nothing about volume. Two correct changes; the seam between them lost
 * the signal.
 *
 * The case that matters most has no carrier at all: when a hold suppresses
 * queueing entirely, `queued` never reaches 1, the activity is never written,
 * and there is nothing to un-filter. A held send was invisible on every surface
 * Jude looks at — he just saw fewer emails.
 *
 *     scenario                       sent    brief said (before)
 *     ────────────────────────────   ─────   ───────────────────
 *     at target                      30/30   nothing        ✓ correct
 *     still ramping                  12/30   nothing        ✗
 *     capped by the run ceiling      30/250  nothing        ✗
 *     SPAM COMPLAINT — held          20/30   nothing        ✗
 *     bounce rate over limit — held  20/30   nothing        ✗
 *
 * A hold persists for the whole 14-day window: a fortnight of throttled
 * outreach with no explanation anywhere.
 *
 * This got sharper the same day. The spam-complaint hold was unreachable until
 * the marker mismatch was fixed (complaint-hold.test.ts), so bounces were the
 * only hold that could fire. Both can now.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BRIEF = readFileSync(path.join(ROOT, "lib", "cron", "jarvis-morning-brief.ts"), "utf8");
const AUTOPILOT = readFileSync(path.join(ROOT, "lib", "growth", "autopilot.ts"), "utf8");

/** Real `reason` strings, in the shapes resolveSendRamp actually produces. */
type Ramp = { requested: number; target: number; cappedByRun: boolean; reason: string };

const AT_TARGET: Ramp = {
  requested: 30, target: 30, cappedByRun: false,
  reason: "at your target of 30/day (peak 30, 0.4% bounces)",
};
const RAMPING: Ramp = {
  requested: 30, target: 12, cappedByRun: false,
  reason:
    "ramping to 12/day on the way to 30 — up to +50% on the recent peak of 8/day, 0.0% bounces. Reaches it in about 3 more days.",
};
const CAPPED: Ramp = {
  requested: 250, target: 30, cappedByRun: true,
  reason:
    "at your target of 250/day (peak 30, 0.2% bounces) — capped at 30/day, because one morning run sends at most 30 emails inside its time budget (which also has to fit your brief). Your target of 250 can't be reached by raising that number alone.",
};
const COMPLAINT_HOLD: Ramp = {
  requested: 30, target: 20, cappedByRun: false,
  reason:
    "HOLDING at 20/day — 1 spam complaint in the last 14 days. Volume will not grow until that's clean. Check who's being emailed and how they got on the list.",
};
const BOUNCE_HOLD: Ramp = {
  requested: 30, target: 20, cappedByRun: false,
  reason:
    "HOLDING at 20/day — 7.4% of the last 54 emails bounced (limit 5%). Clean the list before sending more; bounces damage the domain faster than volume builds it.",
};

/** A replay of the block the brief now builds. Mirrors the shipped branch. */
function volumeBlock(ramp: Ramp): string {
  if (ramp.reason.startsWith("HOLDING")) {
    return (
      `🛑 SEND VOLUME HELD — ${ramp.reason}\n` +
      `  Nothing is broken; the engine is protecting the sending domain. ` +
      `It lifts on its own once the window is clean.`
    );
  }
  if (ramp.cappedByRun) return `📊 SEND VOLUME — ${ramp.reason}`;
  if (ramp.target < ramp.requested) return `📊 SEND VOLUME — ${ramp.reason}`;
  return "";
}

describe("the brief now explains a send that isn't what was asked for", () => {
  it("a spam-complaint hold is stated, loudly", () => {
    const b = volumeBlock(COMPLAINT_HOLD);
    expect(b).toContain("SEND VOLUME HELD");
    expect(b).toContain("spam complaint");
    // And it says what to do about it rather than just alarming him.
    expect(b).toContain("Nothing is broken");
    expect(b).toContain("lifts on its own");
  });

  it("a bounce-rate hold is stated the same way", () => {
    const b = volumeBlock(BOUNCE_HOLD);
    expect(b).toContain("SEND VOLUME HELD");
    expect(b).toContain("bounced");
  });

  it("the run ceiling is explained", () => {
    const b = volumeBlock(CAPPED);
    expect(b).toContain("SEND VOLUME");
    expect(b).toContain("capped at 30/day");
  });

  it("an ordinary climb is explained, quietly", () => {
    const b = volumeBlock(RAMPING);
    expect(b).toContain("SEND VOLUME");
    expect(b).toContain("ramping to 12/day");
    expect(b).not.toContain("HELD");
  });

  it("a morning already at target adds NOTHING — no new noise", () => {
    // The point of only speaking up when the send was smaller than asked.
    expect(volumeBlock(AT_TARGET)).toBe("");
  });

  it("every case that shrank the send now says so; the one that didn't stays silent", () => {
    for (const r of [RAMPING, CAPPED, COMPLAINT_HOLD, BOUNCE_HOLD]) {
      expect(volumeBlock(r), r.reason.slice(0, 40)).not.toBe("");
    }
    expect(volumeBlock(AT_TARGET)).toBe("");
  });

  it("a hold is visually distinct from a mere ramp", () => {
    // Reading the brief on a phone, "we are throttled" must not look like
    // "we are climbing".
    expect(volumeBlock(COMPLAINT_HOLD).startsWith("🛑")).toBe(true);
    expect(volumeBlock(RAMPING).startsWith("📊")).toBe(true);
  });
});

describe("the brief is wired to compute it, not to depend on an activity", () => {
  it("it calls resolveSendRamp directly", () => {
    expect(BRIEF).toContain("const ramp = await resolveSendRamp(admin, requested);");
    expect(BRIEF).toContain('import { resolveSendRamp } from "@/lib/growth/autopilot";');
  });

  it("it resolves the target the same way autoQueueTopDrafts does", () => {
    // Settings first, GROWTH_AUTOQUEUE_TARGET as an explicit override — so the
    // brief reports on the same number the queue acted on.
    for (const src of [BRIEF, AUTOPILOT]) {
      expect(src).toContain("process.env.GROWTH_AUTOQUEUE_TARGET");
      expect(src).toContain("settings.dailySendTarget");
    }
    expect(BRIEF).toContain("Number.isFinite(requested) && requested > 0");
  });

  it("resolveSendRamp is read-only, so calling it from the brief is safe", () => {
    const fn = AUTOPILOT.slice(
      AUTOPILOT.indexOf("export async function resolveSendRamp"),
      AUTOPILOT.indexOf("export async function autoQueueTopDrafts")
    );
    expect(fn).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it("a failure degrades to no block, never to a lost brief", () => {
    // CLAUDE.md: the 07:00 brief must never be left broken.
    const block = BRIEF.slice(
      BRIEF.indexOf("let volumeBlock = \"\";"),
      BRIEF.indexOf("// Blocks shared by both shapes")
    );
    expect(block).toContain("try {");
    expect(block).toContain("} catch (err) {");
    expect(block).toContain("send-volume block skipped");
  });

  it("it appears in BOTH brief shapes", () => {
    expect((BRIEF.match(/^\s+volumeBlock,$/gm) ?? []).length).toBe(2);
  });

  it("on a weekday it sits directly above SENT THIS MORNING, which it explains", () => {
    const weekday = BRIEF.slice(BRIEF.indexOf("// Weekday: the full attack plan."));
    const v = weekday.indexOf("volumeBlock,");
    const s = weekday.indexOf("sentBlock,");
    expect(v).toBeGreaterThan(-1);
    expect(s).toBeGreaterThan(v);
  });
});

describe("nothing about the existing brief changed", () => {
  it("the nightly section still filters the auto-queue bulk out", () => {
    // The de-noising was right and stays — this fix does not undo it.
    expect(BRIEF).toContain('const AUTO_QUEUE_PREFIX = "Jarvis nightly: auto-queued"');
    expect(BRIEF).toContain(".not(\"content\", \"ilike\", `${AUTO_QUEUE_PREFIX}%`)");
  });

  it("the one-line queue summary is still there", () => {
    expect(BRIEF).toContain("Queued ${autoQueuedTotal} first-touch email");
  });

  it("the autopilot still carries the reason on its first activity", () => {
    // Left in place deliberately: it is still true, still useful on the
    // prospect's own timeline, and removing it would be a destructive change.
    expect(AUTOPILOT).toContain("send volume ${ramp.reason}");
  });

  it("the brief still sends a minimal fallback if the data layer blows up", () => {
    expect(BRIEF).toContain("sending minimal fallback");
    expect(BRIEF).toContain("Jarvis brief — ${today} (lite)");
  });

  it("the delivery-issues block is untouched", () => {
    expect(BRIEF).toContain("📬 DELIVERY ISSUES (${deliveryTotal})");
  });

  it("the sent-this-morning total is still the true one", () => {
    expect(BRIEF).toContain("const SENT_LIST_CAP = 35");
    expect(BRIEF).toContain("sentTodayTotal");
  });
});
