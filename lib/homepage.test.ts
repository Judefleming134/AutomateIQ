import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PRODUCT_FAMILIES } from "@/lib/products/registry";
import { PROOF } from "@/lib/proof";

/**
 * The homepage, guarded against drift.
 *
 * `public/index.html` is a hand-built static file outside the Next app. That is
 * a deliberate trade — see the note at the bottom of docs/SITE-MAP.md — but it
 * has one real cost: the app cannot reach it, so every codebase-wide change
 * misses it silently. That has now happened TWICE. The *IQ rebrand skipped it
 * because that pass only touched .ts/.tsx, and demo.html sat there for weeks
 * showing pre-rebrand product names to anyone with the URL.
 *
 * This is the fix that actually addresses the cause: the front page can stay
 * hand-crafted, but it can no longer disagree with the platform in silence. CI
 * runs this on every pull request, so the failure arrives in a diff instead of
 * in front of a customer.
 *
 * It deliberately checks FACTS, not design. Nothing here constrains layout,
 * copy or styling — only that the page tells the truth about what exists.
 */

const HTML = readFileSync(
  path.resolve(import.meta.dirname, "..", "public", "index.html"),
  "utf8"
);

/** Names retired by the rebrand. None may reappear on the front page. */
const RETIRED = [
  "TradeOS",
  "Review Agent",
  "Website Agent",
  "AI Assistant",
  "Content Agent",
  "Instant Quote Agent",
  "CRM Agent",
  "Speed-to-Lead",
  "Voice Agent",
  "Instagram DM Setter",
  "AI Logistics",
  "Custom Solutions",
];

describe("homepage — branding cannot drift", () => {
  it("shows no retired product name", () => {
    const found = RETIRED.filter((n) => HTML.includes(n));
    expect(found).toEqual([]);
  });

  it("names every product family the platform actually has", () => {
    // If a new vertical is added to the registry, the front page has to
    // acknowledge it. This is the check that would have caught PermitIQ being
    // invisible on the homepage for a day.
    const missing = PRODUCT_FAMILIES.filter((f) => !HTML.includes(f.label)).map(
      (f) => f.label
    );
    expect(missing).toEqual([]);
  });
});

describe("homepage — the proof point matches lib/proof.ts", () => {
  it("quotes the same jobs figure as every other surface", () => {
    // A prospect who reads one number in a cold email and another on the site
    // stops believing both.
    expect(HTML).toContain(PROOF.jobsProcessedLabel);
  });

  it("quotes the same revenue lift", () => {
    expect(HTML).toContain(PROOF.revenueLiftLabel);
  });

  it("names and links the client, so the claim is checkable", () => {
    expect(HTML).toContain(PROOF.client);
    expect(HTML).toContain(PROOF.clientUrl);
  });
});

describe("homepage — the conversion path exists", () => {
  it("sends people to the booking page", () => {
    expect(HTML).toContain('href="/book"');
  });

  it("sends people to the free tools", () => {
    expect(HTML).toContain('href="/freetools"');
  });

  it("has a pricing section, even though there is no price list", () => {
    // "We don't publish prices" is a position. Having no pricing section at all
    // is an omission, and buyers read the two very differently.
    expect(HTML).toContain('id="pricing"');
  });

  it("does not describe itself as pre-launch", () => {
    // The waitlist framing ("ahead of launch", "when we open the doors") was
    // costing bookings while the product was live and taking payments.
    // "early access" was still in the hero button, the nav and the colophon
    // long after the product was live with 500+ jobs through it — the page
    // was arguing with its own proof section.
    const preLaunch = [
      "ahead of launch",
      "when we open the doors",
      "Request access",
      "early access",
      "early-access",
    ];
    expect(preLaunch.filter((p) => HTML.includes(p))).toEqual([]);
  });

  it("gives an existing customer a way to log in", () => {
    // The whole marketing site had no login door anywhere. A paying customer
    // landing on the front page had to already know the URL of their own
    // account. Same class of miss as /tradeiq being a bare password box.
    expect(HTML).toContain('href="/login"');
  });

  it("sends people to the product pages", () => {
    expect(HTML).toContain('href="/products"');
  });

  it("never shows the same nav label twice", () => {
    // The header carried "Free Tools" twice, pointing at two different
    // places. A visitor reads that as a broken page, not a choice.
    for (const nav of HTML.match(/<nav class="nav-links"[^>]*>[\s\S]*?<\/nav>/g) ?? []) {
      const labels = [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) =>
        m[1].trim()
      );
      expect(labels.length).toBeGreaterThan(0);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe("homepage — the built-in assistant tells the truth", () => {
  it("scores keywords by length instead of taking the first match", () => {
    // The bare keyword 'do' sat in an early entry and was a substring of
    // "how much DOes it cost", "what DOes it cost", "how DO i get started"
    // and "DO you have a demo" — so every pricing question on the page was
    // answered with the generic capabilities blurb, and one of the suggested
    // chips returned the wrong answer outright. Longest-match fixes the class.
    expect(HTML).toMatch(/k\.length\s*>\s*bestLen/);
  });

  it("points enquiries at the booking page, not a waitlist form", () => {
    const kb = HTML.slice(HTML.indexOf("var KB=["), HTML.indexOf("function respond("));
    expect(kb).toContain("automateiq.ie/book");
    expect(kb).toContain("automateiq.ie/products");
  });

  it("knows every product by name", () => {
    const kb = HTML.slice(HTML.indexOf("var KB=["), HTML.indexOf("function respond("));
    const missing = ["TradeIQ", "FinanceIQ", "PermitIQ"].filter(
      (n) => !kb.includes(n)
    );
    expect(missing).toEqual([]);
  });

  it("every chip it suggests reaches a real answer", () => {
    // A suggested question that falls through to "I'm a simple assistant" is
    // worse than not suggesting it. Replays the page's own matcher.
    const src = HTML.slice(HTML.indexOf("var KB=["), HTML.indexOf("function respond("));
    const bot = new Function(
      `${src}\nreturn { answer: answer, CHIPS: CHIPS, FALLBACK: FALLBACK };`
    )() as {
      answer: (q: string) => string;
      CHIPS: [string, string][];
      FALLBACK: string;
    };
    const fellThrough = bot.CHIPS.filter(
      ([, q]) => bot.answer(q) === bot.FALLBACK
    ).map(([label]) => label);
    expect(fellThrough).toEqual([]);
  });

  it("answers a pricing question with the pricing answer", () => {
    const src = HTML.slice(HTML.indexOf("var KB=["), HTML.indexOf("function respond("));
    const bot = new Function(`${src}\nreturn { answer: answer };`)() as {
      answer: (q: string) => string;
    };
    for (const q of ["how much does it cost", "what does it cost", "pricing"]) {
      expect(bot.answer(q)).toContain("no price list");
    }
  });
});

describe("homepage — structural integrity", () => {
  it("has balanced section, div and anchor tags", () => {
    // A hand-edited 140KB file is exactly where an unclosed tag hides. Cheap to
    // check, and it has already caught a malformed anchor once.
    const count = (re: RegExp) => (HTML.match(re) ?? []).length;
    expect(count(/<section[\s>]/g)).toBe(count(/<\/section>/g));
    expect(count(/<div[\s>]/g)).toBe(count(/<\/div>/g));
    expect(count(/<a[\s>]/g)).toBe(count(/<\/a>/g));
    expect(count(/<p[\s>]/g)).toBe(count(/<\/p>/g));
  });

  it("numbers its sections sequentially with no gap or repeat", () => {
    // Inserting a section mid-page has twice left a duplicate number behind.
    const nums = [...HTML.matchAll(/<span class="num">(\d{2})<\/span>/g)].map((m) =>
      Number(m[1])
    );
    expect(nums.length).toBeGreaterThan(0);
    expect(nums).toEqual(nums.map((_, i) => i + 1));
  });

  it("links no static page that has been deleted", () => {
    // /agents.html was deleted and 308s to /systems. Four agent cards and
    // three page footers still pointed at it, and the redirect drops the
    // #slug — so "Click to preview" on ReceptionIQ landed you on the
    // custom-systems page with no ReceptionIQ on it.
    const staticHrefs = [
      ...HTML.matchAll(/href=["'](\/[a-z0-9-]+\.html)(?:#[a-z-]*)?["']/g),
      ...HTML.matchAll(/href="(\/[a-z0-9-]+\.html)#'/g),
    ].map((m) => m[1]);
    const missing = [...new Set(staticHrefs)].filter(
      (h) => !existsSync(path.resolve(import.meta.dirname, "..", "public", h.slice(1)))
    );
    expect(missing).toEqual([]);
  });

  it("wires every 'click to preview' card to the preview panel", () => {
    // The cards promised a preview and navigated away instead: they carried
    // no data-id, so the handler that drives the panel never saw them.
    const cards = [...HTML.matchAll(/class="ag-fcard[^"]*"([^>]*)>/g)].map((m) => m[1]);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.filter((attrs) => !attrs.includes("data-id"))).toEqual([]);
  });

  it("every in-page anchor points at a section that exists", () => {
    const targets = [...HTML.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]);
    const broken = [...new Set(targets)].filter(
      (t) => t !== "top" && !HTML.includes(`id="${t}"`)
    );
    expect(broken).toEqual([]);
  });
});
