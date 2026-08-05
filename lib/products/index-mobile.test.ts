import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MARKETING_PRODUCTS, marketingGroups } from "./marketing";

/**
 * /products on a phone.
 *
 * The page went from seven cards to eleven when QuoteIQ, ClientIQ, LeadIQ and
 * CustomIQ got their own pages, and at 390×844 that is one column roughly
 * 5,800px long — nearly seven screens of near-identical grey card, with no way
 * to tell what is further down or how much further down it is. Someone who
 * came here for QuoteIQ had to swipe past ten other products to find out
 * whether it was even on the page.
 *
 * Measured in headless Chromium at 390×844 (iPhone 14 width), before → after:
 *
 *   page height            5,782px  →  5,727px   (6.9 → 6.8 screens)
 *   card height              327px  →    323px
 *   card padding              24px  →     18px
 *   contents strip              —   →    159px, 11 tap targets
 *   horizontal scroll         none  →     none
 *
 * i.e. the card content got ~215px tighter, which paid for a contents strip
 * that puts every product one tap away, and the page still came out shorter
 * than it started.
 *
 * One thing was tried and REVERTED, recorded here so it isn't re-added on
 * instinct: stacking the two card buttons full-width on a phone. Measured,
 * they are 87px and 124px inside 298px of content width — no crowding — and
 * stacking cost ~38px per card, 420px across eleven, for nothing.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const INDEX = readFileSync(path.join(ROOT, "app", "products", "page.tsx"), "utf8");
const CSS = readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");

/**
 * The `@media (max-width: 900px)` block that owns THIS page's phone layout.
 *
 * Anchored past `.prod-index-more`, because globals.css has another
 * `@media (max-width: 900px)` a few thousand lines earlier for the app shell's
 * sidebar. Searching from the top of the file finds that one and then quietly
 * asserts nothing — which is how this test first passed while checking the
 * wrong block.
 */
const MOBILE = (() => {
  const anchor = CSS.indexOf(".prod-index-more:hover");
  expect(anchor, "the products index CSS is gone").toBeGreaterThan(-1);
  const start = CSS.indexOf("@media (max-width: 900px)", anchor);
  expect(start, "the 900px breakpoint block is gone").toBeGreaterThan(-1);
  const end = CSS.indexOf("@media (max-width: 760px)", start);
  expect(end, "the 760px block that bounds it is gone").toBeGreaterThan(-1);
  return CSS.slice(start, end);
})();

describe("the contents strip", () => {
  it("is rendered from the product list, so a twelfth product needs no page edit", () => {
    const strip = INDEX.slice(
      INDEX.indexOf('<nav className="prod-jump"'),
      INDEX.indexOf("</nav>")
    );
    expect(strip).toContain("MARKETING_PRODUCTS.map");
    expect(strip).toContain("prod-jump-chip");
  });

  it("points every chip at that product's own page", () => {
    const strip = INDEX.slice(
      INDEX.indexOf('<nav className="prod-jump"'),
      INDEX.indexOf("</nav>")
    );
    // The same href the card title uses — a chip that went somewhere else
    // would be a second, silently diverging route to each product.
    expect(strip).toContain("href={`/products/${p.slug}`}");
    expect(strip).toContain("{p.name}");
  });

  it("carries each product's accent, so the strip reads as a range", () => {
    const strip = INDEX.slice(
      INDEX.indexOf('<nav className="prod-jump"'),
      INDEX.indexOf("</nav>")
    );
    expect(strip).toContain('["--prod-accent" as string]: p.accent');
    expect(CSS).toContain(".prod-jump-dot");
  });

  it("is a labelled landmark, not an anonymous row of links", () => {
    expect(INDEX).toMatch(/<nav className="prod-jump" aria-label="[^"]+"/);
  });

  it("WRAPS on a phone rather than scrolling sideways", () => {
    // A horizontal rail looks tidier and hides half the range behind a gesture
    // nobody is told about. Wrapping shows all eleven names at once, which is
    // the entire reason the strip exists.
    const rule = MOBILE.slice(MOBILE.indexOf(".prod-jump {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).not.toContain("nowrap");
    expect(body).not.toContain("overflow-x");
    // And the base rule wraps too.
    const base = CSS.slice(CSS.indexOf(".prod-jump {"));
    expect(base.slice(0, base.indexOf("}"))).toContain("flex-wrap: wrap");
  });

  it("is not sticky — .book-topbar already is, and it changes height at 620px", () => {
    // Two pinned bars would spend a third of a 667px screen on chrome, and a
    // fixed `top` offset under a topbar that wraps to two rows at 620px is
    // wrong at one width or the other.
    const rule = MOBILE.slice(MOBILE.indexOf(".prod-jump {"));
    expect(rule.slice(0, rule.indexOf("}"))).not.toContain("position: sticky");
    const head = MOBILE.slice(MOBILE.indexOf(".prod-group-head {"));
    expect(head.slice(0, head.indexOf("}"))).not.toContain("position: sticky");
    // The reason is recorded where the next person will look for it.
    expect(MOBILE).toContain("book-topbar");
  });
});

describe("the group headings say how much is under them", () => {
  it("counts from the group, not from a number typed in", () => {
    expect(INDEX).toContain('<span className="prod-group-count">{products.length}</span>');
    expect(CSS).toContain(".prod-group-count");
  });

  it("the counts it will render are the real ones", () => {
    const counts = marketingGroups().map((g) => g.products.length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(MARKETING_PRODUCTS.length);
    expect(counts.every((c) => c > 0)).toBe(true);
  });
});

describe("the cards are tighter on a phone and still all there", () => {
  it("spends less of a 390px screen on padding", () => {
    // 24px each side of a card inside a 22px page gutter leaves 298px of
    // content on a 390px phone — an eighth of the width on nothing.
    const card = MOBILE.slice(MOBILE.indexOf(".prod-index-card {"));
    expect(card.slice(0, card.indexOf("}"))).toMatch(/padding:\s*18px/);
    const base = CSS.slice(CSS.indexOf(".prod-index-card {"));
    expect(base.slice(0, base.indexOf("}")), "desktop padding must be unchanged").toMatch(
      /padding:\s*24px/
    );
  });

  it("closes the gaps between sections, which there are four of", () => {
    expect(MOBILE).toMatch(/\.prod-page \.book-section\s*\{[^}]*padding:\s*28px 0/);
    // Scoped to this page: .book-section is shared with /book and /systems.
    expect(MOBILE).toContain(".prod-page .book-section");
  });

  it("keeps every card's copy — nothing was dropped to save height", () => {
    // The temptation on a long page is to hide the bullets behind a
    // "show more". Each card still renders its kicker, sub, bullets, both
    // doors and the read-more link.
    expect(INDEX).toContain("prod-index-kicker");
    expect(INDEX).toContain("prod-index-sub");
    expect(INDEX).toContain("p.does.slice(0, 3).map");
    expect(INDEX).toContain("Log in");
    expect(INDEX).toContain("Request access");
    expect(INDEX).toContain("prod-index-more");
  });

  it("still collapses to a single column", () => {
    for (const g of marketingGroups()) {
      expect(MOBILE).toContain(`.prod-index--${g.group.key}`);
    }
    expect(MOBILE).toContain("grid-template-columns: 1fr");
  });
});

describe("each card looks like its own product", () => {
  it("washes the card in the product's accent", () => {
    // Eleven identical grey cards in a column is what makes the page read as
    // a list to get through. On a phone only one card is on screen at a time,
    // so the accent is the only cue you have moved on to a different product.
    const card = CSS.slice(CSS.indexOf(".prod-index-card {"));
    const body = card.slice(0, card.indexOf("}"));
    expect(body).toContain("radial-gradient");
    expect(body).toContain("var(--prod-accent)");
  });

  it("promotes the 'who it's for' line from the faintest text to a tinted pill", () => {
    // It answers "is this me?", which is the only question someone scanning
    // eleven products is asking, and it was the lowest-contrast text on the
    // card.
    const kicker = CSS.slice(CSS.indexOf(".prod-index-kicker {"));
    const body = kicker.slice(0, kicker.indexOf("}"));
    expect(body).toContain("var(--prod-accent)");
    expect(body).toContain("border-radius: 999px");
    expect(body).not.toContain("color: var(--faint)");
  });

  it("every product supplies an accent for it to use", () => {
    const missing = MARKETING_PRODUCTS.filter((p) => !/^#[0-9a-f]{6}$/i.test(p.accent));
    expect(missing.map((p) => p.slug)).toEqual([]);
  });
});
