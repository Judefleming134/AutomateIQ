import { describe, it, expect } from "vitest";
import { canonicalPath } from "@/lib/routing/case";

describe("canonicalPath — brand URLs typed with capitals", () => {
  it.each([
    ["/TradeIQ", "/tradeiq"],
    ["/TRADEIQ", "/tradeiq"],
    ["/Tradeiq", "/tradeiq"],
    ["/FreeTools", "/freetools"],
    ["/Book", "/book"],
    ["/Systems", "/systems"],
    ["/Portal", "/portal"],
    ["/Finance", "/finance"],
  ])("corrects %s to %s", (input, expected) => {
    expect(canonicalPath(input)).toBe(expected);
  });

  it("leaves an already-lowercase path alone, so there is no redirect loop", () => {
    for (const p of ["/tradeiq", "/book", "/freetools", "/", "/portal/permitiq"]) {
      expect(canonicalPath(p)).toBeNull();
    }
  });
});

describe("canonicalPath — what it must never break", () => {
  it("NEVER lowercases a signed token further down the path", () => {
    // /tradeiq/doc/<token> links are in the inboxes of tradespeople's own
    // customers. Lowercasing the token would 404 every emailed invoice.
    expect(canonicalPath("/TradeIQ/doc/AbC123xyZ")).toBe("/tradeiq/doc/AbC123xyZ");
    expect(canonicalPath("/Q/AbC123xyZ")).toBe("/q/AbC123xyZ");
    expect(canonicalPath("/B/MySlugCase")).toBe("/b/MySlugCase");
  });

  it("leaves a correctly-cased path with a mixed-case token completely alone", () => {
    expect(canonicalPath("/tradeiq/doc/AbC123xyZ")).toBeNull();
    expect(canonicalPath("/q/AbC123xyZ")).toBeNull();
  });

  it("never touches API routes", () => {
    // An API client that gets a redirect instead of a response is a bad day.
    expect(canonicalPath("/api/Webhooks/Stripe")).toBeNull();
    expect(canonicalPath("/api/cron/Dispatch")).toBeNull();
  });

  it("never touches Next internals", () => {
    expect(canonicalPath("/_next/Static/chunk.js")).toBeNull();
  });

  it("lets a genuine 404 stay a 404", () => {
    // Redirecting /Nonsense to /nonsense helps nobody and hides the real error.
    expect(canonicalPath("/Nonsense")).toBeNull();
    expect(canonicalPath("/PricingPlans")).toBeNull();
  });

  it("handles odd input without throwing", () => {
    for (const p of ["", "/", "//", "not-a-path", "/A"]) {
      expect(() => canonicalPath(p)).not.toThrow();
    }
  });
});
