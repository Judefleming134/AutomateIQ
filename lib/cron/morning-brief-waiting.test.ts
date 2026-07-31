import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The morning brief's "STILL WAITING ON YOU" section.
 *
 * It exists for the most expensive miss in the engine: someone replied, raised
 * their hand, and got silence. It sorts LONGEST-WAITING FIRST, because those
 * are the ones about to go cold.
 *
 * The bug: it was built from an inbound query capped at the NEWEST 200 rows,
 * and the "unanswered and older than 24h" filter ran after that cap. So the
 * rows it dropped were the oldest — precisely the ones the section sorts to
 * the top. The section's input worked against its own purpose.
 *
 * Third instance of the class CLAUDE.md names first (call list, DM list,
 * Jarvis nightly job 1b), and the one with the worst blast radius: it is what
 * Jude reads at 07:00 to decide who to chase.
 */

const RAW = readFileSync(
  path.resolve(import.meta.dirname, "jarvis-morning-brief.ts"),
  "utf8"
);
/** Comments stripped — the file explains what it must not do, and a naive
 *  search matches the explanation rather than the code. */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the inbound scan is not capped", () => {
  it("pages every reply instead of taking the newest 200", () => {
    const q = SRC.slice(SRC.indexOf('.eq("direction", "inbound")'));
    expect(SRC).toContain("selectAllRows<");
    expect(q.slice(0, 200)).not.toMatch(/\.limit\(200\)/);
  });

  it("still orders newest-first, which the 'latest per prospect' map relies on", () => {
    // The map keeps the FIRST sighting of each prospect as their last reply.
    const i = SRC.indexOf("selectAllRows<");
    expect(SRC.slice(i, i + 900)).toMatch(/order\("created_at", \{ ascending: false \}\)/);
  });

  it("keeps the 24-hour overnight query separate and capped", () => {
    // That one is a genuine 24h window with its own display cap — untouched.
    expect(SRC).toMatch(/gte\("created_at", since24h\)[\s\S]{0,200}limit\(10\)/);
  });
});

describe("what the section shows, replayed over a year of replies", () => {
  const DAY = 86_400_000;
  const now = Date.now();

  /** ~2.5 replies a day for a year — the 50/day ramp at a 5% reply rate. */
  function corpus() {
    const rows: { pid: string; at: number }[] = [];
    for (let d = 365; d >= 0; d--) {
      const n = d % 3 === 0 ? 3 : 2;
      for (let k = 0; k < n; k++) rows.push({ pid: `p${d}-${k}`, at: now - d * DAY });
    }
    return rows.sort((a, b) => b.at - a.at); // newest first, as the query returns
  }

  const NEGLECTED = ["p300-0", "p250-1", "p200-0", "p120-1", "p60-0"];

  function waiting(capped: boolean) {
    const all = corpus();
    const answered = new Set(all.map((m) => m.pid).filter((p) => !NEGLECTED.includes(p)));
    const window = capped ? all.slice(0, 200) : all;
    const latest = new Map<string, { pid: string; at: number }>();
    for (const m of window) if (!latest.has(m.pid)) latest.set(m.pid, m);
    return [...latest.values()]
      .filter((m) => !answered.has(m.pid) && m.at < now - DAY)
      .sort((a, b) => a.at - b.at)
      .slice(0, 10)
      .map((m) => m.pid);
  }

  it("used to hide four of the five people waiting on a reply", () => {
    expect(waiting(true)).toEqual(["p60-0"]);
  });

  it("hid exactly the ones waiting longest, which it claims to show first", () => {
    const hidden = NEGLECTED.filter((p) => !waiting(true).includes(p));
    expect(hidden).toEqual(["p300-0", "p250-1", "p200-0", "p120-1"]);
  });

  it("now shows all five, longest-waiting first", () => {
    expect(waiting(false)).toEqual(NEGLECTED);
  });

  it("still caps the DISPLAY at ten, so the brief stays readable", () => {
    expect(SRC).toMatch(/\.slice\(0, 10\)/);
  });
});
