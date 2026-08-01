import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pickScriptTouches, type ScriptTouch } from "@/lib/growth/call-sheet";

/**
 * The per-business call sheet quoted the wrong touch.
 *
 * The workspace builds a full call script with zero AI calls, and several of
 * its lines are written from "the last touch" — the opener ("I sent you an
 * email on Monday about …"), the "send me an email" objection ("I did —
 * Monday, …") and the voicemail ("I emailed you about …"). All three describe
 * something that was SENT.
 *
 * But the history it read from mixes messages with logged CALLS and MEETINGS.
 * Taking the most recent of all three produced, verbatim:
 *
 *   "I sent you a call on Monday about what AI could take off Walsh
 *    Joinery's plate, and wanted to put a voice to it."
 *
 * and answered "send me an email" with "I did — Monday" for a lead that had
 * only ever been rung. The second dial to the same prospect is exactly when a
 * logged call is the most recent touch, so the script was at its most wrong
 * precisely when it was needed most — and it is read aloud to a stranger.
 */

const t = (
  at: string,
  kind: ScriptTouch["kind"],
  extra: Partial<ScriptTouch> = {}
): ScriptTouch => ({
  at,
  kind,
  channelLabel: kind === "message" ? "Email" : kind === "call" ? "Call" : "Meeting",
  subject: null,
  ...extra,
});

// Oldest-first, the order the workspace builds them in.
const EMAIL_MON = t("2026-07-27T09:02:00Z", "message", {
  channelLabel: "Email",
  isEmail: true,
  subject: "quick thought on Walsh Joinery",
});
const DM_TUE = t("2026-07-28T10:00:00Z", "message", {
  channelLabel: "Instagram",
  isEmail: false,
});
const CALL_WED = t("2026-07-29T14:30:00Z", "call");
const MEETING_THU = t("2026-07-30T11:00:00Z", "meeting");
const REPLY_FRI = t("2026-07-31T08:00:00Z", "message", {
  channelLabel: "Email",
  isEmail: true,
  inbound: true,
});

describe("the bug: a logged call was quoted as something that was sent", () => {
  it("picks the email, not the call that came after it", () => {
    // THE regression. Before the fix this returned CALL_WED and the opener
    // read "I sent you a call on Wednesday".
    const { lastMessage } = pickScriptTouches([EMAIL_MON, CALL_WED]);
    expect(lastMessage).toBe(EMAIL_MON);
    expect(lastMessage!.kind).toBe("message");
  });

  it("never returns a call or a meeting as lastMessage", () => {
    for (const history of [
      [CALL_WED],
      [MEETING_THU],
      [CALL_WED, MEETING_THU],
      [EMAIL_MON, CALL_WED, MEETING_THU],
    ]) {
      const { lastMessage } = pickScriptTouches(history);
      expect(lastMessage === null || lastMessage.kind === "message").toBe(true);
    }
  });

  it("returns no message at all for a lead that has only ever been rung", () => {
    // This is what stops the script answering "send me an email" with "I did"
    // when nothing was ever sent.
    expect(pickScriptTouches([CALL_WED]).lastMessage).toBeNull();
    expect(pickScriptTouches([CALL_WED, MEETING_THU]).lastMessage).toBeNull();
  });
});

describe("the dial is still known about, just described honestly", () => {
  it("returns the most recent call or meeting separately", () => {
    expect(pickScriptTouches([EMAIL_MON, CALL_WED]).lastDial).toBe(CALL_WED);
    expect(pickScriptTouches([CALL_WED, MEETING_THU]).lastDial).toBe(MEETING_THU);
  });

  it("is null when they have never been rung", () => {
    expect(pickScriptTouches([EMAIL_MON, DM_TUE]).lastDial).toBeNull();
  });

  it("flags a dial that came AFTER the last message", () => {
    // The opener then acknowledges the chase instead of opening as if this
    // were the first attempt.
    expect(pickScriptTouches([EMAIL_MON, CALL_WED]).dialledSinceMessage).toBe(true);
  });

  it("does not flag one that came before it", () => {
    expect(pickScriptTouches([CALL_WED, MEETING_THU, t("2026-07-31T09:00:00Z", "message")]).dialledSinceMessage).toBe(
      false
    );
  });

  it("does not flag anything when there is no message to compare against", () => {
    expect(pickScriptTouches([CALL_WED]).dialledSinceMessage).toBe(false);
  });
});

describe("a reply is never something we sent", () => {
  it("excludes inbound from lastMessage", () => {
    const { lastMessage } = pickScriptTouches([EMAIL_MON, REPLY_FRI]);
    expect(lastMessage).toBe(EMAIL_MON);
  });

  it("leaves a reply-only history with nothing to quote", () => {
    expect(pickScriptTouches([REPLY_FRI]).lastMessage).toBeNull();
    expect(pickScriptTouches([REPLY_FRI]).lastDial).toBeNull();
  });
});

describe("the email/DM distinction the objection line turns on", () => {
  it("marks a real email", () => {
    expect(pickScriptTouches([EMAIL_MON]).lastMessage!.isEmail).toBe(true);
  });

  it("does not mark a DM", () => {
    // "Send me an email" → "I did" is false when the last touch was Instagram.
    expect(pickScriptTouches([DM_TUE]).lastMessage!.isEmail).toBe(false);
  });

  it("takes the newest message even when an older one was the email", () => {
    expect(pickScriptTouches([EMAIL_MON, DM_TUE]).lastMessage).toBe(DM_TUE);
  });
});

describe("it does not fall over on the shapes the page really passes", () => {
  it("handles an empty history", () => {
    expect(pickScriptTouches([])).toEqual({
      lastMessage: null,
      lastDial: null,
      dialledSinceMessage: false,
    });
  });

  it("does not mutate the array it was given", () => {
    // The page passes `outreachTouches` itself, which is rendered elsewhere on
    // the same page — an in-place sort or pop would reorder the history panel.
    const history = [EMAIL_MON, CALL_WED, MEETING_THU];
    const before = [...history];
    pickScriptTouches(history);
    expect(history).toEqual(before);
  });

  it("is pure", () => {
    const history = [EMAIL_MON, CALL_WED];
    expect(pickScriptTouches(history)).toEqual(pickScriptTouches(history));
  });
});

describe("the workspace is actually wired to it", () => {
  const PAGE = readFileSync(
    path.resolve(
      import.meta.dirname, "..", "..", "app", "growth", "(app)", "prospects", "[id]", "page.tsx"
    ),
    "utf8"
  );
  // Strip comments — this file documents the bug in prose, and matching my own
  // explanation of it instead of the code is how a source test goes vacuous.
  const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("uses the shared rule rather than its own filter", () => {
    expect(CODE).toContain("pickScriptTouches(outreachTouches)");
  });

  it("no longer has a lastSent that mixes sends with dials", () => {
    expect(CODE).not.toContain("lastSent");
  });

  it("tags every touch with its kind, which is what makes the split possible", () => {
    expect(CODE).toMatch(/kind: "message" as const/);
    expect(CODE).toMatch(/kind: \(a\.type === "call" \? "call" : "meeting"\)/);
    expect(CODE).toMatch(/isEmail: m\.channel === "email"/);
  });

  it("only claims 'I did' to the email objection when an email really went", () => {
    expect(CODE).toMatch(/if \(lastMessage\?\.isEmail\)/);
    expect(CODE).toMatch(/"Send me an email" → "I did/);
  });

  it("still gives a never-messaged lead an answer to that objection", () => {
    // Dropping the line entirely would leave the most common objection on a
    // cold dial unanswered.
    expect(CODE).toMatch(/"Send me an email" → "I will, today/);
  });

  it("opens on the dial when there is no send to reference", () => {
    expect(CODE).toContain("I tried you on ");
  });

  it("keeps the voicemail wording tied to a real send", () => {
    expect(CODE).toMatch(/lastMessage\.isEmail \? "emailed" : "messaged"/);
  });
});
