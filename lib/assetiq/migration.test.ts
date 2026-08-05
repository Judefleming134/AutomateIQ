import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PRODUCT_REGISTRY } from "@/lib/products/registry";
import { getMarketingProduct } from "@/lib/products/marketing";
import { PRODUCT_PROBES } from "@/lib/admin/product-readiness";

/**
 * AssetIQ's schema, and the six places a new product has to be wired into
 * before it is actually shippable.
 *
 * The migration itself was validated on scratch Postgres 16 rather than
 * asserted here — run from nothing and re-run, RLS proved to isolate two
 * tenants and to refuse a cross-tenant insert, and a suspended tenant proved
 * to see nothing. What a unit test CAN hold is that the file stays additive
 * and that the six wirings stay in agreement, because a product wired into
 * five of them is a tile that 404s or a page that shows an empty list forever.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SQL = readFileSync(
  path.join(ROOT, "supabase", "migrations", "0045_assetiq.sql"),
  "utf8"
);
/** SQL with `--` comment lines removed — assertions are about statements. */
const STATEMENTS = SQL.split("\n")
  .filter((l) => !/^\s*--/.test(l))
  .join("\n");

describe("the migration is safe to run and safe to re-run", () => {
  it("creates the table only if it is not there", () => {
    expect(STATEMENTS).toContain("create table if not exists ast_assets");
  });

  it("alters, drops or deletes nothing that already exists", () => {
    // The only `drop` allowed is the drop-then-create of its OWN policy, which
    // is how every other migration here makes a policy idempotent.
    const drops = [...STATEMENTS.matchAll(/^\s*drop\s+(\w+)/gim)].map((m) => m[1].toLowerCase());
    expect(drops).toEqual(["policy"]);
    expect(STATEMENTS).not.toMatch(/^\s*alter\s+table\s+(?!ast_assets)/im);
    expect(STATEMENTS).not.toMatch(/\bdelete\s+from\b/i);
    expect(STATEMENTS).not.toMatch(/\btruncate\b/i);
  });

  it("adds the product row without overwriting an existing one", () => {
    expect(STATEMENTS).toContain("insert into products");
    expect(STATEMENTS).toContain("'assetiq'");
    expect(STATEMENTS).toContain("on conflict (key) do nothing");
  });

  it("scopes every row to a business, and cascades when one is deleted", () => {
    expect(STATEMENTS).toMatch(
      /business_id uuid not null references businesses \(id\) on delete cascade/
    );
  });

  it("turns RLS on and gives it a policy — one without the other is a locked table", () => {
    expect(STATEMENTS).toContain("alter table ast_assets enable row level security");
    expect(STATEMENTS).toContain("is_active_tenant_member (business_id)");
    // Both halves: `using` guards reads, `with check` guards writes. A policy
    // with only `using` lets a member INSERT a row against another business.
    const policy = STATEMENTS.slice(STATEMENTS.indexOf("create policy"));
    expect(policy).toContain("using (is_active_tenant_member (business_id))");
    expect(policy).toContain("with check (is_active_tenant_member (business_id))");
  });

  it("stores money as integer cents, not free text", () => {
    // qa_quotes.total is free text and cannot be summed. A "what are we sitting
    // on" figure that silently drops every asset someone typed "approx 2k" into
    // is worse than no figure.
    expect(STATEMENTS).toContain("purchase_cost_cents integer");
    expect(STATEMENTS).toMatch(/purchase_cost_cents is null or purchase_cost_cents >= 0/);
  });

  it("indexes the due list, and only the rows that can appear on it", () => {
    expect(STATEMENTS).toContain("ast_assets_due_idx");
    expect(STATEMENTS).toContain("where next_due_date is not null");
  });

  it("lets the due date be absent — nothing due is a normal state", () => {
    const table = STATEMENTS.slice(
      STATEMENTS.indexOf("create table if not exists ast_assets"),
      STATEMENTS.indexOf(");")
    );
    expect(table).toMatch(/next_due_date date,/);
    expect(table).not.toMatch(/next_due_date date not null/);
  });
});

describe("the constraints and the form agree", () => {
  const ACTIONS = readFileSync(
    path.join(ROOT, "app", "portal", "assetiq", "actions.ts"),
    "utf8"
  );
  const values = (col: string) => {
    const m = new RegExp(`check \\(${col} in \\(([^)]+)\\)\\)`).exec(STATEMENTS);
    return m![1].split(",").map((v) => v.trim().replace(/'/g, ""));
  };

  it("every category the form offers is one the database accepts", () => {
    const db = values("category");
    const form = /const CATEGORIES = \[([^\]]+)\]/.exec(ACTIONS)![1]
      .split(",")
      .map((v) => v.trim().replace(/"/g, ""))
      .filter(Boolean);
    // Exactly equal, both ways: a category the DB accepts but the form hides is
    // dead, and one the form offers but the DB rejects is a save that fails
    // after the user has filled the whole thing in.
    expect(new Set(form)).toEqual(new Set(db));
  });

  it("every status the form offers is one the database accepts", () => {
    const db = values("status");
    const form = /const STATUSES = \[([^\]]+)\]/.exec(ACTIONS)![1]
      .split(",")
      .map((v) => v.trim().replace(/"/g, ""))
      .filter(Boolean);
    expect(new Set(form)).toEqual(new Set(db));
  });
});

describe("the six wirings a shippable product needs", () => {
  it("1. a portal registry entry pointing at a route that exists", () => {
    const entry = PRODUCT_REGISTRY.find((p) => p.key === "assetiq");
    expect(entry).toBeDefined();
    expect(entry!.href).toBe("/portal/assetiq");
    expect(
      readFileSync(path.join(ROOT, "app", "portal", "assetiq", "page.tsx"), "utf8")
    ).toContain("AssetIQ");
  });

  it("2. an icon that is actually in the icon map", () => {
    const icons = readFileSync(path.join(ROOT, "lib", "products", "icons.tsx"), "utf8");
    const entry = PRODUCT_REGISTRY.find((p) => p.key === "assetiq")!;
    // Silently falling back to the generic Box is how PlanIQ shipped with the
    // wrong tile icon for weeks.
    expect(icons).toContain(`${entry.iconName}: `);
  });

  it("3. the products row, created by the migration and not by hand", () => {
    expect(STATEMENTS).toContain("insert into products (key, name, description, icon_name, status)");
  });

  it("4. a public product page", () => {
    const marketing = getMarketingProduct("assetiq");
    expect(marketing?.name).toBe("AssetIQ");
    expect(marketing?.leadSource).toBe("product-assetiq");
  });

  it("5. its own vanity URL", () => {
    const config = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    expect(config).toContain('{ source: "/assetiq", destination: "/products/assetiq"');
    const routing = readFileSync(path.join(ROOT, "lib", "routing", "case.ts"), "utf8");
    expect(routing).toContain('"assetiq"');
  });

  it("6. a readiness probe, so the admin knows if the table is missing", () => {
    const probe = PRODUCT_PROBES.find((p) => p.key === "assetiq");
    expect(probe).toBeDefined();
    expect(probe!.table).toBe("ast_assets");
    expect(probe!.migration).toBe("supabase/migrations/0045_assetiq.sql");
    // …and it names the table the migration actually creates.
    expect(STATEMENTS).toContain(`create table if not exists ${probe!.table}`);
  });

  it("and it is in the bundle that actually gets pasted into Supabase", () => {
    const bundle = readFileSync(
      path.join(ROOT, "supabase", "bundles", "full_schema.sql"),
      "utf8"
    );
    expect(bundle).toContain("ast_assets");
    expect(bundle).toContain("'assetiq'");
  });
});
