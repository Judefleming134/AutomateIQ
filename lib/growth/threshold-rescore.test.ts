import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { qualificationFromScore } from "./scoring";

/**
 * Changing the qualification thresholds re-scored the first ~210 prospects and
 * silently gave up on the rest — while telling you it had saved.
 *
 * Saving settings re-derives every prospect's verdict, "so the pipeline never
 * shows stale verdicts" (its own comment). It grouped the changed rows by their
 * new status and issued one update per status, chunking the ids at 500:
 *
 *     for (let i = 0; i < ids.length; i += 500) {
 *       await admin.from("ge_prospects")
 *         .update({ qualification_status: status })
 *         .in("id", ids.slice(i, i + 500));     // ← ids go in the URL
 *     }
 *
 * `.in("id", [...])` serialises every id INTO THE REQUEST URL at ~39 bytes per
 * percent-encoded UUID. Measured (scratchpad/threshold-rescore.mjs):
 *
 *   ids per chunk   URL bytes   vs 8192
 *   150             5,915       72%      ← what selectAllRowsByIds uses
 *   200             7,865       96%
 *   210             8,255       101%     FAILS
 *   500            19,565       239%     FAILS
 *
 * CLAUDE.md names this one by name: ".in(col, ids) serialises every id into the
 * request URL (~40 chars per UUID), so ~200 ids blows the ~8KB limit."
 *
 * And the result was never read — no `const { error } =`, no check — so the
 * action returned { ok: true } regardless:
 *
 *   prospects changing verdict   OLD re-scored   NEW re-scored
 *   120                          120             120
 *   400                          0               400
 *   1,200                        200             1,200
 *   5,000                        0               5,000
 *
 * The 1,200 row is the nastier shape: it splits 500/500/200, the two full
 * chunks die and the trailing one lands — so 200 prospects got the new verdict
 * and 1,000 kept the old one, decided entirely by `changed % 500`.
 *
 * The thresholds themselves saved fine. So the settings page said yes, and the
 * pipeline carried on showing every prospect's OLD verdict against the NEW
 * rules — the exact staleness the re-derive exists to prevent, on the screen
 * that decides which leads the engine treats as qualified.
 *
 * Under ~210 it worked perfectly, which is why it survived: a small database
 * gives no hint that a bigger one silently doesn't.
 *
 * Now chunked at 150 (the same number lib/growth/db.ts uses, so there is one
 * answer in the codebase to "how many ids fit in a URL"), with failures
 * collected and named. The settings upsert already succeeded by then and is
 * deliberately NOT rolled back — the honest report is "saved, but N are stale,
 * save again to retry".
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "settings", "actions.ts"),
  "utf8"
);
const DB = readFileSync(path.join(ROOT, "lib", "growth", "db.ts"), "utf8");

const URL_LIMIT = 8192;
/** The URL supabase-js builds for `.in("id", ids)` against ge_prospects. */
const urlFor = (n: number) =>
  "https://abcdefghijklmnopqr.supabase.co/rest/v1/ge_prospects?id=in.(" +
  encodeURIComponent(Array.from({ length: n }, () => randomUUID()).join(",")) +
  ")";

describe("the URL the old chunk size actually built", () => {
  it.each([
    [150, true],
    [200, true],
    [210, false],
    [500, false],
  ])("%i ids fits under 8KB: %s", (n, fits) => {
    expect(urlFor(n).length <= URL_LIMIT).toBe(fits);
  });

  it("500 ids is more than double the ceiling", () => {
    const len = urlFor(500).length;
    expect(len).toBeGreaterThan(19_000);
    expect(len / URL_LIMIT).toBeGreaterThan(2);
  });

  it("150 leaves real headroom, which is why db.ts picked it", () => {
    expect(urlFor(150).length / URL_LIMIT).toBeLessThan(0.8);
    expect(DB).toContain("chunkSize = 150");
  });
});

describe("what that cost, per database size", () => {
  /** Rows the OLD loop actually managed to update. */
  const oldRescored = (changed: number) => {
    let done = 0;
    for (let i = 0; i < changed; i += 500) {
      const chunk = Math.min(500, changed - i);
      if (urlFor(chunk).length <= URL_LIMIT) done += chunk;
    }
    return done;
  };
  /** And the new one. */
  const newRescored = (changed: number) => {
    let done = 0;
    for (let i = 0; i < changed; i += 150) {
      const chunk = Math.min(150, changed - i);
      expect(urlFor(chunk).length).toBeLessThanOrEqual(URL_LIMIT);
      done += chunk;
    }
    return done;
  };

  it.each([
    // changed, OLD re-scored — every full 500-chunk dies; only a TRAILING
    // chunk that happens to land under ~210 gets through.
    [120, 120],
    [400, 0],
    [1200, 200],
    [5000, 0],
  ])("%i prospects change verdict → OLD applied %i", (changed, old) => {
    expect(oldRescored(changed)).toBe(old);
    expect(newRescored(changed)).toBe(changed);
  });

  it("the partial case is the nastier one", () => {
    // 1,200 splits 500 / 500 / 200. The first two chunks fail and the last
    // lands — so 200 prospects get the new verdict and 1,000 keep the old one,
    // with no rule you could infer from the pipeline about which is which.
    expect(oldRescored(1200)).toBe(200);
    expect(oldRescored(1200)).toBeLessThan(1200);
    // And it depends purely on `changed % 500`, which is nobody's mental model.
    expect(oldRescored(1000)).toBe(0);
    expect(oldRescored(1100)).toBe(100);
  });

  it("the boundary is ~210", () => {
    expect(oldRescored(200)).toBe(200);
    expect(oldRescored(400)).toBe(0);
    expect(oldRescored(499)).toBe(0);
  });
});

describe("the numbers being re-derived are real", () => {
  it("raising the qualify threshold really does move hundreds of verdicts", () => {
    // A plausible spread of lead scores over 2,000 prospects — well inside the
    // ~5k soft import cap the settings action's own comment mentions.
    const scores = Array.from({ length: 2000 }, (_, i) => (i * 37) % 101);
    const before = scores.map((s) =>
      qualificationFromScore(s, { qualifyThreshold: 70, reviewThreshold: 40 })
    );
    const after = scores.map((s) =>
      qualificationFromScore(s, { qualifyThreshold: 80, reviewThreshold: 50 })
    );
    const changed = before.filter((v, i) => v !== after[i]).length;
    expect(changed).toBeGreaterThan(210); // past the point the old loop died
  });
});

describe("the fix", () => {
  it("chunks at 150, and says where the number came from", () => {
    expect(ACTIONS).toContain("const ID_CHUNK = 150;");
    expect(ACTIONS).toContain("i += ID_CHUNK");
    expect(ACTIONS).not.toContain("i += 500");
    expect(ACTIONS).toContain("lib/growth/db.ts");
  });

  it("reads the update's error instead of discarding it", () => {
    expect(ACTIONS).toContain("const { error: updateError } = await admin");
    expect(ACTIONS).toContain("if (updateError) failures.push(updateError.message);");
  });

  it("and reports what did NOT happen", () => {
    expect(ACTIONS).toContain("could not be re-scored");
    expect(ACTIONS).toContain("Their status is stale — save again to retry.");
    expect(ACTIONS).toContain("if (failures.length > 0)");
  });

  it("the pending count is the rows that didn't land, not a guess", () => {
    expect(ACTIONS).toContain(
      "const pending = [...toUpdate.values()].reduce((n, ids) => n + ids.length, 0) - rescored;"
    );
    expect(ACTIONS).toContain("else rescored += chunk.length;");
  });

  it("the settings themselves are still saved — not rolled back", () => {
    // The upsert succeeded before any of this; undoing it would be worse than
    // a stale verdict, and the message says which half happened.
    expect(ACTIONS).toContain("Settings saved, but");
    const tail = ACTIONS.slice(ACTIONS.indexOf("const ID_CHUNK = 150;"));
    expect(tail).not.toContain(".upsert(");
  });
});

describe("nothing else about saving settings moved", () => {
  it("owner-only, and the threshold validation is untouched", () => {
    expect(ACTIONS).toContain('if (member.role !== "owner") return { error: "Only owners can change settings." };');
    expect(ACTIONS).toContain("reviewThreshold >= qualifyThreshold");
    expect(ACTIONS).toContain("Booking URL must start with http(s)://");
  });

  it("manual disqualifications still stick", () => {
    expect(ACTIONS).toContain('.neq("qualification_status", "disqualified")');
  });

  it("the read side still pages past the 1,000-row cap", () => {
    expect(ACTIONS).toContain("selectAllRows<{");
  });

  it("both surfaces are still revalidated", () => {
    expect(ACTIONS).toContain('revalidatePath("/growth/settings")');
    expect(ACTIONS).toContain('revalidatePath("/growth/prospects")');
  });
});
