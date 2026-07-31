import { describe, it, expect } from "vitest";
import { isKnownReviewHost, normaliseReviewLink } from "@/lib/review-agent/review-hosts";

/**
 * Review-link safety.
 *
 * `/api/r/[token]` redirects to whatever a tenant saved as their review link.
 * Unrestricted that is an open redirect on automateiq.ie: a customer saves a
 * phishing URL, sends the link around, and victims see OUR domain and trust it.
 * The damage lands on Jude's domain reputation, not theirs.
 *
 * The rule is a dot-boundary match, not endsWith — the difference between the
 * two is the whole attack surface.
 */

describe("isKnownReviewHost", () => {
  it.each([
    "google.com",
    "google.ie",
    "g.page",
    "maps.app.goo.gl",
    "trustpilot.com",
    "checkatrade.com",
    "yelp.ie",
  ])("accepts the review platform %s", (host) => {
    expect(isKnownReviewHost(host)).toBe(true);
  });

  it("accepts a subdomain of a known platform", () => {
    expect(isKnownReviewHost("business.google.com")).toBe(true);
    expect(isKnownReviewHost("uk.trustpilot.com")).toBe(true);
  });

  it("is case-insensitive and tolerates a trailing dot", () => {
    expect(isKnownReviewHost("GOOGLE.COM.")).toBe(true);
  });

  it.each([
    // A plain endsWith would wave the first one straight through.
    ["suffix-glued lookalike", "notgoogle.com"],
    ["domain used as a subdomain of an attacker", "google.com.evil.net"],
    ["unrelated host", "phishing-site.example"],
  ])("rejects a %s", (_label, host) => {
    expect(isKnownReviewHost(host)).toBe(false);
  });
});

describe("normaliseReviewLink", () => {
  it("adds https to the schemeless links owners actually paste", () => {
    expect(normaliseReviewLink("g.page/acme-plumbing")?.toString()).toBe(
      "https://g.page/acme-plumbing"
    );
  });

  it("keeps an explicit http(s) URL", () => {
    expect(normaliseReviewLink("https://trustpilot.com/review/acme")?.hostname).toBe(
      "trustpilot.com"
    );
    expect(normaliseReviewLink("http://example.ie/reviews")?.protocol).toBe("http:");
  });

  it.each([null, undefined, "", "   "])("returns null for %p", (input) => {
    expect(normaliseReviewLink(input)).toBeNull();
  });

  it("rejects a non-http scheme instead of prefixing it", () => {
    // Blindly gluing "https://" onto anything schemeless turned
    // "file:///etc/passwd" into "https://file//etc/passwd" — which parses
    // cleanly, has the hostname "file", and sails through every later check.
    // Harmless in itself, but it is exactly the shape a real bypass takes.
    expect(normaliseReviewLink("file:///etc/passwd")).toBeNull();
    expect(normaliseReviewLink("javascript:alert(1)")).toBeNull();
    expect(normaliseReviewLink("data:text/html,<script>")).toBeNull();
  });

  it("rejects single-label junk that would reach a customer as a destination", () => {
    expect(normaliseReviewLink("localhost")).toBeNull();
    expect(normaliseReviewLink("not a url")).toBeNull();
  });

  it("normalises then classifies — the two steps the redirect depends on", () => {
    const known = normaliseReviewLink("g.page/acme");
    expect(known && isKnownReviewHost(known.hostname)).toBe(true);

    const unknown = normaliseReviewLink("some-review-site.example/acme");
    // Not blocked — it goes to the interstitial, so a legitimate customer on an
    // unlisted platform never has their flow broken.
    expect(unknown).not.toBeNull();
    expect(unknown && isKnownReviewHost(unknown.hostname)).toBe(false);
  });
});
