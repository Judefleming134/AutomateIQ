import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseAreas,
  buildLocalBusinessSchema,
  metaDescription,
  pageUrl,
  MAX_AREAS,
} from "@/lib/site-agent/page-content";
import { parseHours } from "@/lib/site-agent/hours";

/**
 * A SiteIQ page was published and then told to nobody: it appeared in no
 * sitemap, carried no structured data, and could not say which areas the
 * business covers. A customer paying for "a page that works, live today" had
 * a URL findable only by someone who already had it.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

describe("areas covered", () => {
  it("reads commas and newlines alike", () => {
    expect(parseAreas("Naas, Newbridge\nKildare town")).toEqual([
      "Naas",
      "Newbridge",
      "Kildare town",
    ]);
  });

  it("dedupes case-insensitively but keeps what was typed", () => {
    expect(parseAreas("Naas, naas, NAAS, Newbridge")).toEqual(["Naas", "Newbridge"]);
  });

  it("collapses stray whitespace", () => {
    expect(parseAreas("  Kildare   town  ,  Naas ")).toEqual(["Kildare town", "Naas"]);
  });

  it("drops empties instead of publishing blanks", () => {
    expect(parseAreas(",,\n\n  ,")).toEqual([]);
    expect(parseAreas("")).toEqual([]);
  });

  it("caps the list", () => {
    // Past a point this stops reading as a service area and starts reading as
    // keyword stuffing, which search engines penalise.
    const many = Array.from({ length: 60 }, (_, i) => `Town ${i}`).join(", ");
    expect(parseAreas(many)).toHaveLength(MAX_AREAS);
  });
});

describe("structured data — what turns a blue link into a result", () => {
  const full = () => {
    const hours = parseHours("Mon-Fri 09:00-17:00");
    return buildLocalBusinessSchema({
      name: "Byrne Plumbing",
      slug: "byrne-plumbing",
      headline: "Boilers fixed same day",
      about: "Family run since 1998.",
      services: ["Boiler repair", "Bathroom installation"],
      areas: ["Naas", "Newbridge"],
      phone: "045 123456",
      email: "hello@byrne.ie",
      logoUrl: "https://cdn.example/logo.png",
      hours: hours.ok ? hours.hours : [],
    });
  };

  it("is a LocalBusiness with a stable id", () => {
    const s = full();
    expect(s["@type"]).toBe("LocalBusiness");
    expect(s.name).toBe("Byrne Plumbing");
    expect(s.url).toBe("https://automateiq.ie/b/byrne-plumbing");
    expect(s["@id"]).toBe(s.url);
  });

  it("carries the phone, the hours and the area served", () => {
    // These three are the entire reason a local business wants the markup.
    const s = full();
    expect(s.telephone).toBe("045 123456");
    expect(s.areaServed).toEqual([
      { "@type": "Place", name: "Naas" },
      { "@type": "Place", name: "Newbridge" },
    ]);
    expect(Array.isArray(s.openingHoursSpecification)).toBe(true);
    expect((s.openingHoursSpecification as unknown[]).length).toBe(5);
  });

  it("lists the services as offers", () => {
    const catalog = full().hasOfferCatalog as { itemListElement: unknown[] };
    expect(catalog.itemListElement).toHaveLength(2);
  });

  it("OMITS a field rather than emitting it blank", () => {
    // An empty `telephone` is worse than no `telephone` — it asserts there
    // isn't one.
    const s = buildLocalBusinessSchema({ name: "Bare Ltd", slug: "bare" });
    expect(s).not.toHaveProperty("telephone");
    expect(s).not.toHaveProperty("email");
    expect(s).not.toHaveProperty("image");
    expect(s).not.toHaveProperty("areaServed");
    expect(s).not.toHaveProperty("openingHoursSpecification");
    expect(s).not.toHaveProperty("hasOfferCatalog");
    expect(s.name).toBe("Bare Ltd");
  });

  it("treats whitespace-only fields as absent", () => {
    const s = buildLocalBusinessSchema({
      name: "Bare Ltd",
      slug: "bare",
      phone: "   ",
      email: "",
      areas: ["  ", ""],
      services: ["  "],
    });
    expect(s).not.toHaveProperty("telephone");
    expect(s).not.toHaveProperty("areaServed");
    expect(s).not.toHaveProperty("hasOfferCatalog");
  });

  it("falls back to the headline when there is no about text", () => {
    const s = buildLocalBusinessSchema({
      name: "X",
      slug: "x",
      headline: "Boilers fixed same day",
      about: "",
    });
    expect(s.description).toBe("Boilers fixed same day");
  });

  it("serialises to valid JSON — it is injected into the page", () => {
    expect(() => JSON.parse(JSON.stringify(full()))).not.toThrow();
  });

  it("honours a different origin", () => {
    const s = buildLocalBusinessSchema({ name: "X", slug: "x" }, "https://staging.example/");
    expect(s.url).toBe("https://staging.example/b/x");
  });

  it("pageUrl is the one definition of a page's address", () => {
    expect(pageUrl("byrne-plumbing")).toBe("https://automateiq.ie/b/byrne-plumbing");
  });
});

describe("the meta description", () => {
  it("combines the headline, the about text and the areas", () => {
    const d = metaDescription({
      headline: "Boilers fixed same day",
      about: "Family run since 1998.",
      areas: ["Naas", "Newbridge"],
    });
    expect(d).toContain("Boilers fixed same day");
    expect(d).toContain("Serving Naas, Newbridge.");
  });

  it("cuts on a word boundary, never mid-word", () => {
    // "we cover Naas, Newb" is how a business gets judged by a stranger.
    const d = metaDescription({ about: "word ".repeat(80) })!;
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith("…")).toBe(true);
    expect(d).not.toMatch(/wor…$/);
  });

  it("is undefined rather than empty when there is nothing to say", () => {
    expect(metaDescription({})).toBeUndefined();
    expect(metaDescription({ headline: "  ", about: "" })).toBeUndefined();
  });

  it("does not list every area when there are many", () => {
    const d = metaDescription({
      headline: "Plumbers",
      areas: ["A", "B", "C", "D", "E", "F"],
    })!;
    expect(d).toContain("and more");
  });
});

describe("the page is wired into the things that make it findable", () => {
  const SITEMAP = readFileSync(path.join(ROOT, "app", "sitemap.ts"), "utf8");
  const PUBLIC = readFileSync(path.join(ROOT, "app", "b", "[slug]", "page.tsx"), "utf8");

  it("published pages are in the sitemap", () => {
    expect(SITEMAP).toContain("/b/${p.slug}");
    expect(SITEMAP).toContain('.eq("published", true)');
  });

  it("a database blip does not take the marketing pages out of the index", () => {
    const idx = SITEMAP.indexOf("async function publishedPages");
    expect(SITEMAP.slice(idx, idx + 900)).toContain("catch");
  });

  it("the public page emits the JSON-LD", () => {
    expect(PUBLIC).toContain('type="application/ld+json"');
    expect(PUBLIC).toContain("buildLocalBusinessSchema");
  });

  it("the public page still renders before migration 0040", () => {
    // Selecting a column that doesn't exist fails the whole query. A page a
    // customer is already paying for must not go dark for that.
    expect(PUBLIC).toContain("const { data: legacy }");
    expect(PUBLIC).toMatch(/readHours\(page\.hours\)/);
  });

  it("counting a view can never stop the page rendering", () => {
    const idx = PUBLIC.indexOf("async function countView");
    const body = PUBLIC.slice(idx, idx + 700);
    expect(body).toContain("try {");
    expect(body).toContain("catch");
    // And it is not awaited — the visitor never waits on bookkeeping.
    expect(PUBLIC).toContain("void countView(");
  });
});
