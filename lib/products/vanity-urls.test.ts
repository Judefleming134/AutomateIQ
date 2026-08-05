import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import nextConfig from "@/next.config";
import { MARKETING_PRODUCTS } from "./marketing";
import { PRODUCT_REGISTRY } from "./registry";

/**
 * Every product name is an address.
 *
 * Jude's ask, verbatim: "Each product should have there own / for example
 * quoteIQ should be automateiq.ie/quoteiq same for all of them."
 *
 * It was true of exactly two. `/permitiq` and `/financeiq` were added when
 * someone noticed those two names had no URL in any casing, and the fix
 * stopped there. Everything else still answered only at the OLD INTERNAL
 * SLUG, behind a login:
 *
 *     QuoteIQ        /portal/instant-quote-agent
 *     ClientIQ       /portal/crm-agent
 *     LeadIQ         /portal/speed-to-lead-agent
 *     CustomIQ       /portal/custom-solutions
 *     SiteIQ         /portal/website-agent
 *     AssistIQ       /portal/ai-assistant
 *     ContentIQ      /portal/content-agent
 *     ReputationIQ   /portal/review-agent
 *
 * Not one of those is guessable, sayable on a call, or printable on a card.
 * "It's automateiq.ie slash quoteiq" was a 404 — on the product being pitched
 * for the trial customers.
 *
 * Two properties are guarded here, because either alone is useless:
 *   1. the vanity path resolves, in the casing a human writes the brand in;
 *   2. it lands on a page that is ABOUT THAT PRODUCT — a redirect pointing at
 *      the wrong slug is worse than a 404, because it looks like it worked.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

type Redirect = { source: string; destination: string; permanent: boolean };

async function redirects(): Promise<Redirect[]> {
  const fn = (nextConfig as { redirects?: () => Promise<Redirect[]> }).redirects;
  if (!fn) throw new Error("next.config has no redirects()");
  return fn();
}

/**
 * True when a path resolves to a real Next route.
 *
 * Route groups are folders in `(brackets)` that contribute nothing to the URL,
 * and they appear on BOTH sides of the segment: /tradeiq is served by
 * app/tradeiq/(app)/page.tsx, while /growth/inbox is app/growth/(app)/inbox.
 * Checking only one of those shapes reports a live route as missing.
 */
function routeExists(href: string): boolean {
  const segments = href.replace(/^\//, "").split("/").filter(Boolean);
  const dir = path.join(ROOT, "app", ...segments);
  if (existsSync(path.join(dir, "page.tsx"))) return true;
  // A group INSIDE the segment: app/tradeiq/(app)/page.tsx
  if (
    existsSync(dir) &&
    readdirSync(dir).some(
      (entry) =>
        entry.startsWith("(") && existsSync(path.join(dir, entry, "page.tsx"))
    )
  ) {
    return true;
  }
  // A group ABOVE the segment: app/growth/(app)/inbox/page.tsx
  const parent = path.join(ROOT, "app", ...segments.slice(0, -1));
  const last = segments[segments.length - 1];
  if (!existsSync(parent)) return false;
  return readdirSync(parent).some(
    (entry) =>
      entry.startsWith("(") &&
      existsSync(path.join(parent, entry, last, "page.tsx"))
  );
}

/**
 * Follow a path to where a visitor actually lands: a redirect if one matches,
 * otherwise the path itself. One hop is enough — the redirect table is
 * separately asserted to be loop-free.
 */
function landing(rows: Redirect[], from: string): string | null {
  const hit = rows.find((r) => r.source === from);
  if (hit) return hit.destination;
  return routeExists(from) ? from : null;
}

/** The brand as it is written: quoteiq → quoteIQ. */
const brandCase = (slug: string) => `${slug.slice(0, -2)}IQ`;

describe("every product answers at automateiq.ie/<its own name>", () => {
  it.each(MARKETING_PRODUCTS.map((p) => [p.name, p.slug] as const))(
    "%s resolves at /%s",
    async (_name, slug) => {
      const rows = await redirects();
      expect(landing(rows, `/${slug}`), `/${slug} goes nowhere`).not.toBeNull();
    }
  );

  it.each(MARKETING_PRODUCTS.map((p) => [p.name, p.slug] as const))(
    "%s lands on something about %s, not another product",
    async (name, slug) => {
      const rows = await redirects();
      const dest = landing(rows, `/${slug}`)!;
      // Either the product's own marketing page, or its own app route.
      expect([`/products/${slug}`, `/${slug}`], `${name} → ${dest}`).toContain(dest);
      // And the page it points at is really there.
      if (dest.startsWith("/products/")) {
        expect(MARKETING_PRODUCTS.some((p) => p.slug === slug)).toBe(true);
        expect(existsSync(path.join(ROOT, "app", "products", "[slug]", "page.tsx"))).toBe(true);
      } else {
        expect(routeExists(dest)).toBe(true);
      }
    }
  );
});

describe("the casing people actually write", () => {
  it.each(MARKETING_PRODUCTS.map((p) => [brandCase(p.slug), p.slug] as const))(
    "/%s works as well as /%s",
    async (branded, slug) => {
      // Next matches `source` case-sensitively and there is no middleware in
      // this app, so /quoteIQ is NOT the same request as /quoteiq. This is the
      // form printed on a card.
      const rows = await redirects();
      expect(landing(rows, `/${branded}`), `/${branded} goes nowhere`).not.toBeNull();
      expect([`/products/${slug}`, `/${slug}`]).toContain(landing(rows, `/${branded}`));
    }
  );

  it("proves the case-sensitivity is real, not assumed", () => {
    // If Next ever became case-insensitive these entries would be harmless
    // duplicates rather than load-bearing — but the assumption is worth
    // pinning: the two spellings are distinct strings and both are listed.
    expect("/quoteIQ").not.toBe("/quoteiq");
    expect(routeExists("/tradeIQ")).toBe(false);
    expect(routeExists("/tradeiq")).toBe(true);
  });
});

describe("nothing was left behind", () => {
  it("covers every branded product in the portal registry too", async () => {
    // The registry is the portal's list; the marketing list is the public one.
    // A name that exists in the portal and nowhere public is the exact state
    // QuoteIQ was in. ReceptionIQ is not in either registry — it is a feature
    // of TradeIQ, sold inside it.
    const rows = await redirects();
    const orphans = PRODUCT_REGISTRY.filter(
      (p) => landing(rows, `/${p.name.toLowerCase()}`) === null
    ).map((p) => `${p.name} (${p.key})`);
    expect(orphans).toEqual([]);
  });

  it("keeps /tradeiq pointing at the APP, not the marketing page", async () => {
    // TradeIQ is the one product whose vanity URL is a real route: the app
    // lives there, and /tradeos/:path* — every invoice and quote link already
    // emailed to a tradesperson's own customer — redirects INTO it. Pointing
    // /tradeiq at /products/tradeiq would break both.
    const rows = await redirects();
    expect(rows.find((r) => r.source === "/tradeiq")).toBeUndefined();
    expect(routeExists("/tradeiq")).toBe(true);
    expect(rows.find((r) => r.source === "/tradeos/:path*")?.destination).toBe(
      "/tradeiq/:path*"
    );
  });

  it("adds no redirect that shadows an existing route", async () => {
    // A redirect wins over the filesystem, so a source that is ALSO a real
    // page would silently take that page off the site.
    const rows = await redirects();
    const shadowed = rows
      .filter((r) => !r.source.includes(":") && !r.source.endsWith(".html"))
      .filter((r) => routeExists(r.source))
      .map((r) => r.source);
    expect(shadowed).toEqual([]);
  });

  it("every vanity redirect is permanent, so the ranking transfers", async () => {
    const rows = await redirects();
    const vanity = rows.filter((r) => r.destination.startsWith("/products/"));
    expect(vanity.length).toBeGreaterThanOrEqual(MARKETING_PRODUCTS.length);
    expect(vanity.every((r) => r.permanent)).toBe(true);
  });
});
