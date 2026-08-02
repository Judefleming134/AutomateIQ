import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { messageInstant } from "@/lib/growth/inbox-order";

/**
 * The prospect workspace shows ONE timeline with two kinds of entry in it:
 * messages and activities. Activities are stamped when they actually happen.
 * Messages were placed by `created_at` — when a draft was WRITTEN.
 *
 * The 07:00 cron sends what the nightly run drafted, so an outreach email is
 * routinely created hours before it goes. Mixing the two frames in one list
 * put the email BELOW a call logged after it was drafted — while the stamp on
 * the email itself already read "Sent 07:00", because stampLabel had it right
 * all along. The page contradicted its own timestamps, on screen, in the same
 * list, on the record Jude opens for every lead.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

type Entry = { kind: "message" | "activity"; at: string; label: string };

const msg = (label: string, created: string, status: string, sent?: string) => ({
  label,
  direction: "outbound",
  status,
  created_at: created,
  sent_at: sent ?? null,
});

/** The real day this bug produces. */
const MESSAGES = [
  msg("EMAIL: the follow-up itself", "2026-08-03T09:00:00Z", "sent", "2026-08-04T07:00:00Z"),
];
const ACTIVITIES = [
  { label: "Logged a call — no answer", created_at: "2026-08-03T14:00:00Z" },
  { label: "Email sent to Byrne Plumbing", created_at: "2026-08-04T07:00:05Z" },
];

const build = (at: (m: (typeof MESSAGES)[number]) => string): Entry[] =>
  [
    ...MESSAGES.map((m) => ({ kind: "message" as const, at: at(m), label: m.label })),
    ...ACTIVITIES.map((a) => ({
      kind: "activity" as const,
      at: a.created_at,
      label: a.label,
    })),
  ].sort((x, y) => (x.at < y.at ? 1 : -1));

describe("the timeline reads in the order things happened", () => {
  it("puts the email where it was SENT, not where it was drafted", () => {
    const after = build(messageInstant).map((e) => e.label);
    expect(after).toEqual([
      "Email sent to Byrne Plumbing",
      "EMAIL: the follow-up itself",
      "Logged a call — no answer",
    ]);
  });

  it("created_at ordering put the email below a call that came after it", () => {
    // The shipped behaviour, for contrast: the email sinks to the bottom,
    // under a call that happened while it was still an unsent draft.
    const before = build((m) => m.created_at).map((e) => e.label);
    expect(before).toEqual([
      "Email sent to Byrne Plumbing",
      "Logged a call — no answer",
      "EMAIL: the follow-up itself",
    ]);
    // And the giveaway: the "Email sent" ACTIVITY and the email itself end up
    // two rows apart, with an unrelated call wedged between them.
    expect(before.indexOf("EMAIL: the follow-up itself") - before.indexOf("Email sent to Byrne Plumbing")).toBe(2);
  });

  it("keeps the email beside its own 'sent' activity", () => {
    const after = build(messageInstant).map((e) => e.label);
    expect(after.indexOf("EMAIL: the follow-up itself") - after.indexOf("Email sent to Byrne Plumbing")).toBe(1);
  });

  it("leaves a message composed and sent in one go exactly where it was", () => {
    // The manual case: created_at and sent_at are the same second, so nothing
    // about it moves.
    const same = msg("manual send", "2026-08-03T11:00:00Z", "sent", "2026-08-03T11:00:00Z");
    expect(messageInstant(same)).toBe(same.created_at);
  });

  it("leaves an unsent draft at its draft time", () => {
    // A draft has not happened. Placing it by anything else would be a lie in
    // the other direction.
    for (const status of ["draft", "queued", "failed"]) {
      const d = msg("draft", "2026-08-03T09:00:00Z", status);
      expect(messageInstant(d), status).toBe("2026-08-03T09:00:00Z");
    }
  });
});

describe("the workspace uses it", () => {
  const PAGE = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "prospects", "[id]", "page.tsx"),
    "utf8"
  );

  it("places messages on the timeline by when they happened", () => {
    expect(PAGE).toContain('at: messageInstant(m)');
    expect(PAGE).not.toContain('kind: "message" as const, at: m.created_at');
  });

  it("still stamps each message with its real send time", () => {
    // stampLabel was always right — it is what made the wrong ordering
    // visible. It must stay.
    expect(PAGE).toContain("function stampLabel");
    expect(PAGE).toContain("stampLabel(entry.m)");
  });

  it("still fetches sent_at, or there would be nothing to order by", () => {
    expect(PAGE).toContain("sentiment, sent_at, created_at");
  });

  it("shares the rule with the inbox rather than copying it", () => {
    expect(PAGE).toContain('from "@/lib/growth/inbox-order"');
  });
});
