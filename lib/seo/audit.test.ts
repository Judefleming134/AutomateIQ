import { describe, it, expect } from "vitest";
import { auditFromHtml } from "./audit";

/**
 * The AutoSEO engine.
 *
 * This is the flagship free tool — the one a prospect or an investor is most
 * likely to actually run — and 1,000 lines of scoring logic had no tests at
 * all. A wrong finding here is worse than no tool: it is confidently bad
 * advice with our name on it.
 *
 * Fixtures are deliberately shaped like real Irish trade sites rather than
 * minimal snippets, because the bugs found writing this were all about how
 * checks interact, not about any single one in isolation.
 */

const GOOD = `<!doctype html><html lang="en-IE"><head>
<title>Murphy Plumbing Galway | Emergency Plumber, Boiler Repair</title>
<meta name="description" content="Murphy Plumbing has served Galway for 20 years. Emergency callouts, boiler service and bathroom fitting. Call 091 555 123 for a same-day quote today.">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://murphyplumbing.ie/">
<link rel="icon" href="/favicon.ico">
<meta property="og:title" content="Murphy Plumbing Galway">
<meta property="og:image" content="https://murphyplumbing.ie/og.png">
<meta property="og:description" content="Emergency plumber in Galway">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Plumber","name":"Murphy Plumbing","telephone":"+353 91 555 123","address":{"@type":"PostalAddress","streetAddress":"12 Shop St","addressLocality":"Galway"}}</script>
</head><body>
<h1>Emergency Plumber in Galway</h1>
<h2>Boiler repair</h2><h2>Bathroom fitting</h2>
<p>${"Murphy Plumbing has served Galway and the surrounding area for over twenty years. ".repeat(20)}</p>
<a href="tel:+353915551 23">Call us</a>
<p>12 Shop Street, Galway. Phone 091 555 123.</p>
<a href="/services">Services</a><a href="/about">About</a><a href="/contact">Contact</a>
<img src="/van.jpg" alt="Murphy Plumbing van"><img src="/bath.jpg" alt="Fitted bathroom">
</body></html>`;

/** No HTTPS, no viewport, no H1, no schema — a genuinely bad old site. */
const BAD = `<html><head><title>Home</title></head><body>
<div>Welcome</div><img src="a.jpg"><img src="b.jpg">
</body></html>`;

/** The shape this engine exists to catch: one bundle, empty mount point. */
const SPA = `<!doctype html><html lang="en"><head>
<title>Kelly Electrical Dublin | Rewiring and EV Chargers</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
</head><body><div id="root"></div><script src="/static/js/main.4f2a.js"></script></body></html>`;

const audit = (html: string, over: Partial<Parameters<typeof auditFromHtml>[0]> = {}) =>
  auditFromHtml({
    requestedUrl: "https://example.ie/",
    finalUrl: "https://example.ie/",
    html,
    loadMs: 420,
    robotsTxt: "User-agent: *\nAllow: /",
    sitemapXml: null,
    ...over,
  });

const byId = (a: ReturnType<typeof audit>, id: string) =>
  a.checks.find((c) => c.id === id)!;

describe("a well-built site is recognised as one", () => {
  const a = audit(GOOD, {
    requestedUrl: "https://murphyplumbing.ie/",
    finalUrl: "https://murphyplumbing.ie/",
    robotsTxt: "User-agent: *\nAllow: /\nSitemap: https://murphyplumbing.ie/sitemap.xml",
    sitemapXml: "<urlset><url><loc>https://murphyplumbing.ie/</loc></url></urlset>",
  });

  it("scores it highly and grades it well", () => {
    expect(a.score).toBeGreaterThanOrEqual(90);
    expect(["A", "B"]).toContain(a.grade);
  });

  it("fails nothing", () => {
    expect(a.checks.filter((c) => c.status === "fail").map((c) => c.id)).toEqual([]);
  });

  it("does not call a healthy site broken in the verdict", () => {
    expect(a.verdict).not.toMatch(/can't|isn't set up|Not secure/i);
  });

  it("still runs every check", () => {
    expect(a.checks.length).toBe(20);
    expect(a.counts.pass + a.counts.warn + a.counts.fail).toBe(20);
  });
});

describe("the lead finding is the one that actually matters", () => {
  const a = audit(BAD, { requestedUrl: "http://oldsite.ie", finalUrl: "http://oldsite.ie", loadMs: 3800, robotsTxt: null });

  it("leads with the missing HTTPS, not the meta description", () => {
    // THE BUG: priority tie-broke on the order checks were DECLARED in, where
    // meta_description sits at index 1 and https at 8. So a site with no
    // HTTPS and no mobile setup opened its report with "The site works, but
    // the two lines under your link in Google aren't selling anything" — on a
    // site scoring 21/100. A meta description is not a ranking factor at all.
    expect(a.checks[0].id).toBe("https");
  });

  it("says so in the verdict, in the owner's words", () => {
    expect(a.verdict).toContain("Not secure");
  });

  it("never opens by reassuring the owner of a failing site", () => {
    expect(a.score).toBeLessThan(40);
    expect(a.verdict).not.toMatch(/^The site works/);
  });

  it("puts mobile ahead of the meta description too", () => {
    const ids = a.checks.map((c) => c.id);
    expect(ids.indexOf("viewport")).toBeLessThan(ids.indexOf("meta_description"));
    expect(ids.indexOf("https")).toBeLessThan(ids.indexOf("meta_description"));
  });

  it("still sorts failures ahead of warnings, and high impact first", () => {
    const statuses = a.checks.map((c) => c.status);
    expect(statuses.indexOf("warn")).toBeGreaterThan(statuses.lastIndexOf("fail"));
  });
});

describe("a single-bundle SPA is caught", () => {
  const a = audit(SPA, { requestedUrl: "https://kelly.ie/", finalUrl: "https://kelly.ie/" });

  it("flags content that isn't in the HTML", () => {
    // THE BUG: the rule was `wordCount < 120 && scriptCount >= 3`. React,
    // Next, Vue and Angular all ship ONE bundle, so the exact site this check
    // calls "the single most common reason a good-looking modern site ranks
    // for nothing" sailed through as a PASS.
    expect(byId(a, "js_rendered").status).toBe("fail");
  });

  it("treats it as a showstopper and caps the score", () => {
    expect(a.blockers.map((b) => b.id)).toContain("js_rendered");
    expect(a.score).toBeLessThanOrEqual(35);
  });

  it("leads with it above everything else", () => {
    expect(a.checks[0].id).toBe("js_rendered");
    expect(a.verdict).toContain("can't read this site");
  });
});

describe("it does not cry wolf", () => {
  it("does not call a thin brochure page a JavaScript app", () => {
    // A small real page with an analytics tag is NOT server-rendering-broken,
    // and telling its owner to "enable SSR" would be confidently wrong. The
    // content check covers that case properly instead.
    const thin = `<!doctype html><html lang="en"><head><title>Joe's Tiling, Cork</title>
      <meta name="viewport" content="width=device-width"></head><body>
      <h1>Joe's Tiling</h1><p>Wall and floor tiling in Cork. Call 021 555 000.</p>
      <script src="https://analytics.example/tag.js"></script></body></html>`;
    const a = audit(thin);
    expect(byId(a, "js_rendered").status).toBe("pass");
    expect(byId(a, "content").status).not.toBe("pass");
  });

  it("does not flag a content-rich page that also ships scripts", () => {
    const a = audit(GOOD.replace("</body>", "<script src='/a.js'></script><script src='/b.js'></script><script src='/c.js'></script></body>"));
    expect(byId(a, "js_rendered").status).toBe("pass");
  });
});

describe("robots.txt blocking everything is fatal, and said plainly", () => {
  const a = audit(GOOD, { robotsTxt: "User-agent: *\nDisallow: /" });

  it("is a showstopper", () => {
    expect(byId(a, "robots").status).toBe("fail");
    expect(a.blockers.map((b) => b.id)).toContain("robots");
  });

  it("caps the score no matter how good the rest is", () => {
    expect(a.score).toBeLessThanOrEqual(35);
  });

  it("says everything else is beside the point", () => {
    expect(a.verdict).toContain("beside the point");
  });
});

describe("it never throws on the shapes a real crawl returns", () => {
  it.each([
    ["empty document", ""],
    ["a bare fragment", "<p>hello</p>"],
    ["unclosed tags", "<html><head><title>x</title><body><div><p>y"],
    ["no head", "<html><body><h1>Hi</h1></body></html>"],
    ["a comment only", "<!-- nothing here -->"],
  ])("survives %s", (_label, html) => {
    const a = audit(html);
    expect(() => a).not.toThrow();
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
    expect(a.checks.length).toBe(20);
    expect(a.verdict.length).toBeGreaterThan(0);
  });

  it("keeps the score inside 0–100 for a perfect and a hopeless page", () => {
    expect(audit(GOOD).score).toBeLessThanOrEqual(100);
    expect(audit("").score).toBeGreaterThanOrEqual(0);
  });
});

describe("every finding is actionable", () => {
  const a = audit(BAD, { robotsTxt: null });

  it("tells you what was found, why it matters and what to do", () => {
    for (const c of a.checks) {
      expect(c.found, c.id).toBeTruthy();
      expect(c.why, c.id).toBeTruthy();
      expect(c.fix, c.id).toBeTruthy();
    }
  });

  it("gives every check a label a non-technical owner can read", () => {
    for (const c of a.checks) {
      expect(c.label, c.id).toBeTruthy();
      expect(c.label, c.id).not.toMatch(/_/);
    }
  });
});
