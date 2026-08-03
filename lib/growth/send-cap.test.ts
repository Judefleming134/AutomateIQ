import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_SENDS_PER_RUN } from "./autopilot";

/**
 * The send ramp promised a number the sender could never reach.
 *
 * `resolveSendRamp` decides how many first-touch emails to QUEUE.
 * `runQueuedEmailAutopilot` decides how many actually SEND — and it stopped at
 * a bare `30`, sized by the 60-second dispatch budget it shares with the brief.
 *
 * The two never spoke, and the loop closes on itself: the ramp's ceiling comes
 * from `recentPeak`, which is measured from SENDS, so the cap fed straight back
 * into the ramp. On the DEFAULT target of 50 the brief settled on
 *
 *     "at your target of 50/day (peak 30)"
 *
 * from the third morning onward, for ever, while thirty emails went out. Not
 * "ramping" — it claimed to have arrived. Twenty a day, six hundred a month,
 * reported as sent and not sent. That is "reporting success for work that
 * didn't happen", and the settings box (max 2000) invited it.
 *
 * The cap is real and is NOT moved here — widening the send window is its own
 * piece of work, logged in docs/OUTSTANDING.md. What changes is that one number
 * is now shared, the queue stops carrying mail that was never going out, and
 * the reason line says the ceiling out loud.
 *
 * Throughput is deliberately unchanged: the send loop already stopped at 30.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(path.join(ROOT, "lib", "growth", "autopilot.ts"), "utf8");
const SETTINGS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "settings", "page.tsx"),
  "utf8"
);

const RAMP_FLOOR = 20;
const RAMP_STEP = 1.5;
const RAMP_STEP_CLEAN = 2.0;

/** The ramp arithmetic, transcribed. Both variants, so the fix is comparable. */
function target(requested: number, recentPeak: number, proven = false, capped = true) {
  const step = proven ? RAMP_STEP_CLEAN : RAMP_STEP;
  const raw = Math.min(requested, Math.max(RAMP_FLOOR, Math.ceil(recentPeak * step)));
  return capped ? Math.min(raw, MAX_SENDS_PER_RUN) : raw;
}

/**
 * Run the engine forward and report where it settles.
 *
 * Models `proven` the way resolveSendRamp does — 40+ sends in the window at
 * under 1% bounces earns the doubling step. A healthy list crosses that on the
 * third morning, so it is the case Jude is actually in, and the one where the
 * stranded pile is biggest.
 */
function settle(requested: number, days: number, capped: boolean) {
  let peak = 0;
  let leftover = 0;
  let total = 0;
  let last = { queued: 0, sent: 0, stranded: 0 };
  for (let d = 0; d < days; d++) {
    const queued = Math.max(leftover, target(requested, peak, total >= 40, capped));
    const sent = Math.min(queued, MAX_SENDS_PER_RUN);
    last = { queued, sent, stranded: queued - sent };
    leftover = last.stranded;
    peak = Math.max(peak, sent);
    total += sent;
  }
  return last;
}

describe("the cap the ramp could not see", () => {
  it("settles at the cap however high the target, before AND after", () => {
    // The fix does not add throughput and must not pretend to.
    for (const requested of [50, 200, 2000]) {
      expect(settle(requested, 10, false).sent).toBe(MAX_SENDS_PER_RUN);
      expect(settle(requested, 10, true).sent).toBe(MAX_SENDS_PER_RUN);
    }
  });

  it("stops stranding mail in the queue that was never going out", () => {
    // 50 is the default in lib/growth/auth.ts, so this is what Jude has.
    expect(settle(50, 10, false).stranded).toBe(20);
    expect(settle(50, 10, true).stranded).toBe(0);
    // And the sends are identical either way — the clamp removes queued mail,
    // not sent mail.
    expect(settle(50, 10, true).sent).toBe(settle(50, 10, false).sent);
  });

  it("a stranded queued draft is not harmless", () => {
    // listAutopilotCandidates drops any prospect with a queued email from the
    // "ready to send" list, so a permanently-queued draft parks its prospect
    // where it neither sends nor shows as available.
    expect(SRC).toContain("queuedProspectIds");
    expect(SRC).toMatch(/if \(queuedProspectIds\.has\(p\.id\)\) continue;/);
  });

  it("below the ceiling nothing changes at all", () => {
    // The engine works exactly as advertised under 30 — the bug only bites
    // where the settings box invited a bigger number.
    for (const requested of [10, 20, 25, MAX_SENDS_PER_RUN]) {
      const before = settle(requested, 10, false);
      const after = settle(requested, 10, true);
      expect(after).toEqual(before);
      expect(after.stranded).toBe(0);
    }
  });

  it("the ceiling binds even when manual sends push the peak above it", () => {
    // recentPeak counts every outbound send, including the ones Jude fires by
    // hand from the inbox — so the ramp's ceiling can legitimately exceed what
    // the autopilot itself can carry.
    expect(target(200, 80)).toBe(MAX_SENDS_PER_RUN);
    expect(target(200, 80, false, false)).toBe(120);
  });
});

describe("one number, shared", () => {
  it("the sender slices on the constant, not a literal", () => {
    expect(SRC).toContain("export const MAX_SENDS_PER_RUN = 30");
    expect(SRC).toContain(".slice(0, MAX_SENDS_PER_RUN)");
    // The bare literal that nothing else could see.
    expect(SRC).not.toContain(".slice(0, 30)");
  });

  it("every ramp path goes through the clamp", () => {
    const fn = SRC.slice(
      SRC.indexOf("export async function resolveSendRamp"),
      SRC.indexOf("export async function autoQueueTopDrafts")
    );
    const returns = fn.match(/return \{|return capToRun\(\{/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(3); // 2 holds + the climb
    // Not one of them may return a raw object: the hold paths matter most,
    // because recentPeak can sit above the ceiling there.
    expect(returns.every((r) => r === "return capToRun({")).toBe(true);
  });

  it("the decision carries the fact, so callers can render it", () => {
    expect(SRC).toContain("cappedByRun: boolean");
    expect(SRC).toContain("cappedByRun: false");
    expect(SRC).toContain("cappedByRun: true");
  });
});

describe("what the morning brief says", () => {
  /** capToRun, transcribed. */
  const capReason = (reason: string, requested: number, t: number) =>
    t <= MAX_SENDS_PER_RUN
      ? reason
      : `${reason} — capped at ${MAX_SENDS_PER_RUN}/day, because one morning run sends at most ${MAX_SENDS_PER_RUN} emails inside its time budget (which also has to fit your brief). Your target of ${requested} can't be reached by raising that number alone.`;

  it("no longer claims to have arrived at a target it cannot reach", () => {
    const before = "at your target of 50/day (peak 30, 0.0% bounces)";
    const after = capReason("at 30/day (peak 30, 0.0% bounces)", 50, 50);
    expect(before).toContain("at your target of 50/day");
    expect(after).not.toContain("at your target of 50/day");
    expect(after).toContain("capped at 30/day");
    expect(after).toContain("Your target of 50");
  });

  it("keeps the working line word-for-word when the target IS reached", () => {
    // Under the ceiling this is the sentence Jude already reads. Changing it
    // would be churn on a morning where nothing is wrong.
    expect(SRC).toContain("`at your target of ${requested}/day (${stats})`");
    expect(capReason("at your target of 25/day (peak 25, 0.0% bounces)", 25, 25)).toBe(
      "at your target of 25/day (peak 25, 0.0% bounces)"
    );
  });

  it("estimates days to the reachable destination, by the step in use", () => {
    // The old estimate divided by `requested` using RAMP_STEP regardless, so
    // above the ceiling it printed "about 1 more days" every single morning.
    expect(SRC).toContain("const destination = Math.min(requested, MAX_SENDS_PER_RUN)");
    expect(SRC).toContain("Math.log(destination / Math.max(effective, 1)) / Math.log(step)");
    expect(SRC).not.toContain("Math.log(requested / Math.max(target, 1))");
  });
});

describe("the queue fetch no longer caps the priority sort", () => {
  it("fetches well past what one run sends", () => {
    // Comments stripped: the new limit's own note quotes the old `.limit(50)`
    // to explain what it replaced, and matching that would be the test reading
    // the explanation instead of the code.
    const fn = SRC.slice(SRC.indexOf("export async function runQueuedEmailAutopilot"))
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fn).toContain(".limit(Math.max(200, MAX_SENDS_PER_RUN * 4))");
    expect(fn).not.toContain(".limit(50)");
  });

  it("still sorts chases ahead of cold touches, then by score", () => {
    // The reason the window matters: a chase has a 7-day clock, a first touch
    // has none. A window that ended before the chase row meant the sort could
    // not see it to prioritise it.
    const fn = SRC.slice(SRC.indexOf("export async function runQueuedEmailAutopilot"));
    expect(fn).toContain("chaseRank");
    expect(fn).toContain("chaseRank(a) - chaseRank(b)");
    expect(fn).toContain("lead_score");
  });
});

describe("the number is named where it is set", () => {
  it("the settings help text states the real ceiling", () => {
    const flat = SETTINGS.replace(/\s+/g, " ");
    expect(SETTINGS).toContain('import { MAX_SENDS_PER_RUN } from "@/lib/growth/autopilot"');
    expect(flat).toContain("has no effect yet");
    expect(flat).toContain("{MAX_SENDS_PER_RUN}");
  });

  it("the input still accepts the old range — nothing removed", () => {
    // Additive: the field, its bounds and the destination explanation all stay.
    expect(SETTINGS).toContain('name="daily_send_target"');
    expect(SETTINGS).toContain("max={2000}");
    expect(SETTINGS.replace(/\s+/g, " ")).toContain(
      "is where you want to get to, not what goes out tomorrow"
    );
  });
});

describe("the 07:00 path is untouched", () => {
  it("still runs the full review gate on every send", () => {
    expect(SRC).toContain("reviewOutreachEmail");
    expect(SRC).toContain("sanitizeOutreachBody");
    expect(SRC).toContain("draftLooksBroken");
  });

  it("still holds a cold touch at a prospect who has moved on", () => {
    expect(SRC).toContain("COLD_PURPOSES.includes");
    expect(SRC).toContain("!PRE_REPLY_STATUSES.includes(prospect.status)");
  });

  it("still runs the cross-company contamination check", () => {
    expect(SRC).toContain("batchCompanies");
    expect(SRC).toContain('held, not sent (mentions "${foreign}" instead of ${own})');
  });

  it("still logs held sends for the brief", () => {
    expect(SRC).toContain("Jarvis nightly: ${result.error}");
  });

  it("still paces sends under the provider's rate limit", () => {
    expect(SRC).toContain("setTimeout(r, 350)");
  });
});
