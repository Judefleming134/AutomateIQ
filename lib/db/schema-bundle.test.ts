import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * `supabase/bundles/full_schema.sql` is the one file Jude pastes to bring the
 * database up to date, whatever state it is in. A stale bundle is worse than
 * no bundle: it would silently skip the newest migration while looking like it
 * covered everything.
 *
 * So: every migration must be in it, it must stay idempotent, and it must stay
 * wrapped in a transaction. Regenerate with
 *
 *     node scripts/build-schema-bundle.mjs
 *
 * Validated on scratch Postgres 16 (2026-08-02) three ways: a fresh database
 * builds the whole schema; the identical paste run twice changes nothing; and
 * a database already migrated to 0034 with 2,000 prospects / 500 messages /
 * 300 bookings / 400 quotes in it gains only what was missing and loses no
 * row. Both routes finish with a byte-identical column signature.
 *
 * THAT VALIDATION PASSED AND THE BUNDLE STILL FAILED IN PRODUCTION (2026-08-05).
 * Worth writing down, because the gap was in the FIXTURE, not the method: the
 * 2,000 seeded prospects all carried statuses that were legal back at migration
 * 0014. Jude's real ones do not — they sit at 'follow_up_sent' and
 * 'research_failed', legal only since 0018 and 0022 — and `add constraint` is
 * validated against existing rows the moment it runs. See the section at the
 * bottom of this file. A populated-database test is only as good as the values
 * in it.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const BUNDLE = readFileSync(path.join(ROOT, "supabase", "bundles", "full_schema.sql"), "utf8");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

describe("the bundle covers every migration", () => {
  it("names all of them, in order", () => {
    const named = files.filter((f) => BUNDLE.includes(`-- ${f}`));
    expect(named, `missing from the bundle: ${files.filter((f) => !named.includes(f)).join(", ")}`)
      .toEqual(files);
  });

  it("keeps them in filename order — 0037 must land before 0038 and 0041", () => {
    const positions = files.map((f) => BUNDLE.indexOf(`-- ${f}`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("has a header that tells the reader what it is and what it won't do", () => {
    expect(BUNDLE).toContain("YOU DO NOT NEED TO KNOW WHICH MIGRATIONS YOU HAVE ALREADY RUN");
    expect(BUNDLE).toContain("never drops a table");
  });
});

describe("it stays safe to run twice", () => {
  /** Statement starts, with comments stripped so a comment can't match. */
  const code = BUNDLE.split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("creates no table without IF NOT EXISTS", () => {
    const bad = [...code.matchAll(/create\s+table\s+(?!if\s+not\s+exists)(\S+)/gi)].map((m) => m[1]);
    expect(bad).toEqual([]);
  });

  it("creates no index without IF NOT EXISTS", () => {
    const bad = [...code.matchAll(/create\s+(?:unique\s+)?index\s+(?!if\s+not\s+exists)(\S+)/gi)].map(
      (m) => m[1]
    );
    expect(bad).toEqual([]);
  });

  it("creates no function without OR REPLACE", () => {
    const bad = [...code.matchAll(/create\s+function\s+(\S+)/gi)].map((m) => m[1]);
    expect(bad).toEqual([]);
  });

  it("drops each policy before creating it", () => {
    const created = (code.match(/create\s+policy/gi) ?? []).length;
    const dropped = (code.match(/drop\s+policy\s+if\s+exists/gi) ?? []).length;
    expect(created).toBeGreaterThan(0);
    expect(dropped).toBe(created);
  });

  it("drops each trigger before creating it", () => {
    const created = (code.match(/create\s+(?:constraint\s+)?trigger/gi) ?? []).length;
    const dropped = (code.match(/drop\s+trigger\s+if\s+exists/gi) ?? []).length;
    expect(created).toBeGreaterThan(0);
    expect(dropped).toBe(created);
  });

  it("adds no column without IF NOT EXISTS", () => {
    const bad = [...code.matchAll(/add\s+column\s+(?!if\s+not\s+exists)(\S+)/gi)].map((m) => m[1]);
    expect(bad).toEqual([]);
  });
});

describe("a failure cannot leave the database half-done", () => {
  it("is wrapped in one transaction", () => {
    expect(BUNDLE.trimStart().split("\n").find((l) => l.trim() && !l.startsWith("--"))?.trim())
      .toBe("begin;");
    expect(BUNDLE.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("has exactly one begin and one commit, and no rollback", () => {
    expect((BUNDLE.match(/^begin;$/gm) ?? []).length).toBe(1);
    expect((BUNDLE.match(/^commit;$/gm) ?? []).length).toBe(1);
    expect(BUNDLE).not.toMatch(/^rollback;$/m);
  });
});

describe("it never destroys anything", () => {
  const code = BUNDLE.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("drops no table, column, schema or database", () => {
    // Policies, triggers and constraints ARE dropped — they are definitions
    // being replaced, and each is immediately recreated. Data never is.
    for (const verb of [
      /drop\s+table/i,
      /drop\s+column/i,
      /drop\s+schema/i,
      /drop\s+database/i,
      /truncate/i,
      /^\s*delete\s+from/im,
    ]) {
      expect(code, String(verb)).not.toMatch(verb);
    }
  });
});

describe("the generator is checked in beside it", () => {
  it("exists, so the bundle can be rebuilt rather than hand-patched", () => {
    const gen = readFileSync(path.join(ROOT, "scripts", "build-schema-bundle.mjs"), "utf8");
    expect(gen).toContain("full_schema.sql");
    // The migrations themselves must never be rewritten — they are the record.
    expect(gen).toContain("The migrations themselves are NOT rewritten");
  });

  it("states the K10 limitation rather than implying a full rebuild", () => {
    // Four production tables are created by no migration. A bundle that
    // claimed to rebuild from nothing would be lying about those.
    expect(BUNDLE).toContain("strategy_bookings, ca_content, crm_contacts and qa_quotes");
    expect(BUNDLE).toContain("not yet");
  });
});

/**
 * THE ONE THAT GOT THROUGH: a constraint's HISTORY replayed against live rows.
 *
 * `alter table … add constraint` is validated against the rows already in the
 * table, immediately. ge_prospects_status_check is defined three times:
 *
 *   0014_growth_engine_v2          11 statuses
 *   0018_growth_pipeline_statuses  17  (adds outreach_ready, follow_up_sent, …)
 *   0022_research_failed_status    19  (adds research_failed)
 *
 * On an empty database, replaying all three is harmless — there is nothing to
 * validate, which is why every check above passed. On Jude's database it died
 * on 0014's narrower version:
 *
 *   ERROR: 23514: check constraint "ge_prospects_status_check" of relation
 *   "ge_prospects" is violated by some row
 *
 * and, being one transaction, took the whole paste with it. 0043, 0044 and
 * 0045 were all blocked behind a rule the data had legitimately outgrown four
 * migrations earlier.
 *
 * The header of this bundle promises "run it, and the database ends up correct
 * either way" — a converged state, not a re-enactment. The generator now keeps
 * only the LAST definition of any constraint and comments out the ones it
 * supersedes.
 *
 * Re-validated on scratch Postgres 16 (2026-08-05), with a fixture that
 * actually carries post-0018 statuses this time:
 *   • the populated database that failed now completes, all five rows intact,
 *     and ends with the 19-status constraint
 *   • from empty, the fixed bundle produces a schema IDENTICAL to the old one
 *     (pg_dump --schema-only, 1,256 lines, same sha)
 *   • the old bundle still fails on that same database, at line 835
 */
describe("no constraint is defined twice in the runnable bundle", () => {
  const LIVE = BUNDLE.split("\n").filter((l) => !l.trim().startsWith("--"));

  /** Every `add constraint` that would really execute, as table.constraint. */
  const liveAdds = (): string[] => {
    const re = /^alter\s+table\s+(?:only\s+)?([A-Za-z_][\w$]*)\s+add\s+constraint\s+([A-Za-z_][\w$]*)/i;
    return LIVE.flatMap((l) => {
      const m = re.exec(l.trim());
      return m ? [`${m[1].toLowerCase()}.${m[2].toLowerCase()}`] : [];
    });
  };

  it("every constraint appears exactly once", () => {
    // A second definition of the same constraint can only be an OLDER one —
    // and an older one is by definition narrower, or the later migration would
    // never have been written.
    const seen = new Map<string, number>();
    for (const c of liveAdds()) seen.set(c, (seen.get(c) ?? 0) + 1);
    const repeated = [...seen].filter(([, n]) => n > 1).map(([c, n]) => `${c} ×${n}`);
    expect(repeated).toEqual([]);
  });

  it("ge_prospects_status_check — the one that actually broke", () => {
    expect(liveAdds().filter((c) => c === "ge_prospects.ge_prospects_status_check")).toHaveLength(1);
  });

  it("the surviving definition is the WIDEST, not merely the last", () => {
    // Keeping the wrong one would fail identically, so this checks the
    // statuses rather than the position in the file.
    const i = BUNDLE.lastIndexOf("add constraint ge_prospects_status_check");
    const stmt = BUNDLE.slice(i, BUNDLE.indexOf(";", i));
    for (const status of [
      "new", "researching", "research_failed", "research_complete",
      "outreach_ready", "contacted", "follow_up_sent", "replied", "qualified",
      "meeting_booked", "proposal_in_progress", "proposal_sent", "negotiation",
      "won", "lost", "future_opportunity", "do_not_contact", "archived",
    ]) {
      expect(stmt, status).toContain(`'${status}'`);
    }
  });

  it("every status the APP can write is legal under it", () => {
    // The other half of the guarantee, and the thing that would have caught
    // this from the app side: a status the code sets but the constraint
    // rejects is a write that fails at runtime.
    const constants = readFileSync(path.join(ROOT, "lib", "growth", "constants.ts"), "utf8");
    const i = BUNDLE.lastIndexOf("add constraint ge_prospects_status_check");
    const stmt = BUNDLE.slice(i, BUNDLE.indexOf(";", i));
    // Scoped to PROSPECT_STATUS_META's own object literal. A file-wide regex
    // also swept up CHANNEL_META's keys (linkedin, instagram…), which are not
    // statuses at all — a test that fails for the wrong reason gets muted.
    const block = constants.slice(
      constants.indexOf("export const PROSPECT_STATUS_META"),
      constants.indexOf("export const", constants.indexOf("export const PROSPECT_STATUS_META") + 1)
    );
    const appStatuses = [...block.matchAll(/^\s{2}(\w+):\s*\{\s*label:/gm)].map((m) => m[1]);
    expect(appStatuses.length).toBeGreaterThan(10);
    expect(appStatuses.filter((s) => !stmt.includes(`'${s}'`))).toEqual([]);
  });

  it("the superseded definitions are commented out, not deleted", () => {
    // The bundle is generated FROM the migrations and reads as the history it
    // came from. Silently dropping the old definitions would make it a
    // different document; commenting them says what happened and why.
    expect(BUNDLE).toContain("-- [bundle] superseded by 0022_research_failed_status.sql");
    expect(BUNDLE).toContain("-- [bundle] paired with the superseded add below");
    // Their paired drops go with them, so exactly one drop still runs.
    expect(
      LIVE.filter((l) => /drop\s+constraint\s+if\s+exists\s+ge_prospects_status_check/i.test(l))
    ).toHaveLength(1);
  });

  it("the migrations themselves are untouched — they are the record", () => {
    for (const f of [
      "0014_growth_engine_v2.sql",
      "0018_growth_pipeline_statuses.sql",
      "0022_research_failed_status.sql",
    ]) {
      const src = readFileSync(path.join(MIGRATIONS, f), "utf8");
      expect(src, f).toContain("add constraint ge_prospects_status_check");
      expect(src, f).not.toContain("[bundle]");
    }
  });
});

describe("the generator's collapse rule is narrow enough to be safe", () => {
  const GEN = readFileSync(path.join(ROOT, "scripts", "build-schema-bundle.mjs"), "utf8");

  it("only removes an add that a LATER add of the same name replaces", () => {
    expect(GEN).toContain("if (idxs.length < 2) continue;");
    expect(GEN).toContain("idxs.slice(0, -1)");
    // A constraint defined once is never touched, so this cannot silently drop
    // a rule the database still needs.
  });

  it("keys on table AND constraint name, not the name alone", () => {
    // Two tables can carry the same constraint name; collapsing across them
    // would delete a real rule.
    expect(GEN).toContain("`${m[1].toLowerCase()}.${m[2].toLowerCase()}`");
  });

  it("runs across files, which is the only place the bug lives", () => {
    // Per file it is invisible: each migration adds its constraint exactly once.
    expect(GEN).toContain("supersedeConstraints(all)");
    expect(GEN).toContain("has to see ACROSS files");
  });

  it("reports what it did, so a silent collapse is impossible", () => {
    expect(GEN).toContain("superseded constraint definitions commented out");
  });

  it("the header explains why the pass is not optional", () => {
    expect(GEN).toContain("ERROR: 23514");
    expect(GEN).toContain("CONVERGED STATE");
  });
});
