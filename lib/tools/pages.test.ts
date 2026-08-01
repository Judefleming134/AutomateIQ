import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The six individual free-tool pages.
 *
 * The hub was rebuilt first; these were left as a bare hero, the tool, and
 * then nothing — and three separate faults were hiding in that gap:
 *
 *   1. AutoSEO rendered its OWN page shell and topbar on top of the layout's,
 *      so the flagship free tool showed two logos and two identical
 *      "Book a strategy session" buttons.
 *   2. Four of the six pages were statically prerendered while reading which
 *      tools are switched on, so the cross-links froze at build time: the
 *      review writer appeared on one tool page and was missing from four
 *      others, from the same deploy.
 *   3. The Google checker was in the sitemap the entire time it was returning
 *      "not switched on yet" — Google was being told to send people searching
 *      for exactly that problem to a dead end.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TOOLS = [
  "autoseo",
  "google-profile",
  "response-time",
  "missed-calls",
  "reviews",
  "quote-builder",
];

const pageSrc = (slug: string) =>
  readFileSync(path.join(ROOT, "app", "freetools", slug, "page.tsx"), "utf8");

describe("every tool page uses the shared shell", () => {
  it.each(TOOLS)("%s renders no topbar of its own", (slug) => {
    // The layout already provides book-page + topbar + footer. A second one
    // means two logos and two CTAs stacked at the top of the page.
    expect(pageSrc(slug)).not.toContain('className="book-topbar"');
  });

  it.each(TOOLS)("%s does not open its own book-page wrapper", (slug) => {
    expect(pageSrc(slug)).not.toContain('className="book-page sv-page"');
  });

  it("the layout provides exactly one topbar and one footer", () => {
    const layout = readFileSync(
      path.join(ROOT, "app", "freetools", "layout.tsx"),
      "utf8"
    );
    expect((layout.match(/className="book-topbar"/g) ?? []).length).toBe(1);
    expect((layout.match(/className="book-footer"/g) ?? []).length).toBe(1);
  });
});

describe("every tool page says what you get, and where to go next", () => {
  it.each(TOOLS)("%s states the outputs before you use it", (slug) => {
    expect(pageSrc(slug)).toContain("<ToolGives");
  });

  it.each(TOOLS)("%s offers a way onward instead of ending on whitespace", (slug) => {
    expect(pageSrc(slug)).toContain("<ToolNext");
  });

  it.each(TOOLS)("%s carries its own accent", (slug) => {
    expect(pageSrc(slug)).toContain("<ToolAccent");
  });
});

describe("availability cannot freeze at build time", () => {
  it("declares dynamic rendering once, on the segment", () => {
    // Set on the layout rather than six times, so a seventh tool inherits it
    // instead of having to remember. Four pages were `○ Static` and their
    // cross-links disagreed with each other from the same deploy.
    const layout = readFileSync(
      path.join(ROOT, "app", "freetools", "layout.tsx"),
      "utf8"
    );
    expect(layout).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("the sitemap is rendered per request too", () => {
    // It now depends on which tools are live, so a static sitemap would go on
    // advertising a dead one.
    const sitemap = readFileSync(path.join(ROOT, "app", "sitemap.ts"), "utf8");
    expect(sitemap).toMatch(/export const dynamic = "force-dynamic"/);
  });
});

describe("search engines are not sent to a dead tool", () => {
  const KEYS = ["GOOGLE_PLACES_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function sitemapUrls(): Promise<string[]> {
    vi.resetModules();
    const mod = await import("@/app/sitemap");
    // Async since it now reads the published SiteIQ pages from the database.
    return (await mod.default()).map((e) => e.url);
  }

  it("drops the Google checker from the sitemap while it is switched off", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const urls = await sitemapUrls();
    expect(urls).not.toContain("https://automateiq.ie/freetools/google-profile");
    // The working ones are still there.
    expect(urls).toContain("https://automateiq.ie/freetools/autoseo");
    expect(urls).toContain("https://automateiq.ie/freetools/reviews");
  });

  it("lists it again the moment the key exists — nothing to remember", async () => {
    process.env.GOOGLE_PLACES_API_KEY = "k";
    process.env.ANTHROPIC_API_KEY = "k";
    const urls = await sitemapUrls();
    expect(urls).toContain("https://automateiq.ie/freetools/google-profile");
  });

  it("drops the review writer too when there is no AI provider", async () => {
    const urls = await sitemapUrls();
    expect(urls).not.toContain("https://automateiq.ie/freetools/reviews");
  });

  it("always keeps the hub itself listed", async () => {
    const urls = await sitemapUrls();
    expect(urls).toContain("https://automateiq.ie/freetools");
  });

  it("noindexes the Google page itself while it is off", () => {
    const src = pageSrc("google-profile");
    expect(src).toContain("generateMetadata");
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false/);
    expect(src).toContain("gbpConfigured()");
  });
});

describe("the quote builder's embed snippet cannot blow the page width", () => {
  const CSS = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");

  it("constrains the grid children so a long unbroken URL can scroll", () => {
    // Grid children default to min-width:auto and refuse to shrink below
    // min-content. One ~450-character embed URL grew its column to 3,797px and
    // gave the whole page a 3,429px horizontal scrollbar on a phone.
    expect(CSS).toMatch(/\.grid-main-side > \*\s*\{[^}]*min-width:\s*0/);
    expect(CSS).toMatch(/\.aseo-code\s*\{[^}]*min-width:\s*0/);
  });
});
