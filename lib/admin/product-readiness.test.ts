import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  PRODUCT_PROBES,
  summariseReadiness,
  readinessRank,
  probeProduct,
  checkProductReadiness,
  type ProductReadiness,
} from "@/lib/admin/product-readiness";
import { PRODUCT_REGISTRY } from "@/lib/products/registry";

/**
 * "Can I sell this today?"
 *
 * Every product's tables live in a manual_update_*.sql file that has to be
 * pasted into the SQL Editor by hand, and nothing in the app knew whether that
 * had been done. So the honest answer was: sell it, and find out when the
 * customer logs in and the software fails in front of them — the single most
 * expensive moment in the funnel to be broken.
 *
 * #508 fixed what the customer is TOLD when it happens. This is about knowing
 * before it happens.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const result = (over: Partial<ProductReadiness> = {}): ProductReadiness => ({
  key: "k",
  name: "N",
  table: "t",
  migration: "m.sql",
  state: "ready",
  detail: null,
  ...over,
});

/** Minimal fake of the one Supabase call the probe makes. */
const clientReturning = (error: unknown) =>
  ({
    from: () => ({ select: async () => ({ error }) }),
  }) as never;

const throwingClient = () =>
  ({
    from: () => ({
      select: async () => {
        throw new Error("connection refused");
      },
    }),
  }) as never;

describe("reading one product's state", () => {
  it("is ready when the table answers", async () => {
    const r = await probeProduct(clientReturning(null), PRODUCT_PROBES[0]);
    expect(r.state).toBe("ready");
    expect(r.detail).toBeNull();
  });

  it("is missing on the code PostgREST actually returns", async () => {
    const r = await probeProduct(
      clientReturning({
        code: "PGRST205",
        message: "Could not find the table 'public.stl_settings' in the schema cache",
      }),
      PRODUCT_PROBES[0]
    );
    expect(r.state).toBe("missing");
  });

  it("is missing on the direct-Postgres code too", async () => {
    const r = await probeProduct(clientReturning({ code: "42P01" }), PRODUCT_PROBES[0]);
    expect(r.state).toBe("missing");
  });

  it("does not call an unrelated failure 'missing'", async () => {
    // Reporting a permissions problem as "run this migration" would send Jude
    // to paste SQL that is already there.
    const r = await probeProduct(
      clientReturning({ code: "42501", message: "permission denied" }),
      PRODUCT_PROBES[0]
    );
    expect(r.state).toBe("error");
    expect(r.detail).toBe("permission denied");
  });

  it("never throws — one bad probe must not take the page down", async () => {
    const r = await probeProduct(throwingClient(), PRODUCT_PROBES[0]);
    expect(r.state).toBe("error");
    expect(r.detail).toContain("connection refused");
  });
});

describe("the verdict", () => {
  it("says everything is sellable only when every probe is ready", () => {
    const all = [result(), result(), result()];
    expect(summariseReadiness(all).allReady).toBe(true);
    expect(summariseReadiness(all).ready).toBe(3);
  });

  it("an ERRORED probe is not ready", () => {
    // The trap: counting only `missing` would report "everything is sellable"
    // while a product was failing for a reason nobody could name.
    const mixed = [result(), result({ state: "error", detail: "boom" })];
    const r = summariseReadiness(mixed);
    expect(r.allReady).toBe(false);
    expect(r.errored).toBe(1);
    expect(r.ready).toBe(1);
  });

  it("a missing table is not ready", () => {
    const r = summariseReadiness([result(), result({ state: "missing" })]);
    expect(r.allReady).toBe(false);
    expect(r.missing).toBe(1);
  });

  it("does not claim all-ready on an empty list", () => {
    // Zero probes means the check did not run, not that everything passed.
    expect(summariseReadiness([]).allReady).toBe(false);
  });

  it("counts add up to the number probed", () => {
    const rs = [
      result(),
      result({ state: "missing" }),
      result({ state: "error" }),
      result(),
    ];
    const r = summariseReadiness(rs);
    expect(r.ready + r.missing + r.errored).toBe(rs.length);
  });
});

describe("what Jude reads first", () => {
  it("puts broken above unknown above fine", () => {
    expect(readinessRank("missing")).toBeLessThan(readinessRank("error"));
    expect(readinessRank("error")).toBeLessThan(readinessRank("ready"));
  });

  it("orders a real report that way", async () => {
    const admin = {
      from: (table: string) => ({
        select: async () =>
          table === "stl_settings"
            ? { error: { code: "PGRST205", message: "schema cache" } }
            : { error: null },
      }),
    } as never;
    const report = await checkProductReadiness(admin);
    expect(report.results[0].state).toBe("missing");
    expect(report.results[0].table).toBe("stl_settings");
    expect(report.allReady).toBe(false);
    expect(report.missing).toBe(1);
  });

  it("reports everything ready when the database is fully set up", async () => {
    const report = await checkProductReadiness(clientReturning(null));
    expect(report.allReady).toBe(true);
    expect(report.ready).toBe(PRODUCT_PROBES.length);
  });
});

describe("the probe list is honest about the platform", () => {
  it("covers every product in the registry that has its own storage", () => {
    // CustomIQ is a framework with no table of its own — bespoke modules bring
    // their own — so it is legitimately absent. Anything else missing here is
    // a product nobody is checking.
    const NO_STORAGE = new Set(["custom-solutions"]);
    const probed = new Set(PRODUCT_PROBES.map((p) => p.key));
    const unchecked = PRODUCT_REGISTRY.filter(
      (p) => !NO_STORAGE.has(p.key) && !probed.has(p.key)
    ).map((p) => p.key);
    expect(unchecked).toEqual([]);
  });

  it("names a distinct table for each product", () => {
    const tables = PRODUCT_PROBES.map((p) => p.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it("names a migration file that exists on disk", () => {
    // A readiness page that sends Jude to a file that isn't there is worse
    // than no page: it turns a two-minute fix into a hunt.
    const missing = PRODUCT_PROBES.filter((p) => {
      if (!p.migration.endsWith(".sql")) return false; // "base schema" prose
      return !existsSync(path.join(ROOT, p.migration));
    }).map((p) => `${p.name} → ${p.migration}`);
    expect(missing).toEqual([]);
  });

  it("probes a table the product's code actually reads", () => {
    // Guards against a rename drifting the probe off the real table, which
    // would report "ready" for a product that is broken.
    const SOURCES = [
      ["speed-to-lead-agent", "app/portal/speed-to-lead-agent/actions.ts"],
      ["crm-agent", "app/portal/crm-agent/actions.ts"],
      ["permitiq", "app/portal/permitiq/page.tsx"],
    ] as const;
    for (const [key, file] of SOURCES) {
      const probe = PRODUCT_PROBES.find((p) => p.key === key)!;
      const src = readFileSync(path.join(ROOT, file), "utf8");
      expect(src, `${key} should read ${probe.table}`).toContain(`"${probe.table}"`);
    }
  });
});

describe("the page is wired up and cannot serve a stale answer", () => {
  const PAGE = readFileSync(
    path.join(ROOT, "app", "admin", "readiness", "page.tsx"),
    "utf8"
  );

  it("is admin-only", () => {
    expect(PAGE).toContain("requireAdmin()");
  });

  it("never caches — a stale 'all ready' is worse than no page", () => {
    expect(PAGE).toContain('export const dynamic = "force-dynamic"');
  });

  it("uses the admin client, so RLS cannot make a real table look empty", () => {
    expect(PAGE).toContain("createAdminClient()");
  });

  it("is reachable from the admin home", () => {
    const HOME = readFileSync(path.join(ROOT, "app", "admin", "page.tsx"), "utf8");
    expect(HOME).toContain('href="/admin/readiness"');
  });

  it("shows the migration filename — this is Jude's screen, not a customer's", () => {
    expect(PAGE).toContain("{r.migration}");
  });
});
