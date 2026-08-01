import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  isMissingTableError,
  productSetupMessage,
  reportMissingTable,
} from "@/lib/db/errors";

/**
 * What a paying customer is told when a product's table isn't there yet.
 *
 * TWO DEFECTS, STACKED, ACROSS THIRTEEN CALL SITES IN NINE FILES.
 *
 * 1. Every product action tested `error.code === "42P01"` directly instead of
 *    the shared check in lib/db/errors. Supabase's REST API does NOT return
 *    42P01 for a missing table — PostgREST answers PGRST205, "Could not find
 *    the table 'public.stl_settings' in the schema cache". So the check did
 *    not fire in the ordinary case, execution fell through to
 *    `return { error: error.message }`, and that raw string went on screen.
 *
 * 2. When it DID fire it said: "Database update required — run
 *    supabase/manual_update_0007.sql." An instruction to someone who has just
 *    paid for LeadIQ, naming an internal file they cannot open, on a machine
 *    they do not have.
 *
 * On the billing page, the same text greeted a customer trying to confirm an
 * order. Both versions say the same thing to somebody deciding whether to keep
 * paying, and one of them describes our deployment process to a stranger.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

afterEach(() => vi.restoreAllMocks());

describe("recognising the error Supabase actually returns", () => {
  it("catches PGRST205 — the REST API's answer, and the case that was missed", () => {
    expect(
      isMissingTableError({
        code: "PGRST205",
        message: "Could not find the table 'public.stl_settings' in the schema cache",
      })
    ).toBe(true);
  });

  it("still catches 42P01, the direct-Postgres code", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
  });

  it("catches it from the message alone, when no code comes through", () => {
    expect(
      isMissingTableError({ message: 'relation "stl_settings" does not exist' })
    ).toBe(true);
    expect(
      isMissingTableError({ message: "Could not find the table in the schema cache" })
    ).toBe(true);
  });

  it("does not swallow unrelated failures", () => {
    // A permissions error or a constraint violation must keep its own message
    // — hiding those behind "still setting up" would make real bugs invisible.
    expect(isMissingTableError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isMissingTableError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(undefined)).toBe(false);
    expect(isMissingTableError("boom")).toBe(false);
  });
});

describe("what the customer reads", () => {
  it("names the product so they know what is affected", () => {
    expect(productSetupMessage("LeadIQ")).toContain("LeadIQ");
  });

  it("says it is not their fault and not theirs to fix", () => {
    const m = productSetupMessage("LeadIQ");
    expect(m).toMatch(/nothing you did/i);
    expect(m).toMatch(/nothing you need to fix/i);
  });

  it("reassures them the rest of the account still works", () => {
    expect(productSetupMessage("LeadIQ")).toMatch(/everything else/i);
  });

  it("leaks no SQL, no filename, no table name, no error code", () => {
    const m = productSetupMessage("LeadIQ");
    expect(m).not.toMatch(/\.sql\b/i);
    expect(m).not.toMatch(/manual_update|migration|supabase|postgrest/i);
    expect(m).not.toMatch(/42P01|PGRST/i);
    expect(m).not.toMatch(/schema cache|relation|table/i);
  });

  it("does not claim it is already fixed", () => {
    // Promising a fix that hasn't happened is the reporting-success-for-work-
    // that-didn't-happen shape, aimed at a customer.
    expect(productSetupMessage("LeadIQ")).not.toMatch(/\bfixed\b|\bresolved\b|\bsorted now\b/i);
  });
});

describe("the detail is kept, just not shown", () => {
  it("returns the customer sentence", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(reportMissingTable("LeadIQ", "supabase/manual_update_0007.sql", {})).toBe(
      productSetupMessage("LeadIQ")
    );
  });

  it("logs the migration Jude actually has to run", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportMissingTable("LeadIQ", "supabase/manual_update_0007.sql", {
      message: "Could not find the table 'public.stl_settings' in the schema cache",
    });
    const logged = String(spy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("supabase/manual_update_0007.sql");
    expect(logged).toContain("LeadIQ");
    expect(logged).toContain("stl_settings");
  });

  it("survives an error with no message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => reportMissingTable("LeadIQ", "x.sql", null)).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });
});

/**
 * The repo-wide guard. Fixing thirteen call sites is worth nothing if the
 * fourteenth reintroduces it, and this exact text had already spread across
 * nine files by copy-paste.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Files a CUSTOMER can reach. app/admin and the Growth Engine are Jude's own
 *  screens — naming the SQL file there is helpful, not a leak. */
const CUSTOMER_FACING = walk(path.join(ROOT, "app", "portal"))
  .concat(walk(path.join(ROOT, "lib", "content-agent")))
  .concat(walk(path.join(ROOT, "lib", "quote-agent")));

describe("no customer-facing surface tells a customer to run SQL", () => {
  it("names no .sql file in a string the customer could see", () => {
    const offenders: string[] = [];
    for (const file of CUSTOMER_FACING) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      // reportMissingTable() takes the filename as an argument and LOGS it —
      // the sanctioned path. The exemption has to span the WHOLE call, not one
      // line: a multi-line call puts the filename on a continuation line, and
      // a per-line skip flagged the very calls it was meant to allow.
      let depth = 0;
      for (const line of lines) {
        const inCall = depth > 0 || line.includes("reportMissingTable(");
        if (inCall) {
          const from = depth > 0 ? 0 : line.indexOf("reportMissingTable(");
          const tail = line.slice(from);
          depth += (tail.match(/\(/g) ?? []).length - (tail.match(/\)/g) ?? []).length;
          if (depth < 0) depth = 0;
          continue;
        }
        if (/["'`][^"'`]*\.sql\b/.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}: ${line.trim().slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses the shared check, never a bare 42P01 comparison", () => {
    // A direct code test misses PGRST205, which is what actually arrives.
    const offenders: string[] = [];
    for (const file of CUSTOMER_FACING) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (/code\s*===?\s*["']42P01["']/.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("still handles the missing table somewhere — the guard cannot be passed by deleting it", () => {
    const handled = CUSTOMER_FACING.filter((f) =>
      readFileSync(f, "utf8").includes("isMissingTableError")
    );
    expect(handled.length).toBeGreaterThanOrEqual(8);
  });
});

describe("the products that were broken are each wired up", () => {
  it.each([
    ["LeadIQ", "app/portal/speed-to-lead-agent/actions.ts"],
    ["SiteIQ", "app/portal/website-agent/actions.ts"],
    ["QuoteIQ", "app/portal/instant-quote-agent/actions.ts"],
    ["ClientIQ", "app/portal/crm-agent/actions.ts"],
    ["AssistIQ", "app/portal/ai-assistant/actions.ts"],
    ["ContentIQ", "lib/content-agent/campaign-core.ts"],
    ["PermitIQ", "app/portal/permitiq/actions.ts"],
  ])("%s reports through the shared helper", (product, file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    expect(src).toContain(`reportMissingTable("${product}"`);
    expect(src).toContain("isMissingTableError");
  });

  it("the billing page no longer offers SQL to a customer confirming an order", () => {
    const src = readFileSync(path.join(ROOT, "app", "portal", "billing", "actions.ts"), "utf8");
    expect(src).not.toContain("run supabase/manual_update_0025.sql");
    expect(src).toContain('reportMissingTable("Your order form"');
  });

  it("the PermitIQ list page uses the shared check too", () => {
    // It rendered a convincing, wrong empty state — "you have no applications"
    // — whenever the real PGRST205 error arrived.
    const src = readFileSync(path.join(ROOT, "app", "portal", "permitiq", "page.tsx"), "utf8");
    expect(src).toContain("isMissingTableError(error)");
  });
});
