import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The prospects page scrolled sideways on a phone.
 *
 * `CSV_HINT` is the list of columns the importer accepts:
 *
 *   company,contact_name,job_title,industry,website,location,email,phone,
 *   linkedin_url,instagram_url,facebook_url,notes
 *
 * 114 characters with ZERO spaces — so there is no break opportunity anywhere
 * in it, and a browser will not break it by default. Rendered in a 12px
 * monospace <code> that is roughly 820px wide, against a 375px phone.
 *
 * Nothing clipped it. `.form-card` caps at max-width:480px, which does not bind
 * below 375px, and neither it nor `.main-content` sets `overflow`. So the span
 * widened its container, which widened the page, and the whole body scrolled
 * horizontally — on the page Jude works from most.
 *
 * Four other <code> spans in the codebase already carried an inline
 * `wordBreak: "break-all"` (the booking URL twice, the inbound-webhook URL)
 * because someone hit this before. This one was the only long one without it —
 * and it got more reachable when the campaign "import a CSV" link started
 * opening that panel automatically, so it is no longer behind a collapsed
 * <details> for anyone arriving that way.
 *
 * Fixed twice over: the span itself, and a shell-scoped default so the next
 * long <code> cannot reintroduce it.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");
const PROSPECTS = read("app", "growth", "(app)", "prospects", "page.tsx");
const CSS = read("app", "globals.css");

/** The literal, straight from the source. */
const CSV_HINT = /const CSV_HINT =\s*\n\s*"([^"]+)"/.exec(PROSPECTS)![1];

/** Rough monospace width at the 12px the span renders at. */
const CHAR_PX = 7.2;
const PHONE_PX = 375;

describe("the string really is unbreakable and really is too wide", () => {
  it("has no space, hyphen or other break opportunity", () => {
    expect(CSV_HINT).not.toMatch(/[\s\-­]/);
  });

  it("is far wider than a phone at the size it renders", () => {
    const width = CSV_HINT.length * CHAR_PX;
    expect(CSV_HINT.length).toBeGreaterThan(100);
    expect(width).toBeGreaterThan(PHONE_PX * 2);
  });

  it("commas are not break opportunities — that is the whole trap", () => {
    // It LOOKS delimited, which is why it reads as safe.
    expect(CSV_HINT).toContain(",");
    expect(CSV_HINT.split(/\s/)).toHaveLength(1);
  });
});

describe("the span itself now wraps", () => {
  it("the CSV hint carries a word-break", () => {
    const span = PROSPECTS.slice(
      PROSPECTS.indexOf("<code", PROSPECTS.indexOf("columns (any order)")),
      PROSPECTS.indexOf("</code>", PROSPECTS.indexOf("columns (any order)"))
    );
    expect(span).toContain("{CSV_HINT}");
    expect(span).toContain('wordBreak: "break-all"');
  });

  it("it matches the idiom the other long spans already use", () => {
    const settings = read("app", "growth", "(app)", "settings", "page.tsx");
    expect(settings).toContain('wordBreak: "break-all"');
  });

  it("the hint's CONTENT is unchanged — every column still documented", () => {
    for (const col of [
      "company", "contact_name", "job_title", "industry", "website",
      "location", "email", "phone", "linkedin_url", "instagram_url",
      "facebook_url", "notes",
    ]) {
      expect(CSV_HINT.split(",")).toContain(col);
    }
    expect(CSV_HINT.split(",")).toHaveLength(12);
  });
});

describe("and the class is guarded, not just the instance", () => {
  it("code inside the app shell wraps by default", () => {
    expect(CSS).toMatch(/\.main-content code \{\s*overflow-wrap: anywhere;/);
  });

  it("it is scoped to the shell — the marketing pages are untouched", () => {
    // A bare `code { … }` would reach the public site too.
    expect(CSS).not.toMatch(/^code \{\s*overflow-wrap/m);
    expect(CSS).toContain(".main-content code {");
  });

  it("`anywhere`, not `break-all` — short spans stay unbroken", () => {
    // break-all chops mid-word even when it fits; anywhere only breaks when the
    // word would otherwise overflow, and also stops it forcing the container
    // wide in the first place.
    const rule = CSS.slice(CSS.indexOf(".main-content code {"));
    expect(rule.slice(0, 80)).toContain("overflow-wrap: anywhere");
    expect(rule.slice(0, 80)).not.toContain("break-all");
  });
});

describe("nothing was clipping it, which is why it reached the page", () => {
  it(".main-content sets no overflow", () => {
    const block = CSS.slice(CSS.indexOf(".main-content {"), CSS.indexOf("}", CSS.indexOf(".main-content {")));
    expect(block).not.toContain("overflow");
  });

  it(".form-card's max-width cannot bind below a phone width", () => {
    const block = CSS.slice(CSS.indexOf(".form-card {"), CSS.indexOf("}", CSS.indexOf(".form-card {")));
    const max = /max-width:\s*(\d+)px/.exec(block);
    expect(max).not.toBeNull();
    expect(Number(max![1])).toBeGreaterThan(PHONE_PX);
  });
});

describe("no other long code span is left unguarded", () => {
  it("every <code> over 40 unbroken chars either wraps or is in the shell", () => {
    const offenders: string[] = [];
    for (const rel of [
      ["app", "growth", "(app)", "settings", "page.tsx"],
      ["app", "growth", "(app)", "meetings", "page.tsx"],
      ["app", "growth", "(app)", "prospects", "page.tsx"],
      ["app", "growth", "(app)", "prospects", "[id]", "page.tsx"],
    ]) {
      const src = read(...rel);
      for (const m of src.matchAll(/<code([^>]*)>([\s\S]*?)<\/code>/g)) {
        const [, attrs, inner] = m;
        const longest = Math.max(
          0,
          ...inner.trim().split(/\s+/).map((t) => t.length)
        );
        const guarded = /break-all|anywhere|break-word/.test(attrs);
        // Everything here lives inside .main-content, so the new rule covers
        // it even when the inline style is absent.
        if (longest >= 40 && !guarded) offenders.push(`${rel.join("/")}: ${inner.slice(0, 40)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
