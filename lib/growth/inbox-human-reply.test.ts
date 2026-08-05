import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isAwaiting, isHumanReply } from "./awaiting";
import { messageInstant, latestRealMessage } from "./inbox-order";
import { classifyInbound } from "./inbound-classify";

/**
 * The inbox flagged out-of-office bounces and opt-outs as "Reply due", and
 * sorted them to the top.
 *
 * `latestRealMessage()` filters unsent DRAFTS — the thing it was written for —
 * but it does not know an auto-responder from a person. So the inbox's rule
 * was simply "the newest thing that happened was inbound", and:
 *
 *   • a prospect who wrote, got an answer, then set an out-of-office came back
 *     as "Reply due"
 *   • someone who replied STOP was flagged as needing an answer — and this
 *     group is sorted LONGEST-WAITING FIRST, so they went to the very top of
 *     the list, above the people actually waiting
 *   • the composer's reply context was that newest inbound, so Jarvis drafted
 *     a reply to "I am on annual leave until 12 August" rather than to the
 *     question underneath it
 *
 * The morning brief has always excluded both. lib/growth/awaiting.ts exists to
 * give the rule one home after the dashboard and Jarvis were fixed — and its
 * own docstring lists "the inbox" among the surfaces already on that rule. It
 * wasn't. So the dashboard could say "3 replies are waiting on you" and the
 * click-through show seven orange badges: a count that doesn't match what its
 * click-through shows, between two screens that are one tap apart.
 *
 * Nothing is hidden by the fix. The conversation stays in the list, the thread
 * still shows every message, and the row now SAYS what the newest message was.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const INBOX = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "inbox", "page.tsx"),
  "utf8"
);
const DASHBOARD = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "page.tsx"),
  "utf8"
);

type M = {
  direction: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  subject?: string | null;
  body?: string | null;
};
const inbound = (created_at: string, body: string, subject = ""): M => ({
  direction: "inbound", status: "received", created_at, sent_at: null, subject, body,
});
const sent = (sent_at: string): M => ({
  direction: "outbound", status: "sent", created_at: sent_at, sent_at, subject: "", body: "Reply from us",
});
const draft = (created_at: string): M => ({
  direction: "outbound", status: "draft", created_at, sent_at: null, subject: "", body: "Suggested reply",
});

/** The inbox's rule, before and after, run over a thread (newest-first). */
const oldRule = (thread: M[]) => latestRealMessage(thread)?.direction === "inbound";
const newRule = (thread: M[]) => {
  const lastHuman = thread.find((m) => m.direction === "inbound" && isHumanReply(m));
  const lastSent = thread.find((m) => m.direction === "outbound" && m.status === "sent");
  return Boolean(
    lastHuman &&
      isAwaiting(messageInstant(lastHuman), lastSent ? messageInstant(lastSent) : null)
  );
};

const OOO =
  "I am currently out of the office on annual leave and will return on 12 August. For anything urgent please contact reception.";
const OPT_OUT = "Please unsubscribe me from this list.";
const REAL = "Sounds interesting — what would it cost for a team of four?";

describe("the classifier agrees these are not people waiting", () => {
  it.each([
    ["an out-of-office", OOO, false],
    ["an opt-out", OPT_OUT, false],
    ["a real question", REAL, true],
  ])("%s", (_label, body, human) => {
    expect(isHumanReply({ subject: "", body })).toBe(human);
  });
});

describe("the cases the inbox got wrong", () => {
  it("answered, then they went on holiday — was 'Reply due', now isn't", () => {
    const thread = [
      inbound("2026-08-05T09:00:00Z", OOO),
      sent("2026-08-04T10:00:00Z"),
      inbound("2026-08-03T08:00:00Z", REAL),
    ];
    expect(oldRule(thread)).toBe(true);  // the bug
    expect(newRule(thread)).toBe(false); // answered — nothing is waiting
  });

  it("they asked to be removed — was 'Reply due', now isn't", () => {
    // Telling Jude to "answer this first" on someone who said STOP is the
    // worst version of this: the engine is pointing him at a person who asked
    // him to stop.
    const thread = [inbound("2026-08-05T09:00:00Z", OPT_OUT)];
    expect(oldRule(thread)).toBe(true);
    expect(newRule(thread)).toBe(false);
  });

  it("a REAL reply still counts, obviously", () => {
    const thread = [inbound("2026-08-05T09:00:00Z", REAL)];
    expect(oldRule(thread)).toBe(true);
    expect(newRule(thread)).toBe(true);
  });

  it("a real question hiding UNDER an auto-reply still counts", () => {
    // The case both rules must get right and only one does: they asked
    // something, nobody answered, and then their auto-responder landed on top.
    const thread = [
      inbound("2026-08-05T09:00:00Z", OOO),
      inbound("2026-08-05T08:00:00Z", REAL),
    ];
    expect(newRule(thread)).toBe(true);
  });

  it("an unsent draft still doesn't clear it — the original guarantee holds", () => {
    // latestRealMessage was written for exactly this. The new rule must not
    // lose it: the engine auto-drafts after every inbound.
    const thread = [
      draft("2026-08-05T09:05:00Z"),
      inbound("2026-08-05T09:00:00Z", REAL),
    ];
    expect(newRule(thread)).toBe(true);
  });

  it("a genuine send after their reply does clear it", () => {
    const thread = [
      sent("2026-08-05T10:00:00Z"),
      inbound("2026-08-05T09:00:00Z", REAL),
    ];
    expect(newRule(thread)).toBe(false);
  });
});

describe("the inbox and the dashboard now count the same thing", () => {
  /** Five conversations, as they'd sit in a real inbox. */
  const threads: M[][] = [
    [inbound("2026-08-05T09:00:00Z", REAL)],                                  // waiting
    [inbound("2026-08-04T09:00:00Z", REAL)],                                  // waiting, older
    [inbound("2026-08-05T09:00:00Z", OOO), sent("2026-08-04T10:00:00Z"),
     inbound("2026-08-03T08:00:00Z", REAL)],                                  // handled
    [inbound("2026-08-05T07:00:00Z", OPT_OUT)],                               // opted out
    [sent("2026-08-05T11:00:00Z"), inbound("2026-08-05T09:00:00Z", REAL)],    // answered
  ];

  it("the old rule over-counted by the auto-replies", () => {
    expect(threads.filter(oldRule)).toHaveLength(4);
    expect(threads.filter(newRule)).toHaveLength(2);
  });

  it("and the two that remain are the two people actually waiting", () => {
    const waiting = threads.filter(newRule);
    for (const t of waiting) {
      const human = t.find((m) => m.direction === "inbound" && isHumanReply(m));
      expect(human?.body).toBe(REAL);
    }
  });

  it("the dashboard's number is built from the same helper", () => {
    // If these two ever diverge again it is because one of them stopped
    // calling this file.
    expect(DASHBOARD).toContain('from "@/lib/growth/awaiting"');
    expect(DASHBOARD).toContain("isHumanReply");
    expect(INBOX).toContain('from "@/lib/growth/awaiting"');
    // Not just imported — the badge is DERIVED from it. Importing the helper
    // and then computing the flag some other way is the exact state this file
    // found the inbox in.
    expect(INBOX).toContain(
      'const lastHumanInbound = thread.find(\n        (m) => m.direction === "inbound" && isHumanReply(m)\n      );'
    );
    expect(INBOX).toContain("const awaitingUs = Boolean(\n        lastHumanInbound &&");
    expect(INBOX).not.toContain('const awaitingUs = latestReal?.direction === "inbound";');
  });
});

describe("ordering: an auto-responder must not reset a reply's age", () => {
  it("the wait is measured from the human message, not the newest one", () => {
    // "Reply due" is sorted longest-waiting first. Measuring from the newest
    // inbound meant an out-of-office arriving today made a five-day-old
    // question look like it landed this morning, and sank it to the bottom of
    // the group it was supposed to lead.
    const thread = [
      inbound("2026-08-05T09:00:00Z", OOO),
      inbound("2026-07-31T08:00:00Z", REAL),
    ];
    const lastHuman = thread.find((m) => m.direction === "inbound" && isHumanReply(m))!;
    const latestReal = latestRealMessage(thread)!;
    expect(messageInstant(latestReal)).toBe("2026-08-05T09:00:00Z");
    expect(messageInstant(lastHuman)).toBe("2026-07-31T08:00:00Z");
    // Five days apart — the whole difference between top and bottom of the list.
    expect(messageInstant(lastHuman) < messageInstant(latestReal)).toBe(true);
  });

  it("the page sorts on waitingSince, not latestReal", () => {
    expect(INBOX).toContain("const waitingSince = lastHumanInbound ?? latestReal;");
    expect(INBOX).toContain("messageInstant(a.waitingSince) < messageInstant(b.waitingSince)");
  });
});

describe("nothing is hidden, and the row explains itself", () => {
  it("the conversation is still listed — only the badge changed", () => {
    // The filter is unchanged: every prospect with any inbound still appears.
    expect(INBOX).toContain('c.thread.some((m) => m.direction === "inbound")');
    // No new filter was slipped into the list.
    expect(INBOX).not.toContain("filter((c) => c.awaitingUs)");
  });

  it("an auto-reply or opt-out gets a label instead of a wrong one", () => {
    expect(INBOX).toContain('c.auto.kind === "opt_out"');
    expect(INBOX).toContain('"Opted out"');
    expect(INBOX).toContain('"Auto-reply"');
  });

  it("an out-of-office shows the date they said they're back", () => {
    // The classifier already parses it; the inbox just never showed it.
    expect(INBOX).toContain("Away · back ${c.auto.returnsOn}");
    // With the subject a real auto-responder carries. The date parser reads
    // both halves, and the inbox passes both — so this is the message shape
    // that actually arrives, not a body in isolation.
    const parsed = classifyInbound("Out of office", OOO);
    expect(parsed.kind).toBe("auto_reply");
    expect(parsed.returnsOn).toBe("2026-08-12");
    // The page hands the classifier the subject as well as the body.
    expect(INBOX).toContain(
      'classifyInbound(String(latestReal.subject ?? ""), String(latestReal.body ?? ""))'
    );
    // …and degrades to a plain "Auto-reply" when no date was given.
    expect(classifyInbound("Out of office", "Out of the office, back soon.").returnsOn).toBeNull();
  });

  it("the composer replies to the person, not to their auto-responder", () => {
    expect(INBOX).toContain(
      'selectedThread.find((m) => m.direction === "inbound" && isHumanReply(m)) ??'
    );
    // …and still opens on SOMETHING when the thread holds only an auto-reply,
    // so the channel selector is never left guessing.
    expect(INBOX).toContain('selectedThread.find((m) => m.direction === "inbound")');
  });
});
