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
