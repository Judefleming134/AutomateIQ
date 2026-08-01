import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Jarvis nightly, job 1b — repairing dead social links.
 *
 * The bug: the candidate query was an UNORDERED `.limit(200)`, and "damaged"
 * is a JS-side check (`cleanSocialUrl` returns null) that PostgREST cannot
 * express — so the filter necessarily ran AFTER the cap. Two consequences,
 * both silent:
 *
 *   - a prospect outside that arbitrary 200 was never examined, so once the
 *     visible slice was clean the job reported "0 fixed" every night while
 *     dead links sat in the rest of the table indefinitely;
 *   - the note said "N more queued for tomorrow's run", counted from the
 *     visible slice, so the backlog Jude was told about was not the one that
 *     existed.
 *
 * Same shape as the call-list and DM-list bugs named in CLAUDE.md: a cap
 * applied BEFORE the "still to work" filter can only reorder what it happens
 * to contain.
 */

const RAW = readFileSync(
  path.resolve(import.meta.dirname, "jarvis-nightly.ts"),
  "utf8"
);
/** Comments stripped: the file explains at length what it must NOT do, and a
 *  naive text search matches the explanation rather than the code. */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the repair job looks at every candidate", () => {
  it("pages the whole set instead of capping it", () => {
    expect(SRC).toContain("selectAllRows");
  });

  it("no longer takes an arbitrary 200-row window", () => {
    const job = SRC.slice(SRC.indexOf("let socialsFixed"), SRC.indexOf("let rewritten"));
    expect(job).not.toMatch(/\.limit\(200\)/);
  });

  it("orders the scan, so paging is deterministic", () => {
    const job = SRC.slice(SRC.indexOf("let socialsFixed"), SRC.indexOf("let rewritten"));
    expect(job).toMatch(/\.order\("id", \{ ascending: true \}\)/);
  });

  it("still repairs at most six a night, to stay inside the time budget", () => {
    const job = SRC.slice(SRC.indexOf("let socialsFixed"), SRC.indexOf("let rewritten"));
    expect(job).toContain("damaged.slice(0, 6)");
  });

  it("still excludes closed and do-not-contact prospects", () => {
    const job = SRC.slice(SRC.indexOf("let socialsFixed"), SRC.indexOf("let rewritten"));
    expect(job).toContain("ACTIVE_FILTER");
  });
});

describe("the backlog it reports is the backlog that exists", () => {
  // Replay: 8 prospects hold dead links, spread across 900 rows, 6 repaired
  // a night. The capped version sees an arbitrary but stable 200 (no ORDER BY
  // means physical order, so the same rows come back every night).
  const TOTAL = 900;
  const DAMAGED = [5, 40, 199, 260, 410, 733, 880, 899];
  const PER_NIGHT = 6;

  function run(capped: boolean) {
    const fixed = new Set<number>();
    const nights: { fixed: number; reported: number; actual: number }[] = [];
    for (let n = 0; n < 5; n++) {
      const window = capped ? 200 : TOTAL;
      const found = DAMAGED.filter((i) => i < window && !fixed.has(i));
      found.slice(0, PER_NIGHT).forEach((i) => fixed.add(i));
      nights.push({
        fixed: Math.min(PER_NIGHT, found.length),
        reported: Math.max(0, found.length - PER_NIGHT),
        actual: DAMAGED.filter((i) => !fixed.has(i)).length,
      });
    }
    return nights;
  }

  it("used to leave most of them unrepaired forever", () => {
    const old = run(true);
    expect(old[4].actual).toBe(5);
    // And every night after the first it did nothing, silently.
    expect(old.slice(1).every((n) => n.fixed === 0)).toBe(true);
  });

  it("used to tell Jude nothing was left while five were", () => {
    const old = run(true);
    expect(old[0].reported).toBe(0);
    expect(old[0].actual).toBe(5);
  });

  it("now clears them all, and the count it reports is true", () => {
    const now = run(false);
    expect(now[0].reported).toBe(now[0].actual);
    expect(now[1].actual).toBe(0);
    expect(now[4].actual).toBe(0);
  });
});

describe("job 1 can no longer starve on the same dead domains (K8)", () => {
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const JOB1 = CODE.slice(0, CODE.indexOf("Job 1b"));

  it("orders by when each prospect was last ATTEMPTED, not by score alone", () => {
    // Score-only ordering re-read the same eight sites every night. If those
    // eight have dead domains the job harvests nothing, reports 0 forever, and
    // never reaches the ninth — no error, no progress, no signal.
    expect(JOB1).toMatch(
      /\.order\("last_harvest_attempt_at", \{ ascending: true, nullsFirst: true \}\)/
    );
  });

  it("keeps score as the tie-break among equally-stale prospects", () => {
    expect(JOB1).toMatch(/\.order\("lead_score", \{ ascending: false/);
  });

  it("stamps the attempt BEFORE fetching, not after a success", () => {
    // Stamping only successes would leave the dead domains permanently
    // unstamped and permanently first — the bug itself.
    const stamp = JOB1.indexOf("last_harvest_attempt_at: new Date()");
    // The CALL inside the loop, not the import at the top of the file —
    // comparing against the import compared against line 1 and always failed.
    const fetchAt = JOB1.indexOf("fetchWebsiteText(p.website");
    expect(stamp).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(fetchAt);
  });

  it("falls back to the old ordering when the column isn't there yet", () => {
    // A migration Jude hasn't run must never take a working nightly job down.
    expect(JOB1).toContain("if (orderError)");
    expect(JOB1).toContain("canStampAttempt = false");
  });

  it("says so in the brief when the migration is still outstanding", () => {
    expect(JOB1).toContain("run migration 0036");
  });

  it("does not stamp when the column is missing", () => {
    expect(JOB1).toMatch(/if \(canStampAttempt\) \{/);
  });
});

describe("migration 0036", () => {
  const SQL = readFileSync(
    path.resolve(import.meta.dirname, "..", "..", "supabase", "migrations", "0036_harvest_attempt.sql"),
    "utf8"
  );

  it("is idempotent", () => {
    expect(SQL).toContain("add column if not exists");
    expect(SQL).toContain("create index if not exists");
  });

  it("adds a nullable column, so every existing prospect is untouched", () => {
    expect(SQL).not.toMatch(/last_harvest_attempt_at timestamptz not null/i);
  });

  it("indexes exactly what the harvest orders by", () => {
    expect(SQL).toMatch(/\(last_harvest_attempt_at nulls first, lead_score desc\)/);
  });

  it("is partial on the rows the harvest actually considers", () => {
    expect(SQL).toMatch(/where email is null and website is not null/);
  });

  it("explains in the schema what null means", () => {
    expect(SQL).toMatch(/comment on column ge_prospects\.last_harvest_attempt_at/i);
    expect(SQL).toMatch(/[Nn]ever attempted/);
  });
});
