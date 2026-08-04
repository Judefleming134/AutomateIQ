import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DELIVERY_LOG_PREFIX,
  DELIVERY_BOUNCE_MARKER,
  DELIVERY_COMPLAINT_MARKER,
  DELIVERY_LOG_PATTERN,
  DELIVERY_COMPLAINT_PATTERN,
} from "./constants";

/**
 * The spam-complaint hold on the send ramp could never fire.
 *
 * `resolveSendRamp` counts complaints in the ramp window and stops the climb
 * dead if it finds any — one is one too many, because the tolerable complaint
 * rate is about 0.1%, far below what a sender at Jude's volume can even
 * measure. It counted them with a hand-written literal:
 *
 *     .ilike("content", "Email delivery:%COMPLAINED%")
 *
 * The Resend webhook writes:
 *
 *     "Email delivery: SPAM COMPLAINT — never email this address again — …"
 *
 * "SPAM COMPLAINT" does not contain "COMPLAINED". The pattern matched nothing
 * that has ever been written, `complaints` was always 0, and `if (complaints >
 * 0)` was unreachable code. The ramp climbed +50% a day — or DOUBLED, on a list
 * its own bounce test called clean — straight through every spam complaint the
 * domain received.
 *
 * Two surfaces promised the behaviour that could not happen:
 *   - the ramp's own doc comment: "stopping instantly if bounces or complaints
 *     appear"
 *   - Settings, on screen: "holds volume automatically if bounces or spam
 *     complaints appear. That protects the sending domain, which is far more
 *     expensive to repair than it is to grow slowly."
 *
 * And the ramp is explicit about the stakes: "once outreach lands in spam the
 * channel that earns the money is gone until it's rebuilt."
 *
 * The bounce half of that sentence was always real — bounces are counted off
 * ge_messages.status, which the same webhook sets. Only the complaint half was
 * dead, and complaints are the sharper of the two signals.
 *
 * Root cause is not the typo, it is that a writer and a reader in different
 * files agreed on a magic string by hand. The markers now live in constants.ts
 * and both sides compose from them — which is what the first describe block
 * below actually tests: the REAL string the webhook builds, fed to the REAL
 * pattern the ramp queries with.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const WEBHOOK = readFileSync(
  path.join(ROOT, "app", "api", "webhooks", "resend", "route.ts"),
  "utf8"
);
const AUTOPILOT = readFileSync(path.join(ROOT, "lib", "growth", "autopilot.ts"), "utf8");
const SETTINGS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "settings", "page.tsx"),
  "utf8"
);

/** PostgREST `ilike`: case-insensitive, `%` matches any run of characters. */
function ilike(value: string, pattern: string): boolean {
  const rx = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*");
  return new RegExp(`^${rx}$`, "i").test(value);
}

const TO = "info@murphyplumbing.ie";

/** Exactly what app/api/webhooks/resend/route.ts logs, per event type. */
const logged = {
  complaint: `${DELIVERY_LOG_PREFIX} ${DELIVERY_COMPLAINT_MARKER} — never email this address again — address ${TO} removed from the record`,
  bounce: `${DELIVERY_LOG_PREFIX} ${DELIVERY_BOUNCE_MARKER} (mailbox does not exist) — address ${TO} removed from the record`,
  bounceRolledBack: `${DELIVERY_LOG_PREFIX} ${DELIVERY_BOUNCE_MARKER} (mailbox does not exist) — address ${TO} removed from the record; status rolled back to outreach_ready (not actually reached)`,
  delayed: `${DELIVERY_LOG_PREFIX} delayed to ${TO} — their mail server is slow, usually resolves on its own`,
  delivered: `${DELIVERY_LOG_PREFIX} delivered to ${TO}`,
};

/** The literal the ramp used to carry. */
const OLD_PATTERN = "Email delivery:%COMPLAINED%";

describe("what the webhook writes, matched by what the ramp queries", () => {
  it("a spam complaint is FOUND — the whole point", () => {
    expect(ilike(logged.complaint, DELIVERY_COMPLAINT_PATTERN)).toBe(true);
  });

  it("the old pattern found it in none of its forms", () => {
    // The bug, demonstrated rather than described.
    expect(ilike(logged.complaint, OLD_PATTERN)).toBe(false);
    for (const line of Object.values(logged)) {
      expect(ilike(line, OLD_PATTERN), line).toBe(false);
    }
  });

  it.each([
    ["a bounce", "bounce"],
    ["a bounce that rolled the status back", "bounceRolledBack"],
    ["a delivery delay", "delayed"],
    ["a successful delivery", "delivered"],
  ] as const)("%s does NOT trip the complaint hold", (_label, key) => {
    // A false hold would throttle the send for no reason — the opposite
    // failure, and it costs real outreach.
    expect(ilike(logged[key], DELIVERY_COMPLAINT_PATTERN)).toBe(false);
  });

  it("every event still matches the broad pattern the brief and Jarvis use", () => {
    for (const line of Object.values(logged)) {
      expect(ilike(line, DELIVERY_LOG_PATTERN), line).toBe(true);
    }
  });

  it("matching is case-insensitive, as ilike is", () => {
    expect(ilike(logged.complaint.toLowerCase(), DELIVERY_COMPLAINT_PATTERN)).toBe(true);
    expect(ilike(logged.complaint.toUpperCase(), DELIVERY_COMPLAINT_PATTERN)).toBe(true);
  });
});

describe("neither side hand-writes the string any more", () => {
  it("the webhook composes its markers from the shared constants", () => {
    expect(WEBHOOK).toContain("DELIVERY_COMPLAINT_MARKER");
    expect(WEBHOOK).toContain("DELIVERY_BOUNCE_MARKER");
    expect(WEBHOOK).toContain("DELIVERY_LOG_PREFIX");
  });

  it("the webhook no longer contains a retyped literal", () => {
    const code = WEBHOOK.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain('"SPAM COMPLAINT');
    expect(code).not.toContain("`Email delivery:");
  });

  it("the ramp queries with the shared pattern", () => {
    expect(AUTOPILOT).toContain('.ilike("content", DELIVERY_COMPLAINT_PATTERN)');
    const code = AUTOPILOT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("COMPLAINED");
  });

  it("the brief and Jarvis use the shared broad pattern too", () => {
    for (const rel of [
      ["lib", "cron", "jarvis-morning-brief.ts"],
      ["app", "growth", "(app)", "jarvis", "actions.ts"],
    ]) {
      const src = readFileSync(path.join(ROOT, ...rel), "utf8");
      expect(src, rel.join("/")).toContain('.ilike("content", DELIVERY_LOG_PATTERN)');
      expect(src, rel.join("/")).not.toContain('"Email delivery:%"');
    }
  });
});

describe("the hold it unlocks is still wired the way it was", () => {
  it("any complaint at all stops the climb", () => {
    expect(AUTOPILOT).toContain("if (complaints > 0)");
  });

  it("a hold can never send MORE than was asked for", () => {
    // The clamp order this file already reasons about — unchanged.
    expect(AUTOPILOT).toContain(
      "const target = Math.min(requested, Math.max(RAMP_FLOOR, recentPeak));"
    );
  });

  it("the hold reason still names the complaint count", () => {
    expect(AUTOPILOT).toContain("spam complaint${complaints === 1");
    expect(AUTOPILOT).toContain("Volume will not grow until that's clean");
  });

  it("the bounce hold — which always worked — is untouched", () => {
    expect(AUTOPILOT).toContain("total >= 20 && bounceRate > MAX_BOUNCE_RATE");
    expect(AUTOPILOT).toContain('if (r.status === "failed") bounced++;');
  });

  it("the run cap still applies to the hold paths", () => {
    // capToRun on every return, including both holds.
    const fn = AUTOPILOT.slice(
      AUTOPILOT.indexOf("export async function resolveSendRamp"),
      AUTOPILOT.indexOf("export async function autoQueueTopDrafts")
    );
    expect((fn.match(/return capToRun\(/g) ?? []).length).toBe(3);
  });
});

describe("the promise on screen is now true", () => {
  it("Settings still tells Jude volume is held on complaints", () => {
    // Kept, not softened — because it is now the behaviour.
    expect(SETTINGS).toContain("holds volume automatically if bounces or spam complaints appear");
  });

  it("the webhook still scrubs the address and marks the message failed", () => {
    // The other two consequences of a complaint, which did work.
    expect(WEBHOOK).toContain('.update({ email: null })');
    expect(WEBHOOK).toContain('.update({ status: "failed" })');
  });

  it("a complaint still does NOT roll the status back — it was delivered", () => {
    expect(WEBHOOK).toContain('type === "email.bounced"\n        ? prospect.status');
  });
});
