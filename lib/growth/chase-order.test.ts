import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The dashboard's "Send due email follow-ups" button leaked the chases most at
 * risk of being lost.
 *
 * `autoQueueDueFollowups` — the 07:00 twin — was fixed to order MOST OVERDUE
 * FIRST, with this reasoning in its own comment:
 *
 *   "Ordering by score alone leaked leads: only PER_RUN_CAP chases are queued a
 *    night, so with a real backlog (Jude has had 90+ due at once) a low-scoring
 *    chase lost its slot to whatever higher-scoring chase came due that day —
 *    every night, until it crossed the 7-day line above and was parked as gone
 *    cold. It never got a single send."
 *
 * `sendDueEmailFollowupsNow` never got that fix. It fetched 40 by lead score and
 * sent the first 20 — and it is the button Jude taps precisely WHEN he has a
 * backlog, which is the only situation where the leak bites.
 *
 * A chase is time-boxed in a way a score is not. The one due six days ago has
 * one day of runway before the 7-day window parks it as gone cold; the one due
 * today has seven. Runway has to win, or the queue quietly reorders itself into
 * a leak.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(path.join(ROOT, "lib", "growth", "autopilot.ts"), "utf8");

const fn = (name: string) => {
  const i = SRC.indexOf(`export async function ${name}`);
  const j = SRC.indexOf("export async function", i + 10);
  return SRC.slice(i, j === -1 ? SRC.length : j);
};
const NOW = fn("sendDueEmailFollowupsNow");
const CRON = fn("autoQueueDueFollowups");

const TODAY = "2026-08-04";
const day = (n: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Chase = { id: string; score: number; dueOn: string };

/** A real backlog: 90 due, spread across the 7-day window, scores unrelated. */
function backlog(): Chase[] {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: 90 }, (_, i) => ({
    id: `p${i}`,
    score: Math.floor(rnd() * 100),
    dueOn: day(-Math.floor(rnd() * 7)),
  }));
}

const FETCH = 40;
const SEND = 20;
const daysOverdue = (c: Chase) =>
  Math.round((Date.parse(TODAY) - Date.parse(c.dueOn)) / 86_400_000);

const byScore = (rows: Chase[]) => [...rows].sort((a, b) => b.score - a.score);
const byOverdue = (rows: Chase[]) =>
  [...rows].sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : b.score - a.score));
/** Fetch a window, then send from the top of it. */
const sent = (ordered: Chase[]) => ordered.slice(0, FETCH).slice(0, SEND);

describe("the leak, replayed over a real backlog", () => {
  const rows = backlog();
  /** On their last day: one more click before the 7-day window parks them. */
  const lastChance = rows.filter((c) => daysOverdue(c) === 6);

  it("there are genuinely leads on their last day", () => {
    expect(lastChance.length).toBeGreaterThan(5);
  });

  it("by score, most of them go unsent and age out tomorrow", () => {
    const got = sent(byScore(rows)).filter((c) => daysOverdue(c) === 6);
    expect(got.length).toBeLessThan(lastChance.length / 2);
  });

  it("by overdue-ness, every one of them is sent", () => {
    const got = sent(byOverdue(rows)).filter((c) => daysOverdue(c) === 6);
    expect(got.length).toBe(lastChance.length);
  });

  it("the average chase sent is genuinely older", () => {
    const avg = (list: Chase[]) =>
      list.map(daysOverdue).reduce((a, b) => a + b, 0) / list.length;
    expect(avg(sent(byOverdue(rows)))).toBeGreaterThan(avg(sent(byScore(rows))));
  });

  it("score still breaks ties within the same day", () => {
    // Overdue-ness first does not mean score stops mattering.
    const sameDay: Chase[] = [
      { id: "low", score: 10, dueOn: day(-3) },
      { id: "high", score: 90, dueOn: day(-3) },
    ];
    expect(byOverdue(sameDay).map((c) => c.id)).toEqual(["high", "low"]);
  });

  it("a chase due today never outranks one overdue", () => {
    const mixed: Chase[] = [
      { id: "today-top-score", score: 99, dueOn: day(0) },
      { id: "overdue-low-score", score: 1, dueOn: day(-5) },
    ];
    expect(byOverdue(mixed)[0].id).toBe("overdue-low-score");
  });
});

describe("the two paths now order the same way", () => {
  it("the on-demand button orders by next_follow_up_at first", () => {
    expect(NOW).toContain('.order("next_follow_up_at", { ascending: true })');
  });

  it("then by score", () => {
    const i = NOW.indexOf('.order("next_follow_up_at"');
    const j = NOW.indexOf('.order("lead_score"');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it("which is exactly what the 07:00 twin already did", () => {
    expect(CRON).toContain('.order("next_follow_up_at", { ascending: true })');
    expect(CRON).toContain('.order("lead_score", { ascending: false, nullsFirst: false })');
  });

  it("score-only ordering is gone from the button", () => {
    const code = NOW.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(
      /\.not\("email", "is", null\)\s*\.order\("lead_score"/
    );
  });
});

describe("everything else about the button is unchanged", () => {
  it("same 7-day freshness window as the cron", () => {
    expect(NOW).toContain('.gte("next_follow_up_at", dublinDate(-7))');
    expect(CRON).toContain('.gte("next_follow_up_at", dublinDate(-7))');
  });

  it("same chase-eligible statuses", () => {
    expect(NOW).toContain('.in("status", ["contacted", "follow_up_sent"])');
  });

  it("still bounded per click", () => {
    expect(NOW).toContain("if (sent >= 20) break;");
    expect(NOW).toContain(".limit(40)");
  });

  it("still honours the hard touch cap", () => {
    expect(NOW).toContain("maxTouches");
    expect(NOW).toContain("GROWTH_MAX_FOLLOWUPS");
  });

  it("still counts both chase purposes", () => {
    expect(NOW).toContain('const CHASE_PURPOSES = ["follow_up", "second_follow_up"]');
  });

  it("still sends through the full gate, not around it", () => {
    // sendAutopilotEmail is what runs reviewOutreachEmail and the live
    // status re-check — this button must never bypass it.
    expect(NOW).toContain("await sendAutopilotEmail({");
  });

  it("still respects the disable flag", () => {
    expect(NOW).toContain("GROWTH_AUTOFOLLOWUP");
  });
});
