import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isKnownReviewHost,
  normaliseReviewLink,
  reviewLinkStatus,
} from "@/lib/review-agent/review-hosts";

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

describe("what the settings form tells you about a pasted link", () => {
  it("ACCEPTS the schemeless paste that the old form rejected", () => {
    // z.string().url() refused this, and it is how an owner actually copies a
    // Google review link. The form turned away the commonest correct input.
    const s = reviewLinkStatus("g.page/r/CQXyz/review");
    expect(s.ok).toBe(true);
    expect(s.known).toBe(true);
    expect(s.ok && s.url.protocol).toBe("https:");
  });

  it.each([
    "https://g.page/r/CQXyz/review",
    "https://maps.app.goo.gl/abc123",
    "https://www.trustpilot.com/review/example.ie",
    "https://www.facebook.com/example/reviews",
    "https://www.checkatrade.com/trades/example",
  ])("recognises %s and sends customers straight through", (raw) => {
    const s = reviewLinkStatus(raw);
    expect(s.ok).toBe(true);
    expect(s.known).toBe(true);
    expect(s.message).toBeNull();
  });

  it("WARNS about a valid link that isn't a review site", () => {
    // Saved happily by the old form; every customer then met an interstitial
    // on the one action the product exists to cause, and nothing said so.
    const s = reviewLinkStatus("https://example.com");
    expect(s.ok).toBe(true);
    expect(s.known).toBe(false);
    expect(s.message).toContain("example.com");
    expect(s.message).toMatch(/confirmation/i);
  });

  it("does not BLOCK an unrecognised host", () => {
    // review-hosts is explicit that blocking off-list would break a legitimate
    // customer whose platform isn't listed. A warning, never a refusal.
    expect(reviewLinkStatus("https://some-local-directory.ie/biz").ok).toBe(true);
  });

  it.each(["not a url", "file:///etc/passwd", "javascript:alert(1)", "localhost", "http://"])(
    "rejects %s as unusable",
    (raw) => {
      const s = reviewLinkStatus(raw);
      expect(s.ok).toBe(false);
      expect(s.url).toBeNull();
      expect(s.message.length).toBeGreaterThan(20);
    }
  );

  it("says something useful when nothing is set", () => {
    for (const empty of ["", "   ", null, undefined]) {
      const s = reviewLinkStatus(empty);
      expect(s.ok).toBe(false);
      expect(s.message).toMatch(/no review link/i);
    }
  });

  it("normalises so what is stored is what redirects", () => {
    // The saved value is the absolute URL, resolved once here rather than
    // re-guessed on every redirect.
    const s = reviewLinkStatus("g.page/r/CQXyz/review");
    expect(s.ok && s.url.toString()).toBe("https://g.page/r/CQXyz/review");
  });

  it("agrees with the redirect path — same parser, same verdict", () => {
    // The whole point: settings and redirect must never disagree about a link.
    for (const raw of ["g.page/r/x/review", "https://example.com", "nonsense"]) {
      const s = reviewLinkStatus(raw);
      const direct = normaliseReviewLink(raw);
      expect(s.ok).toBe(direct !== null);
      if (direct) expect(s.ok && s.known).toBe(isKnownReviewHost(direct.hostname));
    }
  });
});

describe("the settings form is actually wired to it", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const ACTIONS = readFileSync(
    path.join(ROOT, "app", "portal", "review-agent", "settings", "actions.ts"),
    "utf8"
  );
  const PAGE = readFileSync(
    path.join(ROOT, "app", "portal", "review-agent", "settings", "page.tsx"),
    "utf8"
  );

  it("validates with the shared status, not a bare URL check", () => {
    expect(ACTIONS).toContain("reviewLinkStatus(link)");
    expect(ACTIONS).not.toContain('.url("Enter a valid URL")\n    .or(z.literal(""))');
  });

  it("stores the normalised absolute URL", () => {
    expect(ACTIONS).toContain("storedLink = status.url.toString()");
  });

  it("saves an unrecognised host with a notice rather than refusing it", () => {
    expect(ACTIONS).toMatch(/notice \? \{ ok: true, notice \}/);
  });

  it("shows the saved link's real status on the page", () => {
    expect(PAGE).toContain("reviewLinkStatus(business?.google_review_link)");
    expect(PAGE).toContain("Recognised review site");
  });

  it("stops the browser rejecting a schemeless paste before submit", () => {
    // type="url" fails "g.page/…" client-side, so the server never sees it.
    const field = PAGE.slice(PAGE.indexOf('id="googleReviewLink"'));
    expect(field.slice(0, 400)).not.toContain('type="url"');
  });
});
