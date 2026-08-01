import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  messageInstant,
  sortByInstantDesc,
  latestRealMessage,
  awaitingReply,
} from "@/lib/growth/inbox-order";

/**
 * The inbox ordered conversations by `created_at` — when a draft was WRITTEN.
 *
 * For a message composed and sent in one go that is the same second, so the
 * difference never showed. But the engine's main path is not that: autopilot
 * drafts overnight and the 07:00 cron sends, so almost every real outreach
 * message is created hours before it leaves.
 *
 *     Mon 09:00  autopilot drafts a follow-up        (queued)
 *     Mon 14:00  the prospect replies                (inbound)
 *     Tue 07:00  the queued draft actually sends     (sent)
 *
 * Read by created_at, our message came first and it looked like they replied
 * to us. And "who spoke last" read as THEM, so the conversation was flagged
 * "Reply due" after it had already been answered.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const out = (id: string, created: string, status: string, sent?: string) => ({
  id,
  direction: "outbound",
  status,
  created_at: created,
  sent_at: sent ?? null,
});

const inb = (id: string, created: string) => ({
  id,
  direction: "inbound",
  status: "received",
  created_at: created,
  sent_at: null,
});

/** THE scenario, exactly as the 07:00 cron produces it. */
const overnightThread = [
  inb("their-reply", "2026-08-03T14:00:00Z"),
  out("our-followup", "2026-08-03T09:00:00Z", "sent", "2026-08-04T07:00:00Z"),
];

describe("when a message actually happened", () => {
  it("a sent message counts from when it SENT", () => {
    expect(messageInstant(out("m", "2026-08-03T09:00:00Z", "sent", "2026-08-04T07:00:00Z"))).toBe(
      "2026-08-04T07:00:00Z"
    );
  });

  it("a draft or a queued message counts from when it was written", () => {
    // It hasn't happened yet. The time it was typed is the only honest thing
    // to order it by.
    expect(messageInstant(out("m", "2026-08-03T09:00:00Z", "draft"))).toBe("2026-08-03T09:00:00Z");
    expect(messageInstant(out("m", "2026-08-03T09:00:00Z", "queued"))).toBe("2026-08-03T09:00:00Z");
    expect(messageInstant(out("m", "2026-08-03T09:00:00Z", "failed"))).toBe("2026-08-03T09:00:00Z");
  });

  it("an inbound message counts from when it arrived", () => {
    expect(messageInstant(inb("m", "2026-08-03T14:00:00Z"))).toBe("2026-08-03T14:00:00Z");
  });

  it("falls back to created_at when a sent message has no sent_at", () => {
    // Older rows predating the sent_at column, and anything the send path
    // failed to stamp. Never NaN, never undefined.
    expect(messageInstant(out("m", "2026-08-03T09:00:00Z", "sent"))).toBe("2026-08-03T09:00:00Z");
    expect(messageInstant({ ...out("m", "2026-08-03T09:00:00Z", "sent"), sent_at: null })).toBe(
      "2026-08-03T09:00:00Z"
    );
  });
});

describe("the conversation reads in the order it was exchanged", () => {
  it("puts our overnight send AFTER their reply, because that is when it went", () => {
    const ordered = sortByInstantDesc(overnightThread);
    expect(ordered.map((m) => m.id)).toEqual(["our-followup", "their-reply"]);
  });

  it("created_at ordering would have got this backwards", () => {
    // The shipped behaviour, shown for contrast: our message first, so the
    // thread reads as though they replied to us.
    const byCreated = overnightThread
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    expect(byCreated.map((m) => m.id)).toEqual(["their-reply", "our-followup"]);
  });

  it("leaves same-second sends alone", () => {
    // A message composed and sent in one go — the common manual case. Nothing
    // about it should change.
    const t = [
      out("b", "2026-08-03T11:00:00Z", "sent", "2026-08-03T11:00:00Z"),
      inb("a", "2026-08-03T10:00:00Z"),
    ];
    expect(sortByInstantDesc(t).map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("does not mutate the array it was given", () => {
    const t = [inb("a", "2026-08-01T10:00:00Z"), inb("b", "2026-08-02T10:00:00Z")];
    sortByInstantDesc(t);
    expect(t.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("handles an empty thread", () => {
    expect(sortByInstantDesc([])).toEqual([]);
  });
});

describe("who spoke last", () => {
  it("is US when our reply sent after their message, even though it was drafted before", () => {
    // THE bug. This conversation was answered; the inbox said "Reply due".
    expect(latestRealMessage(overnightThread)?.id).toBe("our-followup");
    expect(awaitingReply(overnightThread)).toBe(false);
  });

  it("is THEM when they have written since our last send", () => {
    const thread = [
      inb("their-reply", "2026-08-04T09:00:00Z"),
      out("ours", "2026-08-03T09:00:00Z", "sent", "2026-08-03T09:05:00Z"),
    ];
    expect(awaitingReply(thread)).toBe(true);
  });

  it("an UNSENT auto-draft never counts as us replying", () => {
    // The engine auto-drafts a suggested reply after every inbound. If that
    // registered as "we replied", the Reply-due flag would clear on every
    // single conversation the moment the draft was written.
    const thread = [
      out("auto-draft", "2026-08-04T14:05:00Z", "draft"),
      inb("their-reply", "2026-08-04T14:00:00Z"),
    ];
    expect(latestRealMessage(thread)?.id).toBe("their-reply");
    expect(awaitingReply(thread)).toBe(true);
  });

  it("a queued reply is not a sent reply", () => {
    // It goes at 07:00 tomorrow. Until it does, they are still waiting.
    const thread = [
      out("queued", "2026-08-04T14:05:00Z", "queued"),
      inb("their-reply", "2026-08-04T14:00:00Z"),
    ];
    expect(awaitingReply(thread)).toBe(true);
  });

  it("a FAILED send is not a reply either", () => {
    const thread = [
      out("failed", "2026-08-04T14:05:00Z", "failed"),
      inb("their-reply", "2026-08-04T14:00:00Z"),
    ];
    expect(awaitingReply(thread)).toBe(true);
  });

  it("is undefined on a thread with nothing real in it", () => {
    expect(latestRealMessage([out("d", "2026-08-04T14:00:00Z", "draft")])).toBeUndefined();
    expect(awaitingReply([])).toBe(false);
  });

  it("does not depend on the order the thread arrives in", () => {
    const forwards = [...overnightThread].reverse();
    expect(latestRealMessage(forwards)?.id).toBe("our-followup");
    expect(latestRealMessage(overnightThread)?.id).toBe("our-followup");
  });
});

describe("the inbox uses it everywhere the old field was used", () => {
  const PAGE = readFileSync(
    path.join(ROOT, "app", "growth", "(app)", "inbox", "page.tsx"),
    "utf8"
  );

  it("orders the threads by it", () => {
    expect(PAGE).toContain("sortByInstantDesc(threadRows ?? [])");
  });

  it("decides who spoke last with it", () => {
    expect(PAGE).toContain("latestRealMessage(thread)");
  });

  it("sorts the conversation list by it, in both directions", () => {
    // Reply-due is oldest-first (longest wait about to go cold); answered is
    // newest-first. Both must read the same clock.
    expect(PAGE).toContain("messageInstant(a.latestReal) < messageInstant(b.latestReal) ? -1 : 1");
    expect(PAGE).toContain("messageInstant(a.latestReal) < messageInstant(b.latestReal) ? 1 : -1");
  });

  it("shows the relative time from it", () => {
    // "1d" on a message that went out this morning is the same lie in a
    // smaller space.
    expect(PAGE).toContain("relTime(messageInstant(c.latestReal))");
    expect(PAGE).not.toContain("relTime(c.latestReal.created_at)");
  });

  it("no longer ranks conversations on created_at anywhere", () => {
    expect(PAGE).not.toContain("a.latestReal.created_at");
  });

  it("keeps the labelled timestamps, which already showed the real send time", () => {
    expect(PAGE).toContain("function stampLabel");
    expect(PAGE).toContain("`Sent ${fmt(m.sent_at ?? m.created_at)}`");
  });
});
