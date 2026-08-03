import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isAwaiting,
  isHumanReply,
  latestSentByProspect,
  INBOUND_SCAN,
} from "@/lib/growth/awaiting";

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
    // The SYMBOL, not the exact import line — pinning the line meant adding a
    // second import from the same module broke a test about behaviour.
    expect(DASH).toMatch(/import \{[^}]*\bisAwaiting\b[^}]*\} from "@\/lib\/growth\/awaiting"/);
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

describe("a robot is not a person waiting on an answer", () => {
  /**
   * The morning brief has ALWAYS filtered auto-replies and opt-outs out of its
   * "STILL WAITING ON YOU" section, using classifyInbound — the same
   * classifier the inbound webhook uses to decide whether a message is even
   * allowed to move a prospect.
   *
   * The dashboard panel and Jarvis's priority did not. So the same question
   * got two different answers depending on which screen you looked at, and the
   * two that were wrong are the two Jude works from during the day.
   *
   * The opt-out is the bad one: "answer these first" pointed at someone who
   * had just asked not to be contacted.
   */
  const human = { subject: "Re: quick question", body: "Yes go on, what would it cost?" };
  const ooo = {
    subject: "Automatic reply: Out of Office",
    body: "I am currently out of the office until 12 August with limited access to email.",
  };
  const optOut = {
    subject: "Re: your email",
    body: "Please remove me from your mailing list. Unsubscribe.",
  };

  it("counts a real reply", () => {
    expect(isHumanReply(human)).toBe(true);
  });

  it("does not count an out-of-office", () => {
    expect(isHumanReply(ooo)).toBe(false);
  });

  it("does not count an opt-out", () => {
    expect(isHumanReply(optOut)).toBe(false);
  });

  it("treats a missing subject or body as a real reply, not a robot", () => {
    // A DM or a hand-logged reply has no subject. Failing OPEN here is right:
    // wrongly hiding a real person is far worse than one extra line.
    expect(isHumanReply({ body: "sounds good, call me" })).toBe(true);
    expect(isHumanReply({})).toBe(true);
  });

  it("is the same classifier the webhook gates the pipeline with", () => {
    // If a message was not allowed to advance a prospect, it must not be able
    // to turn round and demand a reply.
    const SRC = readFileSync(path.join(ROOT, "lib", "growth", "awaiting.ts"), "utf8");
    expect(SRC).toContain('classifyInbound(String(m.subject ?? ""), String(m.body ?? "")).kind === "human"');
  });

  it("the shared loader applies it, and fetches what it needs to", () => {
    const SRC = readFileSync(path.join(ROOT, "lib", "growth", "awaiting.ts"), "utf8");
    expect(SRC).toContain("if (!isHumanReply(m)) continue");
    // Filtering on a column you never selected silently passes everything.
    expect(SRC).toContain('.select("prospect_id, created_at, subject, body")');
  });

  it("skips BEFORE picking the newest, not after", () => {
    // Otherwise a prospect whose most recent message happens to be an
    // out-of-office drops off entirely, instead of surfacing on their last
    // real one — losing a genuine reply to fix a cosmetic one.
    const SRC = readFileSync(path.join(ROOT, "lib", "growth", "awaiting.ts"), "utf8");
    const loop = SRC.slice(SRC.indexOf("for (const m of inboundRows"));
    expect(loop.indexOf("isHumanReply")).toBeLessThan(loop.indexOf("latestInbound.set"));
  });

  it("the dashboard applies it too, and selects subject", () => {
    expect(DASH).toContain("if (!isHumanReply(m)) continue");
    expect(DASH).toContain('.select("prospect_id, body, subject, channel, created_at")');
  });

  it("the morning brief still does what it always did", () => {
    // This fix brings two surfaces UP to the brief. It must not have changed
    // the one that was already right.
    const BRIEF = readFileSync(
      path.join(ROOT, "lib", "cron", "jarvis-morning-brief.ts"),
      "utf8"
    );
    expect(BRIEF).toContain('classifyInbound(String(m.subject ?? ""), String(m.body ?? "")).kind !== "human"');
  });
});

describe("the query is bounded, and the bound changes no answer", () => {
  /**
   * FERRARI. The loader fetched EVERY sent message to all ~400 replied
   * prospects, purely to work out the newest one for each — so its cost grew
   * with how long Jude had been emailing people rather than with the thing
   * being measured.
   *
   * It doesn't need them. A send older than the OLDEST latest-reply in the set
   * is older than every prospect's latest reply, so it cannot make anyone
   * "answered": the test is `latestInbound > latestSent`, and a send below that
   * floor loses the comparison for every id at once.
   *
   * That is a correctness claim, not a hunch, so it is checked as a PROPERTY
   * over randomised histories rather than on a couple of hand-picked rows —
   * a wrong bound here silently breaks the panel built to stop replies being
   * missed. 400 randomised worlds, zero differing answers.
   */
  type Send = { prospect_id: string; sent_at: string | null; created_at: string };

  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (n: number) => Math.floor(rnd() * n);
  const day = (d: number) => new Date(Date.parse("2026-08-03T09:00:00Z") - d * DAY).toISOString();

  function world(nProspects: number, historyDays: number) {
    const latestInbound = new Map<string, string>();
    const sends: Send[] = [];
    for (let i = 0; i < nProspects; i++) {
      const id = `p${i}`;
      latestInbound.set(id, day(pick(60)));
      for (let k = 0, n = 1 + pick(8); k < n; k++) {
        const d = pick(historyDays);
        // A few legacy rows carry no sent_at; the rest were created BEFORE
        // they were sent, which is what makes a created_at-only bound wrong.
        const legacy = rnd() < 0.08;
        sends.push({
          prospect_id: id,
          sent_at: legacy ? null : day(d),
          created_at: day(d + (legacy ? 0 : pick(9))),
        });
      }
    }
    return { latestInbound, sends };
  }

  const countWith = (latestInbound: Map<string, string>, rows: Send[]) => {
    const latestSent = latestSentByProspect(rows);
    let n = 0;
    for (const [id, inb] of latestInbound) if (isAwaiting(inb, latestSent.get(id))) n += 1;
    return n;
  };

  /** Exactly what the `.or(...)` filter selects, in memory. */
  const applyFloor = (latestInbound: Map<string, string>, rows: Send[]) => {
    const floor = [...latestInbound.values()].reduce((a, b) => (a < b ? a : b));
    return rows.filter((m) => (m.sent_at != null ? m.sent_at >= floor : m.created_at >= floor));
  };

  it("gives an identical answer across 400 randomised histories", () => {
    seed = 12345;
    const differing: string[] = [];
    for (let i = 0; i < 400; i++) {
      const { latestInbound, sends } = world(20 + pick(60), 30 + pick(700));
      const full = countWith(latestInbound, sends);
      const bounded = countWith(latestInbound, applyFloor(latestInbound, sends));
      if (full !== bounded) differing.push(`world ${i}: ${full} vs ${bounded}`);
    }
    expect(differing).toEqual([]);
  });

  it("actually drops rows — it is not a no-op dressed as an optimisation", () => {
    seed = 999;
    const { latestInbound, sends } = world(400, 730);
    const kept = applyFloor(latestInbound, sends);
    expect(kept.length).toBeLessThan(sends.length / 2);
  });

  it("saves MORE the longer the send history — the cost stops compounding", () => {
    const share = (days: number) => {
      seed = 999;
      const { latestInbound, sends } = world(400, days);
      return applyFloor(latestInbound, sends).length / sends.length;
    };
    // Bounded by the reply window, not by how long Jude has been sending.
    expect(share(730)).toBeLessThan(share(365));
    expect(share(365)).toBeLessThan(share(180));
  });

  it("bounds on the INSTANT, never on created_at alone", () => {
    // A draft written last week and sent this morning is the common case here
    // — the 07:00 cron sends what the nightly run drafted. A created_at bound
    // would drop it and wrongly report the prospect as still waiting.
    const SRC = readFileSync(path.join(ROOT, "lib", "growth", "awaiting.ts"), "utf8");
    expect(SRC).toContain("sent_at.gte.${floor}");
    expect(SRC).toContain("and(sent_at.is.null,created_at.gte.${floor})");
    expect(SRC).toContain("const floor =");
    // …and the QUERY actually applies it. Break-verifying caught this: with
    // only the assertions above, deleting the `.or(...)` line left the
    // constant and both template strings sitting there unused and every test
    // still passed. Declaring a bound is not the same as using one.
    expect(SRC).toContain(".or(instantAtOrAfterFloor)");
    const query = SRC.slice(SRC.indexOf("selectAllRowsByIds<Msg>"));
    expect(query.slice(0, query.indexOf(");"))).toContain(".or(instantAtOrAfterFloor)");
  });

  it("a prospect with no qualifying send still reads as awaiting", () => {
    // The floor removes their only sends; that is correct, because those
    // sends predate their reply.
    const latestInbound = new Map([["a", day(1)]]);
    const sends: Send[] = [{ prospect_id: "a", sent_at: day(40), created_at: day(41) }];
    expect(applyFloor(latestInbound, sends)).toEqual([]);
    expect(countWith(latestInbound, applyFloor(latestInbound, sends))).toBe(1);
    expect(countWith(latestInbound, sends)).toBe(1);
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
