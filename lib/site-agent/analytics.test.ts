import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isLikelyBot, summariseViews, dayKey } from "@/lib/site-agent/analytics";

/**
 * The only signal a SiteIQ customer had was the enquiry list — a numerator
 * with no denominator. "Three enquiries" means something completely different
 * out of 40 visits than out of 4,000, and the difference is the difference
 * between "write a better page" and "get people to the page at all". Neither
 * could be told apart.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** ISO string for N days before the fixed "now" below. */
const NOW = new Date("2026-08-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const key = (n: number) => dayKey(daysAgo(n));

describe("what is not a visitor", () => {
  it("catches the declared crawlers", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "facebookexternalhit/1.1",
      "curl/8.5.0",
      "python-requests/2.31.0",
      "node-fetch/1.0",
      "Mozilla/5.0 AhrefsBot/7.0",
      "Chrome-Lighthouse",
    ]) {
      expect(isLikelyBot(ua), ua).toBe(true);
    }
  });

  it("treats a missing user-agent as a script", () => {
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot("")).toBe(true);
    expect(isLikelyBot("   ")).toBe(true);
  });

  it("counts real browsers", () => {
    // Over-filtering hides real visitors just as badly as under-filtering
    // inflates them.
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/128.0",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
    ]) {
      expect(isLikelyBot(ua), ua).toBe(false);
    }
  });
});

describe("reading the numbers", () => {
  it("totals the window", () => {
    const s = summariseViews(
      [
        { day: key(0), views: 10 },
        { day: key(1), views: 5 },
      ],
      [],
      30,
      NOW
    );
    expect(s.views).toBe(15);
  });

  it("fills the silent days with zeros", () => {
    // A chart drawn only from days that HAVE rows draws a straight line
    // through a fortnight of silence and reads as steady traffic.
    const s = summariseViews([{ day: key(0), views: 10 }], [], 30, NOW);
    expect(s.series).toHaveLength(30);
    expect(s.series.filter((d) => d.views === 0)).toHaveLength(29);
    expect(s.series[29]).toEqual({ day: key(0), views: 10 });
  });

  it("is ordered oldest first", () => {
    const s = summariseViews([], [], 5, NOW);
    expect(s.series.map((d) => d.day)).toEqual([key(4), key(3), key(2), key(1), key(0)]);
  });

  it("ignores rows outside the window rather than adding them in", () => {
    const s = summariseViews(
      [
        { day: key(0), views: 10 },
        { day: key(90), views: 500 },
      ],
      [],
      30,
      NOW
    );
    expect(s.views).toBe(10);
  });

  it("counts enquiries over the SAME window as the views", () => {
    // Comparing all-time enquiries against 30 days of visits would flatter
    // the page — the count that doesn't match its own source.
    const s = summariseViews(
      [{ day: key(0), views: 100 }],
      [daysAgo(1).toISOString(), daysAgo(200).toISOString()],
      30,
      NOW
    );
    expect(s.enquiries).toBe(1);
    expect(s.conversionRate).toBe(1);
  });

  it("survives an unparseable timestamp", () => {
    const s = summariseViews([{ day: key(0), views: 10 }], ["not a date", ""], 30, NOW);
    expect(s.enquiries).toBe(0);
  });

  it("has no rate at all when nobody visited, rather than zero", () => {
    // 0% implies a measurement was taken. None was.
    const s = summariseViews([], ["x"], 30, NOW);
    expect(s.conversionRate).toBeNull();
    expect(s.views).toBe(0);
  });

  it("names the busiest day", () => {
    const s = summariseViews(
      [
        { day: key(3), views: 4 },
        { day: key(1), views: 19 },
        { day: key(0), views: 7 },
      ],
      [],
      30,
      NOW
    );
    expect(s.busiest).toEqual({ day: key(1), views: 19 });
  });

  it("has no busiest day when nothing happened", () => {
    expect(summariseViews([], [], 30, NOW).busiest).toBeNull();
  });

  it("rounds the rate to one decimal", () => {
    const s = summariseViews([{ day: key(0), views: 300 }], [daysAgo(0).toISOString()], 30, NOW);
    expect(s.conversionRate).toBe(0.3);
  });
});

describe("what the numbers are told to mean", () => {
  const verdict = (views: number, enquiries: number) =>
    summariseViews(
      [{ day: key(0), views }],
      Array.from({ length: enquiries }, () => daysAgo(0).toISOString()),
      30,
      NOW
    ).verdict;

  it("says nobody has visited, and what to do about it", () => {
    expect(verdict(0, 0)).toContain("Nobody has visited");
    expect(verdict(0, 0)).toMatch(/van|invoices|Google profile/);
  });

  it("REFUSES to read anything into a handful of visits", () => {
    // "100% conversion" off two views is noise, and a product that reports it
    // as a triumph is not trustworthy about anything else.
    const v = verdict(2, 2);
    expect(v).toContain("too few");
    expect(v).not.toMatch(/works|100/);
  });

  it("points at the page when traffic arrives and nobody enquires", () => {
    const v = verdict(400, 0);
    expect(v).toContain("nobody got in touch");
    expect(v).toMatch(/headline/);
  });

  it("points at traffic when the page converts well", () => {
    const v = verdict(200, 20);
    expect(v).toContain("page that works");
    expect(v).toContain("more people to it");
  });

  it("gets the singular and plural right", () => {
    expect(verdict(200, 1)).toContain("1 enquiry");
    expect(verdict(200, 4)).toContain("4 enquiries");
    expect(verdict(1, 0)).toContain("1 visit ");
  });
});

describe("the counting path", () => {
  const MIGRATION = readFileSync(
    path.join(ROOT, "supabase", "migrations", "0040_siteiq_page.sql"),
    "utf8"
  );
  const PUBLIC = readFileSync(path.join(ROOT, "app", "b", "[slug]", "page.tsx"), "utf8");
  const PORTAL = readFileSync(
    path.join(ROOT, "app", "portal", "website-agent", "page.tsx"),
    "utf8"
  );

  it("views are per day, not per visit", () => {
    // A row per visit on a public page is a table the whole internet can
    // write to, without a session, as fast as it can hold a key down.
    expect(MIGRATION).toContain("primary key (business_id, day)");
  });

  it("the only write path adds one and cannot be made to do anything else", () => {
    expect(MIGRATION).toContain("views = wa_page_views.views + 1");
    expect(MIGRATION).toContain("record_page_view (p_business_id uuid, p_day date)");
    expect(MIGRATION).toContain("security definer");
    expect(MIGRATION).toContain("set search_path = public");
  });

  it("a count can never go negative", () => {
    expect(MIGRATION).toMatch(/views integer not null default 0 check \(views >= 0\)/);
  });

  it("the table is read-only through RLS", () => {
    const idx = MIGRATION.indexOf("members view their own page views");
    expect(MIGRATION.slice(idx, idx + 200)).toContain("for select");
  });

  it("bots are excluded before anything is recorded", () => {
    const idx = PUBLIC.indexOf("async function countView");
    const body = PUBLIC.slice(idx, idx + 600);
    expect(body.indexOf("isLikelyBot")).toBeGreaterThan(-1);
    expect(body.indexOf("isLikelyBot")).toBeLessThan(body.indexOf("record_page_view"));
  });

  it("the enquiry window matches the view window", () => {
    // Dividing 14 days of enquiries by 30 days of visits reports a rate
    // roughly half the real one, in the number a customer judges the product
    // by.
    expect(PORTAL).toContain("leadRows30");
    expect(PORTAL).toContain("29 * 86_400_000");
  });

  it("distinguishes 'nobody visited' from 'we cannot tell yet'", () => {
    expect(PORTAL).toContain("viewsTracked");
    expect(PORTAL).toContain("switching on shortly");
  });
});
