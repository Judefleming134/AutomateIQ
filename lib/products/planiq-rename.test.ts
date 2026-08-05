import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import nextConfig from "@/next.config";
import { KNOWN_SEGMENTS, canonicalPath } from "@/lib/routing/case";
import { MARKETING_PRODUCTS, getMarketingProduct, resolveLeadSource } from "./marketing";
import { PRODUCT_REGISTRY, PRODUCT_FAMILIES } from "./registry";

/**
 * PermitIQ → PlanIQ, and the US half of it.
 *
 * "Permit" is the American word and "planning permission" is the Irish one,
 * and the product does both — so the name leads with the part that is the same
 * either side of the Atlantic.
 *
 * A rename in this codebase has exactly two ways to go wrong, and they pull in
 * opposite directions:
 *
 *   1. RENAMING TOO MUCH. `key: "permitiq"` is an entitlement foreign key —
 *      business_products joins on it and guardProduct("permitiq") is called
 *      across the tree. Renaming it silently strips the product from every
 *      customer who has it. Same for the family key and the /portal/permitiq
 *      route folder.
 *   2. RENAMING TOO LITTLE. The PUBLIC url did move. /permitiq, /PermitIQ and
 *      /products/permitiq are on cards, in email signatures and in emails
 *      already sent, and every one of them has to keep landing.
 *
 * The US side is the other half. It has been fully wired since migration 0033
 * — jurisdiction constrained to ('ie','us'), a United States tab, a
 * building_permit application type, a checklist resolver that filters by
 * jurisdiction — and NOT ONE US REQUIREMENT ROW WAS EVER SEEDED. Creating a US
 * application produced an empty checklist, which the page had to admit to
 * ("US permits are set up but not yet stocked"). Migration 0044 stocks it.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

/**
 * Source with its COMMENTS REMOVED.
 *
 * Every assertion below about "this text must not appear" is really about what
 * ships to a customer, and a comment explaining why the old name is frozen — or
 * a migration header saying "no DELETE" — is neither shipped nor a regression.
 * Asserting over raw source instead makes the test fire on its own
 * documentation, which is how a correct assertion gets weakened to shut it up.
 *
 * Conservative on purpose: block comments, and lines whose first non-space is
 * `//` or `--` or `*`. A trailing `// …` after code is left alone rather than
 * risk eating the `//` in an https:// literal.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|--|\*)/.test(l))
    .join("\n");
}

type Redirect = { source: string; destination: string; permanent: boolean };
async function redirects(): Promise<Redirect[]> {
  const fn = (nextConfig as { redirects?: () => Promise<Redirect[]> }).redirects;
  if (!fn) throw new Error("next.config has no redirects()");
  return fn();
}
const dest = (rows: Redirect[], source: string) =>
  rows.find((r) => r.source === source)?.destination;

describe("the rename stopped exactly where it had to", () => {
  it("renamed the DISPLAY name", () => {
    expect(getMarketingProduct("planiq")?.name).toBe("PlanIQ");
    expect(PRODUCT_REGISTRY.find((p) => p.key === "permitiq")?.name).toBe("PlanIQ");
    expect(PRODUCT_FAMILIES.find((f) => f.key === "permitiq")?.label).toBe("PlanIQ");
  });

  it("did NOT rename the entitlement key", () => {
    // The one that revokes the product for a paying customer.
    expect(PRODUCT_REGISTRY.some((p) => p.key === "permitiq")).toBe(true);
    expect(PRODUCT_REGISTRY.some((p) => p.key === "planiq")).toBe(false);
    expect(PRODUCT_FAMILIES.some((f) => f.key === "permitiq")).toBe(true);
  });

  it("did NOT move the route folder the key guards", () => {
    expect(existsSync(path.join(ROOT, "app", "portal", "permitiq", "page.tsx"))).toBe(true);
    expect(PRODUCT_REGISTRY.find((p) => p.key === "permitiq")?.href).toBe("/portal/permitiq");
    // guardProduct is called with the key, not the brand.
    expect(read("app", "portal", "permitiq", "layout.tsx")).toContain('"permitiq"');
  });

  it("did NOT move the lead source, so the pipeline stays one product", () => {
    // Every lead this page has ever produced is stored as product-permitiq and
    // the leads list filters on that raw string. Two labels would split one
    // product's pipeline in half.
    const planiq = getMarketingProduct("planiq")!;
    expect(planiq.leadSource).toBe("product-permitiq");
    expect(resolveLeadSource("product-permitiq")).toEqual({
      source: "product-permitiq",
      productName: "PlanIQ",
    });
  });

  it("leaves no PermitIQ text on any customer-facing surface", () => {
    const surfaces = [
      ["public", "index.html"],
      ["lib", "products", "marketing.ts"],
      ["lib", "products", "registry.ts"],
      ["app", "portal", "permitiq", "page.tsx"],
      ["app", "portal", "permitiq", "actions.ts"],
      ["app", "portal", "permitiq", "[id]", "page.tsx"],
    ];
    // Comments stripped: marketing.ts and registry.ts both MENTION the old
    // name in the note explaining why the key is frozen, which is exactly the
    // documentation you want and is not shipped to anyone.
    const offenders = surfaces
      .filter((s) => /PermitIQ/.test(code(read(...s))))
      .map((s) => s.join("/"));
    expect(offenders).toEqual([]);
  });
});

describe("every old URL still lands", () => {
  it.each([
    ["/permitiq", "the name on the card"],
    ["/permitIQ", "the brand casing"],
    ["/products/permitiq", "the page linked from anywhere"],
  ])("%s (%s) reaches PlanIQ's page", async (source) => {
    const rows = await redirects();
    expect(dest(rows, source), `${source} goes nowhere`).toBe("/products/planiq");
  });

  it("the new name works in both casings too", async () => {
    const rows = await redirects();
    expect(dest(rows, "/planiq")).toBe("/products/planiq");
    expect(dest(rows, "/planIQ")).toBe("/products/planiq");
    expect(canonicalPath("/PlanIQ")).toBe("/planiq");
    expect(canonicalPath("/PLANIQ")).toBe("/planiq");
  });

  it("/portal/planiq reaches the app, which did not move", async () => {
    const rows = await redirects();
    expect(dest(rows, "/portal/planiq")).toBe("/portal/permitiq");
  });

  it("none of it loops", async () => {
    const rows = await redirects();
    const sources = new Set(rows.map((r) => r.source));
    for (const r of rows) {
      expect(sources.has(r.destination), `${r.destination} is a source AND a destination`).toBe(false);
    }
  });
});

describe("the case-forgiving list is complete", () => {
  it("knows every product slug", () => {
    // THE GAP #585 LEFT. That change gave every product a vanity URL and one
    // explicit brand-cased redirect each, believing there was no middleware.
    // proxy.ts is real and calls canonicalPath() on any capitalised first
    // segment — the eight new names were simply missing from KNOWN_SEGMENTS,
    // so /quoteIQ worked (the redirect table) while /QuoteIQ and /QUOTEIQ did
    // not (this list). Derived, so a twelfth product cannot repeat it.
    const missing = MARKETING_PRODUCTS.map((p) => p.slug).filter(
      (s) => !KNOWN_SEGMENTS.has(s)
    );
    expect(missing).toEqual([]);
  });

  it("still knows the retired name, which is on cards and in sent emails", () => {
    expect(KNOWN_SEGMENTS.has("permitiq")).toBe(true);
    expect(canonicalPath("/PermitIQ")).toBe("/permitiq");
  });

  it("corrects any casing, not just the one the redirect table lists", () => {
    for (const [input, expected] of [
      ["/QuoteIQ", "/quoteiq"],
      ["/QUOTEIQ", "/quoteiq"],
      ["/Quoteiq", "/quoteiq"],
      ["/SiteIQ", "/siteiq"],
      ["/ReputationIQ", "/reputationiq"],
    ] as const) {
      expect(canonicalPath(input), input).toBe(expected);
    }
  });

  it("still refuses to invent a route for a stranger", () => {
    expect(canonicalPath("/Nonsense")).toBeNull();
    expect(canonicalPath("/TradeIQ/doc/AbC123")).toBe("/tradeiq/doc/AbC123");
  });
});

describe("the US side is stocked, and says only what is true", () => {
  const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
  const file = readdirSync(MIGRATIONS).find((f) => /^0044_/.test(f))!;
  const SQL = code(readFileSync(path.join(MIGRATIONS, file), "utf8"));

  it("exists and seeds US building-permit requirements", () => {
    expect(file).toBeDefined();
    expect(SQL).toContain("insert into pq_requirements");
    expect(SQL).toContain("'us', null, 'building_permit'");
  });

  it("is additive and idempotent — no schema change, no update, no delete", () => {
    expect(SQL).toContain("on conflict (jurisdiction, authority, application_type, code) do nothing");
    expect(SQL).not.toMatch(/\b(drop|alter|delete|truncate)\b/i);
    expect(SQL.match(/insert into/gi)).toHaveLength(1);
  });

  it("seeds the BASELINE only, so a municipality's own list still wins", () => {
    // resolveRequirements() collapses an authority's rows over the baseline per
    // code. Seeding anything with a named authority here would pre-empt a real
    // building department and be wrong for everyone else.
    const rows = [...SQL.matchAll(/\('us',\s*([^,]+),\s*'building_permit'/g)].map((m) => m[1].trim());
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(new Set(rows)).toEqual(new Set(["null"]));
  });

  it("is included in the regenerated schema bundle", () => {
    // The bundle is what actually gets pasted into Supabase. A migration that
    // is not in it never runs.
    const bundle = read("supabase", "bundles", "full_schema.sql");
    expect(bundle).toContain("'us', null, 'building_permit', 'plot_plan'");
  });

  it("the app no longer claims the US is unstocked", () => {
    const page = code(read("app", "portal", "permitiq", "page.tsx"));
    expect(page).not.toContain("not yet stocked");
    // …and still tells the truth about what the baseline is.
    expect(page).toContain("typical baseline");
  });

  it("the marketing copy names both jurisdictions", () => {
    const planiq = getMarketingProduct("planiq")!;
    const prose = [planiq.headline, planiq.sub, planiq.who, ...planiq.does.flatMap((d) => [d.title, d.body])].join(" ");
    expect(prose).toMatch(/Ireland/);
    expect(prose).toMatch(/\bUS\b|United States/);
    // And it does not oversell the US as a per-city catalogue it isn't yet.
    expect(prose).toMatch(/city by city|building department/i);
  });
});
