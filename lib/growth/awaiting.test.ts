import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isAwaiting, latestSentByProspect, INBOUND_SCAN } from "@/lib/growth/awaiting";

/**
 * Jarvis told Jude to answer replies he had already answered — and missed the
 * one that had been sitting longest.
 *
 * The "What matters right now" panel built its reply priority from
 * `week.replies`: every inbound message of the last 7 days, answered or not.
 * The dashboard next door and the inbox the link lands on both use a different
 * and correct rule — a conversation is waiting on us when their latest reply
 * came AFTER our latest genuine send.
 *
 * So the old count was wrong in BOTH directions:
 *
 *   too high — a reply answered on Monday counted all week, so on a morning
 *              when everything was answered the panel still said "5 replies
 *              this week — every one gets an answer today" and the click
 *              landed on an inbox with nothing due;
 *   too low  — a reply from 9 days ago that was NEVER answered fell outside
 *              the window entirely. The one most at risk of going cold was the
 *              one the panel could not see.
 *
 * A count that doesn't match what its click-through shows — a named recurring
 * class in CLAUDE.md, and the rule now lives in one place so the three
 * surfaces cannot drift again.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const JARVIS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "jarvis", "page.tsx"),
  "utf8"
);
const DASH = readFileSync(path.join(ROOT, "app", "growth", "(app)", "page.tsx"), "utf8");

const DAY = 86_400_000;
const now = Date.parse("2026-08-02T09:00:00Z");
const ago = (d: number) => new Date(now - d * DAY).toISOString();

describe("the rule itself", () => {
  it("is waiting when they replied and we never sent anything", () => {
    expect(isAwaiting(ago(2), null)).toBe(true);
    expect(isAwaiting(ago(2), undefined)).toBe(true);
  });

  it("is waiting when their reply came after our last send", () => {
    expect(isAwaiting(ago(1), ago(3))).toBe(true);
  });

  it("is NOT waiting once we've answered", () => {
    expect(isAwaiting(ago(5), ago(5))).toBe(false);
    expect(isAwaiting(ago(4), ago(3))).toBe(false);
  });

  it("has no time window — a 9-day-old unanswered reply still counts", () => {
    // The half of the bug that LOST work rather than inventing it. `week.replies`
    // looked back 7 days, so the reply nobody had touched for longer than that
    // was invisible on the panel meant to catch exactly that.
    expect(isAwaiting(ago(9), null)).toBe(true);
    expect(isAwaiting(ago(60), null)).toBe(true);
  });

  it("treats an identical timestamp as answered, not waiting", () => {
    // Ties go to "answered": re-listing a conversation Jude just replied to
    // is the false-positive that made the old panel ignorable.
    const t = ago(1);
    expect(isAwaiting(t, t)).toBe(false);
  });
});

describe("the newest genuine send wins", () => {
  it("prefers sent_at over created_at", () => {
    // A draft is written hours before the 07:00 cron sends it. Comparing a
    // reply against created_at can make our answer look older than the
    // question it answers. Same rule as lib/growth/inbox-order.ts.
    const map = latestSentByProspect([
      { prospect_id: "a", sent_at: ago(1), created_at: ago(4) },
    ]);
    expect(map.get("a")).toBe(ago(1));
  });

  it("falls back to created_at when a send has no sent_at", () => {
    const map = latestSentByProspect([{ prospect_id: "a", sent_at: null, created_at: ago(2) }]);
    expect(map.get("a")).toBe(ago(2));
  });

  it("keeps the LATEST send when there are several", () => {
    const map = latestSentByProspect([
      { prospect_id: "a", sent_at: ago(9), created_at: ago(9) },
      { prospect_id: "a", sent_at: ago(2), created_at: ago(3) },
      { prospect_id: "a", sent_at: ago(6), created_at: ago(6) },
    ]);
    expect(map.get("a")).toBe(ago(2));
  });

  it("keeps prospects apart", () => {
    const map = latestSentByProspect([
      { prospect_id: "a", sent_at: ago(1), created_at: ago(1) },
      { prospect_id: "b", sent_at: ago(8), created_at: ago(8) },
    ]);
    expect(map.get("a")).toBe(ago(1));
    expect(map.get("b")).toBe(ago(8));
  });
});

describe("a realistic week", () => {
  const threads = [
    { who: "Byrne Roofing", replied: ago(6), answered: ago(6) },
    { who: "Kelly Tiling", replied: ago(5), answered: ago(5) },
    { who: "Nolan Electrical", replied: ago(4), answered: ago(3) },
    { who: "Doyle Plastering", replied: ago(2), answered: null },
    { who: "Walsh Plumbing", replied: ago(1), answered: ago(3) },
    { who: "Moore Joinery", replied: ago(9), answered: null },
  ];
  /** The old count: inbound in the last 7 days, answered or not. */
  const weekReplies = threads.filter((t) => Date.parse(t.replied) >= now - 7 * DAY).length;
  const waiting = threads.filter((t) => isAwaiting(t.replied, t.answered));

  it("counts only what is genuinely outstanding", () => {
    expect(waiting.map((t) => t.who)).toEqual([
      "Doyle Plastering",
      "Walsh Plumbing",
      "Moore Joinery",
    ]);
  });

  it("stops chasing the two that were already answered", () => {
    expect(weekReplies).toBe(5);
    expect(waiting.length).toBe(3);
  });

  it("catches the 9-day-old one the window used to hide", () => {
    const missedBefore = threads.filter(
      (t) => Date.parse(t.replied) < now - 7 * DAY && isAwaiting(t.replied, t.answered)
    );
    expect(missedBefore.map((t) => t.who)).toEqual(["Moore Joinery"]);
  });

  it("disappears entirely once everything is answered", () => {
    // The all-clear case matters most: a false to-do every morning trains you
    // to ignore the panel, and then it fails when it's telling the truth.
    const allAnswered = threads.map((t) => ({ ...t, answered: ago(0) }));
    expect(allAnswered.filter((t) => isAwaiting(t.replied, t.answered)).length).toBe(0);
    // Where the old count still insisted there was work.
    expect(weekReplies).toBeGreaterThan(0);
  });
});

describe("Jarvis is wired to it", () => {
  it("uses the shared count, not week.replies", () => {
    expect(JARVIS).toContain('import { countAwaitingReplies } from "@/lib/growth/awaiting"');
    expect(JARVIS).toContain("countAwaitingReplies(admin)");
  });

  it("no longer builds the priority from replies RECEIVED", () => {
    // The bug, in one expression.
    expect(JARVIS).not.toContain("if (week.replies > 0)");
    expect(JARVIS).not.toContain("this week — every one gets an answer today");
  });

  it("the label says waiting, not received", () => {
    expect(JARVIS).toContain("waiting on you — answer these first");
  });

  it("still links to the inbox, which groups Reply-due first", () => {
    const from = JARVIS.indexOf("waiting on you — answer these first");
    expect(JARVIS.slice(from, from + 200)).toContain('href: "/growth/inbox"');
  });

  it("keeps the other two priorities exactly as they were", () => {
    expect(JARVIS).toContain("chase these first, they already know you");
    expect(JARVIS).toContain("with drafts ready and no first touch yet");
  });

  it("still uses week for the genuinely windowed stat card", () => {
    // "Sent (7 days)" IS a 7-day number and must not have been swept up in
    // this change.
    expect(JARVIS).toContain('label="Sent (7 days)" value={String(week.outreachSent)}');
  });
});

describe("the dashboard shares the rule rather than repeating it", () => {
  it("calls isAwaiting instead of inlining the comparison", () => {
    expect(DASH).toContain('import { isAwaiting } from "@/lib/growth/awaiting"');
    expect(DASH).toContain("isAwaiting(inbound.created_at, latestSent.get(id))");
  });

  it("no longer carries its own copy of the condition", () => {
    // Two inline copies of one rule is how Jarvis drifted from it.
    expect(DASH).not.toContain("(!sent || inbound.created_at > sent)");
  });

  it("still renders the per-prospect list, longest-waiting first", () => {
    // The shared helper returns a NUMBER; the dashboard's richer panel is
    // untouched and must stay that way.
    expect(DASH).toContain("replies are");
    expect(DASH).toContain("a.inbound.created_at < b.inbound.created_at ? -1 : 1");
  });

  it("still chunks its id lists", () => {
    expect(DASH).toContain("selectAllRowsByIds");
  });
});

describe("the shared loader is safe at scale", () => {
  it("chunks the id list, like every other caller", () => {
    const SRC = readFileSync(path.join(ROOT, "lib", "growth", "awaiting.ts"), "utf8");
    expect(SRC).toContain("selectAllRowsByIds");
    // Not chunking would fail the request, report zero sends, and mark EVERY
    // conversation as awaiting — inflating the number this exists to fix.
    expect(SRC).toContain("mark every");
  });

  it("bounds the inbound scan", () => {
    expect(INBOUND_SCAN).toBe(400);
  });

  it("returns 0 rather than querying when there are no replies at all", () => {
    const SRC = readFileSync(path.join(ROOT, "lib", "growth", "awaiting.ts"), "utf8");
    expect(SRC).toContain("if (ids.length === 0) return 0");
  });
});
