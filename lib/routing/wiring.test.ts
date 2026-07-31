import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { KNOWN_SEGMENTS, canonicalPath } from "@/lib/routing/case";

/**
 * The wiring, not the function.
 *
 * lib/routing/case.test.ts covers canonicalPath() thoroughly, and every one of
 * those tests passed while the function WAS NEVER CALLED IN PRODUCTION. The
 * proxy matcher is an allowlist — `/portal/:path*`, `/admin/:path*`,
 * `/growth/:path*`, `/login` — and `/TradeIQ` matches none of them, so the
 * redirect shipped dead and every capitalised URL on the site still 404'd.
 *
 * That is the "reporting success for work that didn't happen" class in
 * CLAUDE.md, and a unit test of a pure function is exactly how it hides. These
 * tests check the two joins the pure function depends on:
 *
 *   1. the proxy matcher actually routes capitalised paths to it, and
 *   2. every segment it redirects TO actually resolves to something.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PROXY = readFileSync(path.join(ROOT, "proxy.ts"), "utf8");
const NEXT_CONFIG = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");

/** The matcher entries, read from the file rather than imported — importing
 *  proxy.ts pulls in the Next server runtime and @supabase/ssr. `matcher` is
 *  the last thing in the file, so everything after it is the array. Slicing to
 *  the first "]" would truncate on the "]" inside `[^/]`. */
function matcherEntries(): string[] {
  const block = PROXY.slice(PROXY.indexOf("matcher:"));
  return [...block.matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]);
}

/**
 * Split a matcher pattern on its real segment boundaries. A plain
 * `.split("/")` shreds `/:segment([^/]*[A-Z][^/]*)/:path*`, because the
 * pattern contains slashes inside a character class.
 */
function splitSegments(pattern: string): string[] {
  const segs: string[] = [];
  let cur = "";
  let depth = 0;
  let inClass = false;
  for (const ch of pattern) {
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "(" && !inClass) depth++;
    else if (ch === ")" && !inClass) depth--;
    if (ch === "/" && depth === 0 && !inClass) {
      if (cur) segs.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) segs.push(cur);
  return segs;
}

/**
 * Next matcher pattern → RegExp. Models the three shapes this config uses:
 * a literal (`/login`), a catch-all tail (`/portal/:path*`), and a named
 * param with a custom pattern (`/:segment([^/]*[A-Z][^/]*)`).
 *
 * This is a MODEL of Next's path-to-regexp, so it is calibrated against real
 * observed behaviour below rather than trusted on its own.
 */
function matcherToRegExp(pattern: string): RegExp {
  let out = "";
  for (const seg of splitSegments(pattern)) {
    const custom = seg.match(/^:[A-Za-z]\w*\((.+)\)$/);
    const star = seg.match(/^:[A-Za-z]\w*\*$/);
    if (star) {
      out += "(?:/.*)?";
    } else if (custom) {
      out += "/" + custom[1];
    } else {
      out += "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out || "/"}$`);
}

const proxyRuns = (p: string) =>
  matcherEntries().some((m) => matcherToRegExp(m).test(p));

describe("the matcher model agrees with the running server", () => {
  // Recorded from `next start` with an instrumented proxy that stamped
  // x-proxy-ran on every response it produced. Without this fixture the model
  // above would just be asserting itself.
  it.each([
    ["/", false],
    ["/products", false],
    ["/products/tradeiq", false],
    ["/book", false],
    ["/freetools", false],
    ["/Products", true],
    ["/TradeIQ", true],
    ["/login", true],
    ["/portal", true],
  ])("%s -> proxy runs: %s", (p, expected) => {
    expect(proxyRuns(p)).toBe(expected);
  });
});

describe("the proxy actually routes capitalised URLs to canonicalPath", () => {
  it("runs for the capitalised form of every segment it knows about", () => {
    // The bug, stated as a test: canonicalPath can correct these, but if the
    // proxy never sees them the correction never happens.
    const unreachable = [...KNOWN_SEGMENTS]
      .map((s) => "/" + s[0].toUpperCase() + s.slice(1))
      .filter((p) => !proxyRuns(p));
    expect(unreachable).toEqual([]);
  });

  it("runs for capitalised sub-paths too, so signed links survive", () => {
    expect(proxyRuns("/TradeIQ/doc/AbC123")).toBe(true);
    expect(proxyRuns("/Q/AbC123")).toBe(true);
  });

  it("still runs for the session surfaces it always did", () => {
    for (const p of ["/portal", "/portal/billing", "/admin", "/growth", "/login"]) {
      expect(proxyRuns(p), p).toBe(true);
    }
  });

  it("does NOT run for the static marketing site", () => {
    // A catch-all matcher would work too, and would turn the site's
    // highest-traffic fully-static page into a Node invocation on every visit.
    for (const p of ["/", "/products", "/book", "/systems", "/freetools", "/savings"]) {
      expect(proxyRuns(p), p).toBe(false);
    }
  });
});

describe("every segment canonicalPath redirects to actually resolves", () => {
  const redirectSources = [
    ...NEXT_CONFIG.matchAll(/source:\s*"(\/[^"]*)"/g),
  ].map((m) => m[1]);

  it.each([...KNOWN_SEGMENTS])("/%s is a real destination", (segment) => {
    // The miss this catches: /permitiq and /financeiq were the brand names on
    // the card and neither existed in ANY casing — PermitIQ lives at
    // /portal/permitiq and FinanceIQ at /finance, so both were plain 404s.
    const hasRoute = existsSync(path.join(ROOT, "app", segment, "page.tsx"));
    const hasDynamicRoute = existsSync(path.join(ROOT, "app", segment));
    const hasRedirect = redirectSources.includes(`/${segment}`);
    expect(
      hasRoute || hasDynamicRoute || hasRedirect,
      `/${segment} is in KNOWN_SEGMENTS but is neither a route nor a redirect source`
    ).toBe(true);
  });
});

describe("the brand names people actually type", () => {
  it.each([
    ["/TradeIQ", "/tradeiq"],
    ["/PermitIQ", "/permitiq"],
    ["/FinanceIQ", "/financeiq"],
    ["/Products", "/products"],
  ])("%s corrects to %s and the proxy sees it", (input, expected) => {
    expect(canonicalPath(input)).toBe(expected);
    expect(proxyRuns(input)).toBe(true);
  });

  it("sends the two brand names with no route of their own to their product page", () => {
    // /permitiq and /financeiq are not route folders. They must land on the
    // public product page — which explains what it is AND carries the Log in
    // button — not on the app behind a password box.
    const pairs = [...NEXT_CONFIG.matchAll(/source:\s*"([^"]+)",\s*destination:\s*"([^"]+)"/g)];
    const dest = (s: string) => pairs.find((p) => p[1] === s)?.[2];
    expect(dest("/permitiq")).toBe("/products/permitiq");
    expect(dest("/financeiq")).toBe("/products/financeiq");
  });
});
