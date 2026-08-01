import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  MARKETING_PRODUCTS,
  MARKETING_LEAD_SOURCES,
  DEFAULT_LEAD_SOURCE,
  getMarketingProduct,
  resolveLeadSource,
} from "./marketing";

/**
 * The public product pages, guarded against the two ways they can quietly
 * stop working:
 *
 * 1. A **Log in** button pointing at a route that no longer exists. These are
 *    plain strings in a data file, so a route move renames nothing and the
 *    button 404s the exact visitor who was ready to pay. Checked against the
 *    real route tree on disk.
 * 2. A **Request access** form posting a `source` the API rejects. The API
 *    allow-lists it, so a typo here silently relabels every lead from that
 *    page as a homepage signup and the reply goes out about the wrong product.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** True when a path resolves to a Next route (page.tsx or a redirect). */
function routeExists(href: string): boolean {
  const segments = href.replace(/^\//, "").split("/").filter(Boolean);
  const dir = path.join(ROOT, "app", ...segments);
  if (existsSync(path.join(dir, "page.tsx"))) return true;
  // Route groups: app/tradeiq/(app)/login/page.tsx — the group folder is not
  // part of the URL, so a direct path check misses it.
  const parent = path.join(ROOT, "app", ...segments.slice(0, -1));
  const last = segments[segments.length - 1];
  if (!existsSync(parent)) return false;
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(parent).some(
    (entry) =>
      entry.startsWith("(") &&
      existsSync(path.join(parent, entry, last, "page.tsx"))
  );
}

describe("marketing products — the data itself", () => {
  it("brands every product with the IQ suffix", () => {
    const wrong = MARKETING_PRODUCTS.filter((p) => !p.name.endsWith("IQ"));
    expect(wrong.map((p) => p.name)).toEqual([]);
  });

  it("uses a lowercase slug matching the name", () => {
    for (const p of MARKETING_PRODUCTS) {
      expect(p.slug).toBe(p.name.toLowerCase());
    }
  });

  it("gives each product a unique slug and lead source", () => {
    const slugs = MARKETING_PRODUCTS.map((p) => p.slug);
    const sources = MARKETING_PRODUCTS.map((p) => p.leadSource);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("says something concrete about every product", () => {
    for (const p of MARKETING_PRODUCTS) {
      expect(p.does.length).toBeGreaterThanOrEqual(3);
      expect(p.sub.length).toBeGreaterThan(30);
      expect(p.who.length).toBeGreaterThan(30);
    }
  });

  it("looks a product up by slug, and returns nothing for a stranger", () => {
    expect(getMarketingProduct("tradeiq")?.name).toBe("TradeIQ");
    expect(getMarketingProduct("nonsense")).toBeUndefined();
  });
});

describe("marketing products — the log-in door", () => {
  it("points every Log in button at a route that exists", () => {
    const broken = MARKETING_PRODUCTS.filter((p) => !routeExists(p.loginHref));
    expect(broken.map((p) => `${p.name} -> ${p.loginHref}`)).toEqual([]);
  });

  it("has a page on disk for every product", () => {
    // The [slug] route is one file, but the index page links each slug
    // directly — this asserts the dynamic route is where it claims to be.
    expect(
      existsSync(path.join(ROOT, "app", "products", "[slug]", "page.tsx"))
    ).toBe(true);
    expect(existsSync(path.join(ROOT, "app", "products", "page.tsx"))).toBe(true);
  });
});

describe("marketing products — the request-access door", () => {
  it("accepts every source the product pages actually post", () => {
    for (const p of MARKETING_PRODUCTS) {
      expect(resolveLeadSource(p.leadSource)).toEqual({
        source: p.leadSource,
        productName: p.name,
      });
    }
  });

  it("exports exactly the sources the products declare", () => {
    expect(MARKETING_LEAD_SOURCES).toEqual(
      MARKETING_PRODUCTS.map((p) => p.leadSource)
    );
  });

  it("falls back rather than storing whatever a bot posts", () => {
    // The lead is still kept — it just can't relabel the pipeline.
    for (const junk of [
      "'; drop table leads;--",
      "enterprise-whale",
      "",
      "   ",
      null,
      undefined,
      42,
      { source: "product-tradeiq" },
    ]) {
      expect(resolveLeadSource(junk)).toEqual({
        source: DEFAULT_LEAD_SOURCE,
        productName: null,
      });
    }
  });

  it("trims the value before matching, so whitespace still attributes", () => {
    expect(resolveLeadSource("  product-permitiq  ").productName).toBe("PermitIQ");
  });
});

describe("the homepage links to the product pages", () => {
  const HTML = readFileSync(path.join(ROOT, "public", "index.html"), "utf8");

  it("links the index", () => {
    expect(HTML).toContain('href="/products"');
  });

  it("links every product page", () => {
    const missing = MARKETING_PRODUCTS.filter(
      (p) => !HTML.includes(`href="/products/${p.slug}"`)
    );
    expect(missing.map((p) => p.slug)).toEqual([]);
  });

  it("gives every product it NAMES somewhere to go", () => {
    // THE BUG THIS CAUGHT. The homepage's flow diagram introduced
    // "ReputationIQ" as step 04 and described what it does — while
    // /products/reputationiq did not exist and no card linked anywhere. The
    // site advertised a product and then dead-ended the visitor who wanted it.
    //
    // Any *IQ name printed in a heading is a promise; this checks the page
    // behind it exists. Names that are deliberately not standalone products
    // (the shared core modules, sold inside a product) are listed out.
    const NOT_STANDALONE = new Set([
      "AutomateIQ", // the company
      "ReceptionIQ", "SiteIQ", "AssistIQ", "ContentIQ",
      "QuoteIQ", "ClientIQ", "LeadIQ", "CustomIQ",
    ]);
    const named = new Set(
      [...HTML.matchAll(/<h[1-4][^>]*>([A-Z][A-Za-z]*IQ)<\/h[1-4]>/g)].map((m) => m[1])
    );
    const sellable = [...named].filter((n) => !NOT_STANDALONE.has(n));
    const orphaned = sellable.filter(
      (name) => !MARKETING_PRODUCTS.some((p) => p.name === name)
    );
    expect(orphaned).toEqual([]);
  });

  it("does not state a product count that contradicts the list", () => {
    // "Three products you can switch on now" sat above four cards, and the
    // footer said "All three, compared" while linking four. A number written
    // out in prose is the one thing adding a product silently invalidates.
    const WORDS = ["one", "two", "three", "four", "five", "six"];
    const correct = WORDS[MARKETING_PRODUCTS.length - 1];
    const wrong = WORDS.filter((w) => w !== correct);
    // Only phrasings that are genuinely counting PRODUCTS. A looser pattern
    // (`just|only \w+`) flagged "Just one connected core", which counts the
    // core, not the range — a test that cries wolf gets muted.
    const claims = [
      ...HTML.matchAll(/\ball (one|two|three|four|five|six)\b/gi),
      ...HTML.matchAll(/\b(one|two|three|four|five|six) products\b/gi),
    ]
      .map((m) => m[1].toLowerCase())
      .filter((w) => wrong.includes(w));
    expect(claims).toEqual([]);
  });
});

describe("the sitemap lists the product pages", () => {
  const SITEMAP = readFileSync(path.join(ROOT, "app", "sitemap.ts"), "utf8");

  it("includes /products", () => {
    expect(SITEMAP).toContain("/products");
  });

  it("builds the per-product entries from the same list", () => {
    // Hard-coding them would let a fourth product ship invisible to Google.
    expect(SITEMAP).toContain("MARKETING_PRODUCTS.map");
  });
});

describe("the products index describes what is actually on it", () => {
  const INDEX = readFileSync(
    path.join(ROOT, "app", "products", "page.tsx"),
    "utf8"
  );

  it("derives its title and description rather than typing the names out", () => {
    // The <title> read "Products — TradeIQ, FinanceIQ, PermitIQ" while the
    // page rendered four cards. Same trap the sitemap test names: a
    // hard-coded list ships a product invisible to search.
    expect(INDEX).toContain("MARKETING_PRODUCTS.map((p) => p.name)");
    expect(INDEX).not.toMatch(/title:\s*["'`]Products — TradeIQ, FinanceIQ, PermitIQ/);
  });

  it("names no product in its metadata that the list does not contain", () => {
    const meta = INDEX.slice(0, INDEX.indexOf("export default"));
    const names = [...meta.matchAll(/\b([A-Z][A-Za-z]*IQ)\b/g)].map((m) => m[1]);
    const unknown = names.filter(
      (n) => n !== "AutomateIQ" && !MARKETING_PRODUCTS.some((p) => p.name === n)
    );
    expect(unknown).toEqual([]);
  });

  it("renders every product from the list, so a new one needs no page edit", () => {
    expect(INDEX).toContain("MARKETING_PRODUCTS.map((p) => (");
  });
});
